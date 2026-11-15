// Everglades — multiplayer web server.
// No installs needed: uses only what ships with Node.js.
// Run:  node server.js     then open http://localhost:3000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// Settings from a local .env file (KEY=value per line), if there is one. Used on your own computer;
// on a host like Render, set the same names under Environment instead. Real environment variables win.
(function loadDotEnv() {
  let text; try { text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();
const crypto = require('crypto');
const os = require('os');
const G = require('./game.js');
const A = require('./accounts.js'); // player accounts, Eco-bucks, profile pictures, store
const P = require('./payments.js'); // buying Eco-bucks with Stripe Checkout

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
// Bot pacing (milliseconds). The host picks a speed in the lobby or the game's top bar.
// bot = how long a bot waits before each move; trick = how long a finished trick stays on screen
// (winning card highlighted) before anyone moves on. BOT_DELAY_MS rescales them all (Normal = that value).
const BOT_DELAY_MS = +process.env.BOT_DELAY_MS || 3200;
const { CHAT } = require('./public/data.js');
const CHAT_COOLDOWN_MS = 2500; // a player can send one chat line every 2.5 seconds
const SPEEDS = {
  slow: { label: 'Slow', bot: BOT_DELAY_MS * 1.6, trick: BOT_DELAY_MS * 2.2 },
  normal: { label: 'Normal', bot: BOT_DELAY_MS, trick: BOT_DELAY_MS * 1.6 },
  fast: { label: 'Fast', bot: BOT_DELAY_MS * 0.45, trick: BOT_DELAY_MS * 0.9 },
};
const pace = room => SPEEDS[room.speed] || SPEEDS.normal;
const DEAL_PAUSE_MS = 5200; // the shuffle-and-deal animation
// Turn timer: every person gets TURN_MS for each turn (a role pick, a biome choice, a card with its follow-up steps,
// a Disruption pick or commit). When it runs out a bot plays that turn for them and they get a strike; at
// MAX_STRIKES they are removed and a bot keeps their seat. Always on at public tables; private tables can turn it
// off in the lobby. Never used in the tutorial.
const TURN_MS = +process.env.TURN_MS || 60000; // (TURN_MS can be shortened for tests: see test/timer.js)
const MAX_STRIKES = 3;
const MIN_TABLE = 4; // bots fill seats up to this many players
const BOT_NAMES = ['Gator Bot', 'Heron Bot', 'Manatee Bot', 'Otter Bot', 'Panther Bot', 'Stork Bot'];

const rooms = new Map(); // code -> room

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const rid = () => crypto.randomBytes(12).toString('hex');

function newRoom() {
  const room = { code: code(), members: [], hostPid: null, game: G.newGame(), clients: new Set(), touched: Date.now(), botTimer: null, chatter: [], chatId: 0, pauseUntil: 0, tricksSeen: 0,
    reactions: [], reactId: 0, evSeen: 0, speed: 'normal',
    public: false, turnTimer: true, strikes: {}, deadline: null, deadlineTimer: null, // see TURN_MS
    buyIn: A.ECON.buyIns[0], gameId: null, settlement: null };
  rooms.set(room.code, room);
  return room;
}

// People join with their account (gamertag + profile picture); bots have none.
// Bid confirmations (see the 'confirm' lobby command): cleared whenever the bid or payout rules change.
function unconfirmAll(room) { for (const x of room.members) x.confirmed = false; }
function addMember(room, name, bot = false, account = null) {
  if (room.game.phase !== 'lobby') throw Object.assign(new Error('That game has already started.'), { userError: true });
  if (room.members.length >= G.MAX_PLAYERS) throw Object.assign(new Error('That table is full.'), { userError: true });
  const m = { token: rid(), pid: rid().slice(0, 8), name: cleanName(account ? account.gamertag : name), bot, accountId: account ? account.id : null, unlocks: [] };
  room.members.push(m);
  if (!room.hostPid && !bot) room.hostPid = m.pid;
  return m;
}
const memberAccount = m => (m && m.accountId ? A.get(m.accountId) : null);
function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N} '._-]/gu, '').trim().slice(0, 16) || 'Ranger'; }
function seatOf(room, pid) { return room.game.players.findIndex(p => p.id === pid); }

// ---------- what each player is allowed to see ----------
function viewFor(room, member) {
  const s = room.game;
  const me = member ? seatOf(room, member.pid) : -1;
  const ended = s.phase === 'ended';
  const connected = new Set([...room.clients].map(c => c.pid));
  const base = {
    room: room.code, phase: s.phase, seq: s.seq,
    you: me, yourPid: member ? member.pid : null, isHost: !!member && member.pid === room.hostPid,
    tutorial: !!room.tutorial, public: !!room.public, turnTimer: timerOn(room), turnLimitMs: TURN_MS, maxStrikes: MAX_STRIKES,
    deadline: room.deadline ? { seats: room.deadline.seats, at: room.deadline.at } : null, serverNow: Date.now(),
    mode: room.mode || 'solo', partners: room.mode === 'partners', coop: room.mode === 'coop',
    disruptions: s.phase === 'lobby' ? !!room.disruptions : !!s.disruptions,
    speed: SPEEDS[room.speed] ? room.speed : 'normal', trickPauseMs: Math.round(pace(room).trick),
    buyIn: room.buyIn, buyIns: A.ECON.buyIns,
    lobby: room.members.map(m => {
      const a = memberAccount(m);
      return { pid: m.pid, name: a ? a.gamertag : m.name, bot: m.bot, team: m.team ?? null, host: m.pid === room.hostPid, online: m.bot || connected.has(m.pid), confirmed: m.bot || !!m.confirmed,
        profile: a ? A.publicProfile(a) : null, canAfford: m.bot || (a ? a.balance >= room.buyIn : false) };
    }),
    myAccount: memberAccount(member) ? A.privateProfile(memberAccount(member)) : null,
    unlocks: member ? member.unlocks : [], // animal profile pictures this player unlocked during the game
  };
  if (s.phase === 'lobby') return base;
  const myP = me >= 0 ? s.players[me] : null;
  const myTurn = me >= 0 && G.waitingOn(s) === me;
  return Object.assign(base, {
    players: s.players.map((p, i) => {
      const a = memberAccount(room.members.find(x => x.pid === p.id));
      return {
        name: p.name, bot: p.bot, boss: !!p.boss, team: p.team, handCount: p.hand.length, strikes: room.strikes[p.id] || 0, pileCount: p.pile.length, tricks: p.biomesWon.length,
        biomesWon: p.biomesWon, online: p.bot || connected.has(p.id),
        role: p.role, // roles are public
        skin: a && typeof p.role === 'string' ? A.skinFor(a, p.role) : null, // the look everyone sees for this player's character
        profile: a ? A.publicProfile(a) : null,
        splash: A.splashFor(a), // the splash effect everyone sees when this player plays a card
      };
    }),
    settlement: room.settlement, // Eco-buck payouts once the game is over
    travel: s.travel, deckCount: s.biomeDeck.length, board: s.board, trick: s.trick,
    leader: s.leader, turn: s.turn, waiting: G.waitingOn(s), round: s.round,
    lastTrick: s.lastTrick, log: s.log.slice(-40),
    chatter: room.chatter, // short in-character lines from bots: [{ id, seat, text }]
    reactions: room.reactions, // character portrait reactions: [{ id, seat, anim, pri }]
    step: s.step ? (s.step.type === 'dis' ? s.step // Disruption choices: nothing secret in them
      : { type: s.step.type, card: s.step.card, left: s.step.left, line: s.step.line, regions: s.step.regions }) : null,
    // Disruptions: your own cards and draft pack are private; others only show how many they hold / whether they decided
    dis: myP ? (myP.dis || []) : [],
    disCounts: s.players.map(p => (p.dis || []).length),
    ddraft: s.phase === 'ddraft' && s.ddraft ? { round: s.ddraft.round, pack: me >= 0 && me < s.np ? s.ddraft.packs[me] : [],
      picked: me >= 0 ? s.ddraft.picks[me] || null : null, waiting: G.pendingSimultaneous(s) } : null,
    dcommit: s.phase === 'disrupt' && s.dcommit ? { waiting: G.pendingSimultaneous(s),
      committed: Object.keys(s.dcommit.picks).filter(p => s.dcommit.picks[p]).map(Number), // face-down cards are visible on the table
      mine: me >= 0 && s.dcommit.picks[me] !== undefined ? (s.dcommit.picks[me] || 'pass') : null } : null,
    guide: s.guide ? { p: s.guide.p, options: s.guide.p === me ? s.guide.options : [] } : null, // Traveler's Guidebook choices
    myRisk: me >= 0 && s.trick ? G.riskFor(s, me) : null, // Take Bribes changes the Risk for one player
    // Liberation: its owner gets to look through the other scoring piles while choosing
    stealPiles: s.step && s.step.type === 'dis' && s.step.mode === 'steal' && s.step.p === me ? s.players.map((p, i) => i === me ? [] : p.pile) : null,
    hand: myP ? myP.hand : [], pile: myP ? myP.pile : [], role: myP ? myP.role : null,
    legal: myTurn && s.phase === 'play' && !s.step ? G.legalCards(s, me) : [],
    placeTargets: myTurn ? G.placeTargets(s) : [],
    abilityUsed: s.abilityUsed,
    availableRoles: s.phase === 'draft' ? G.availableRoles(s) : [], draftTurn: s.draftTurn,
    tourPeek: myTurn ? s.tourPeek : null,
    results: ended ? s.results : null,
  });
}

// ---------- character reactions ----------
function say(room, seat, text) {
  room.chatter.push({ id: ++room.chatId, seat, text });
  if (room.chatter.length > 12) room.chatter.shift();
}
// Turn new game events into portrait reactions (for every player) and the odd in-character bot line.
function drainEvents(room) {
  const s = room.game;
  const evs = (s.events || []).filter(e => e.id > room.evSeen);
  if (!evs.length) return;
  room.evSeen = evs[evs.length - 1].id;
  for (const ev of evs) {
    // a trick won with an animal card counts toward unlocking that animal's profile picture
    if (ev.type === 'trick' && s.players[ev.p] && !s.players[ev.p].bot && !room.tutorial) {
      const m = room.members.find(x => x.pid === s.players[ev.p].id);
      if (m && m.accountId) { const unlocked = A.recordCardWin(m.accountId, ev.card); if (unlocked) m.unlocks.push(unlocked); }
    }
    const list = G.reactionsFor(s, ev);
    for (const r of list) room.reactions.push({ id: ++room.reactId, seat: r.seat, anim: r.anim, pri: r.pri });
    const line = G.reactionLine(s, ev, list);
    if (line) say(room, line.seat, line.text);
  }
  if (room.reactions.length > 40) room.reactions.splice(0, room.reactions.length - 40);
}
function resetReactions(room) { room.reactions = []; room.evSeen = 0; }

// ---------- Eco-bucks: pay out a finished game ----------
function settleRoom(room) {
  const s = room.game;
  if (s.phase !== 'ended' || !room.gameId || room.settlement) return;
  const R = s.results;
  const people = s.players.map((p, seat) => ({ p, seat })).filter(x => !x.p.boss);
  const teamTotal = t => R.scores.filter(r => s.players[r.p].team === t).reduce((a, r) => a + r.total, 0);
  const ranked = people.map(({ p, seat }) => {
    const sc = R.scores.find(r => r.p === seat);
    const m = room.members.find(x => x.pid === p.id);
    return { seat, accountId: m ? m.accountId : null, score: R.teams ? teamTotal(p.team) : sc.total };
  });
  room.settlement = A.settle(room.gameId, ranked, { coop: !!R.coop, playersWin: !!R.playersWin });
  room.gameId = null;
}

function broadcast(room) {
  G.autoBots(room.game); // bots decide at once in the simultaneous parts, before everyone is told what's going on
  drainEvents(room);
  settleRoom(room);
  updateTurnTimer(room); // so the view carries the current turn's deadline
  room.touched = Date.now();
  for (const c of room.clients) {
    const m = room.members.find(x => x.pid === c.pid);
    c.res.write(`data: ${JSON.stringify(viewFor(room, m))}\n\n`);
  }
  scheduleBot(room);
}

// ---------- turn timer (see TURN_MS) ----------
const timerOn = room => !room.tutorial && (room.public || room.turnTimer !== false);
// The people the game is waiting on right now (bots never time out).
function humansPending(s) {
  if (!['draft', 'choose', 'play', 'disrupt', 'ddraft'].includes(s.phase)) return [];
  const w = G.waitingOn(s);
  if (w >= 0) return s.players[w] && !s.players[w].bot ? [w] : [];
  return G.pendingSimultaneous(s).filter(p => s.players[p] && !s.players[p].bot);
}
// What counts as "one turn": steps inside it (an ability, a hunt, placing tokens) don't restart the clock, and in the
// simultaneous parts (Disruption draft and commits) everyone shares one clock.
function turnKey(s, seats) {
  const simultaneous = G.waitingOn(s) < 0;
  return [s.phase, s.round, s.trick ? s.trick.pos : '-', s.draftTurn, s.ddraft ? s.ddraft.round : '', s.dqueue ? s.dqueue.length : '',
    simultaneous ? 'all' : seats.join(',')].join('|');
}
function clearDeadline(room) { if (room.deadlineTimer) clearTimeout(room.deadlineTimer); room.deadlineTimer = null; room.deadline = null; }
function updateTurnTimer(room) {
  const s = room.game, seats = timerOn(room) ? humansPending(s) : [];
  if (!seats.length) return clearDeadline(room);
  const key = turnKey(s, seats);
  if (room.deadline && room.deadline.key === key) { room.deadline.seats = seats; return; }
  clearDeadline(room);
  const at = Math.max(Date.now(), room.pauseUntil || 0) + TURN_MS; // the clock starts after the end-of-trick pause
  room.deadline = { key, seats, at };
  room.deadlineTimer = setTimeout(() => turnExpired(room, key), at - Date.now() + 100);
}
function turnExpired(room, key) {
  room.deadlineTimer = null;
  if (!room.deadline || room.deadline.key !== key) return;
  const s = room.game;
  room.deadline = null;
  for (const p of humansPending(s)) {
    const pl = s.players[p];
    const n = room.strikes[pl.id] = (room.strikes[pl.id] || 0) + 1;
    if (n >= MAX_STRIKES) { kickToBot(room, p); continue; }
    s.log.push(`${pl.name} ran out of time, so a bot played that turn for them (${n}/${MAX_STRIKES}).`);
    autoPlay(room, p);
  }
  broadcast(room);
}
// A bot finishes this player's current turn (they stay seated).
function autoPlay(room, p) {
  const s = room.game, pl = s.players[p];
  try {
    if (G.waitingOn(s) < 0) { pl.bot = true; G.autoBots(s); pl.bot = false; return; } // a draft pick or Disruption commit
    for (let g = 0; g < 60 && G.waitingOn(s) === p && !pl.bot; g++) G.applyAction(s, p, G.botAction(s, p));
  } catch (e) { pl.bot = false; console.error('auto-play error', e); }
}
// Third strike: the player is removed and a bot takes their seat for the rest of the game. Their buy-in stays in the
// pot and they get no payout (the house keeps the bot's winnings, as for every bot).
function kickToBot(room, p) {
  const s = room.game, pl = s.players[p];
  const oldPid = pl.id, name = pl.name;
  const bot = { token: rid(), pid: rid().slice(0, 8), name: cleanName(name).slice(0, 10) + ' (bot)', bot: true, accountId: null, unlocks: [] };
  room.members = room.members.filter(x => x.pid !== oldPid).concat([bot]);
  pl.id = bot.pid; pl.name = bot.name; pl.bot = true;
  if (room.hostPid === oldPid) room.hostPid = (room.members.find(x => !x.bot) || {}).pid || null;
  s.log.push(`${name} ran out of time ${MAX_STRIKES} times and was removed. A bot plays their seat now.`);
  for (const c of [...room.clients]) if (c.pid === oldPid) { // tell their browser, then hang up
    try { c.res.write(`event: kicked\ndata: ${JSON.stringify({ strikes: MAX_STRIKES })}\n\n`); c.res.end(); } catch (e) {}
    room.clients.delete(c);
  }
}

function scheduleBot(room) {
  const s = room.game;
  G.autoBots(s); // bots decide at once in the simultaneous parts (Disruption draft and commits)
  updateTurnTimer(room);
  if (!['draft', 'choose', 'play', 'disrupt'].includes(s.phase)) return;
  // a trick just finished: everyone sees the finished trick (winning card highlighted) for a moment.
  // Tracked even when a person moves next, so the pause isn't applied a second time later.
  const done = s.players.reduce((a, p) => a + p.biomesWon.length, 0);
  if (done !== room.tricksSeen) { room.tricksSeen = done; room.pauseUntil = Math.max(room.pauseUntil, Date.now() + pace(room).trick); }
  if (room.botTimer || room.hold) return;
  const w = G.waitingOn(s);
  if (w < 0 || !s.players[w].bot) return;
  const B = pace(room).bot;
  const base = s.step ? B * 0.4 : B * (0.8 + Math.random() * 0.4); // token-by-token steps go quicker
  const wait = Math.max(base, room.pauseUntil - Date.now());
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const w2 = G.waitingOn(s);
    if (w2 < 0 || !s.players[w2].bot || room.hold) return;
    try {
      const a = G.botAction(s, w2);
      const text = G.botSay(s, w2, a);
      G.applyAction(s, w2, a);
      if (text) say(room, w2, text);
    } catch (e) { console.error('bot error', e); return; }
    broadcast(room);
  }, wait);
}

// ---------- HTTP plumbing ----------
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
  });
}
// Google sign-in, full-page redirect version (used on iPhone, iPad and Safari, where the popup can get stuck on a
// blank white page). Google posts the sign-in here as a form. We check Google's anti-forgery token (the
// g_csrf_token cookie must match the posted field), verify the sign-in, then hand the new session to the game
// page and send the player back to the home page.
async function googleRedirect(req, res) {
  const page = (title, script, note) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<body style="margin:0;background:#2b2118;color:#fbf3df;font:18px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:16px">
<div><p>${note}</p><p><a href="/" style="color:#d6ad55">Back to Everglades</a></p></div>${script ? `<script>${script}</script>` : ''}</body>`);
  };
  try {
    const form = new URLSearchParams(await readRaw(req));
    const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
    const csrf = form.get('g_csrf_token');
    if (!csrf || csrf !== cookies.g_csrf_token) return page('Sign-in failed', '', 'That sign-in could not be checked. Please go back and try again.');
    const r = await A.googleLogin(form.get('credential'));
    A.dailyBonus(r.account);
    // the game keeps its session token in localStorage under eg_acct (see setSession in client.js)
    return page('Signing in…', `try{localStorage.setItem('eg_acct',${JSON.stringify(r.session)})}catch(e){}location.replace('/')`, 'Signed in! Taking you back to the game…');
  } catch (e) {
    if (!e.userError) console.error('google redirect sign-in', e);
    return page('Sign-in failed', '', esc(e.userError ? e.message : 'Something went wrong signing in. Please try again.'));
  }
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > 1e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };
// Caching: a file asked for with a version (?v=..., e.g. the character animations; see CHAR_ANIM in data.js) never
// changes under that address, so browsers may keep it for a year. Everything else is re-checked on every visit
// (a quick "not modified" answer when unchanged), so updated art reaches every device straight away.
function serveStatic(req, res) {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', ETag: etag,
      'Cache-Control': u.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    fs.readFile(file, (e2, buf) => {
      if (e2) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, headers); res.end(buf);
    });
  });
}

function auth(body) {
  const room = rooms.get(String(body.room || '').toUpperCase());
  if (!room) throw Object.assign(new Error('That room no longer exists.'), { userError: true, gone: true });
  const m = room.members.find(x => x.token === body.token);
  if (!m) throw Object.assign(new Error('You are not part of that room.'), { userError: true, gone: true });
  return { room, m };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const { room, m } = auth({ room: url.searchParams.get('room'), token: url.searchParams.get('token') });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const client = { pid: m.pid, res };
      room.clients.add(client);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); room.clients.delete(client); broadcast(room); });
      broadcast(room);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/auth/google') return googleRedirect(req, res);
    if (req.method === 'POST' && url.pathname === '/api/stripe/webhook') {
      // Stripe signs the exact bytes it sends, so this one reads the raw body (see payments.js)
      const raw = await readRaw(req);
      const [status, out] = P.webhook(raw, req.headers['stripe-signature']);
      return send(res, status, out);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readBody(req);
      const op = url.pathname.slice(5);
      // ---------- accounts ----------
      if (op === 'config') return send(res, 200, Object.assign(A.config(), { payments: P.publicConfig(), supportEmail: process.env.SUPPORT_EMAIL || '' }));
      // ---------- buying Eco-bucks (Stripe Checkout; see payments.js) ----------
      if (op === 'pay/checkout') {
        const a = A.requireAccount(body.session);
        const origin = `${String(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers.host}`;
        return send(res, 200, await P.createCheckout(a, body.pack, origin));
      }
      if (op === 'pay/confirm') {
        const a = A.requireAccount(body.session);
        const result = await P.confirm(a, body.sessionId);
        for (const r of rooms.values()) if (r.members.some(m => m.accountId === a.id)) broadcast(r); // wallet shows the new balance
        return send(res, 200, { me: A.privateProfile(a), result });
      }
      // signing in (or the first visit of the day, below) pays the daily log-in bonus
      if (op === 'auth/guest') { const r = A.guestLogin(body.deviceKey); const bonus = A.dailyBonus(r.account); return send(res, 200, { session: r.session, me: A.privateProfile(r.account), bonus }); }
      if (op === 'auth/google') { const r = await A.googleLogin(body.credential); const bonus = A.dailyBonus(r.account); return send(res, 200, { session: r.session, me: A.privateProfile(r.account), bonus, gift: r.gift || 0 }); }
      if (op === 'auth/signout') { A.signOut(body.session); return send(res, 200, { ok: true }); }
      if (op === 'me') {
        const a = A.bySession(body.session);
        if (!a) return send(res, 401, { error: 'Signed out.', needAuth: true });
        const bonus = A.dailyBonus(a);
        return send(res, 200, { me: A.privateProfile(a), bonus });
      }
      if (op === 'admin/gift') { // staff only: Eco-bucks to a gamertag, delivered to their mailbox at once
        const a = A.requireAccount(body.session);
        const r = A.giftByTag(a, body.tag, body.amount);
        for (const room of rooms.values()) if (room.members.some(m => m.accountId === r.accountId)) broadcast(room); // their envelope shows up straight away
        return send(res, 200, { to: r.to, amount: r.amount });
      }
      if (op === 'mail/open') { // open a letter (or 'all') and collect its Eco-bucks
        const a = A.requireAccount(body.session);
        const r = A.openMail(a, body.id);
        for (const room of rooms.values()) if (room.members.some(m => m.accountId === a.id)) broadcast(room);
        return send(res, 200, Object.assign(r, { me: A.privateProfile(a) }));
      }
      if (op === 'profile') {
        const a = A.requireAccount(body.session);
        A.setProfile(a, { gamertag: body.gamertag, avatar: body.avatar, title: body.title, skin: body.skin, splash: body.splash });
        // update lobby banners, and the portraits of anyone already at a table (a skin change shows straight away)
        for (const r of rooms.values()) if (r.members.some(m => m.accountId === a.id)) broadcast(r);
        return send(res, 200, { me: A.privateProfile(a) });
      }
      if (op === 'store/buy') {
        const a = A.requireAccount(body.session);
        const item = A.buy(a, body.item);
        // a new title or skin is worn straight away: refresh the tables this player is sitting at
        for (const r of rooms.values()) if (r.members.some(m => m.accountId === a.id)) broadcast(r);
        return send(res, 200, { me: A.privateProfile(a), item });
      }
      // ---------- tables (you need an account to sit down) ----------
      if (op === 'create') {
        const account = A.requireAccount(body.session);
        const room = newRoom();
        const m = addMember(room, null, false, account);
        return send(res, 200, { room: room.code, token: m.token });
      }
      if (op === 'tutorial') {
        // A private practice table: you and two gentle bots, no buy-in or payouts, the coach runs in the browser.
        const account = A.requireAccount(body.session);
        const room = newRoom();
        room.tutorial = true; room.buyIn = 0;
        const m = addMember(room, null, false, account);
        addMember(room, 'Heron Bot', true); addMember(room, 'Otter Bot', true);
        room.game = G.newGame();
        for (const x of room.members) G.addPlayer(room.game, { id: x.pid, name: x.bot ? x.name : cleanName(account.gamertag), bot: x.bot, simple: x.bot });
        G.startGame(room.game, { tutorial: true });
        room.hold = true; // the coach's welcome is on screen first
        return send(res, 200, { room: room.code, token: m.token });
      }
      if (op === 'quickjoin') {
        // Join a random public table that's still in its lobby, has room, has someone there, and whose buy-in you can
        // cover. If there isn't one, start a new public table with you as host.
        const account = A.requireAccount(body.session);
        const open = [...rooms.values()].filter(r => r.public && !r.tutorial && r.game.phase === 'lobby' && r.members.length < G.MAX_PLAYERS
          && r.clients.size > 0 && account.balance >= r.buyIn && !r.members.some(x => x.accountId === account.id));
        if (open.length) {
          const room = open[Math.floor(Math.random() * open.length)];
          const m = addMember(room, null, false, account);
          broadcast(room);
          return send(res, 200, { room: room.code, token: m.token, created: false });
        }
        const room = newRoom();
        room.public = true;
        const m = addMember(room, null, false, account);
        return send(res, 200, { room: room.code, token: m.token, created: true });
      }
      if (op === 'join') {
        const account = A.requireAccount(body.session);
        const room = rooms.get(String(body.room || '').toUpperCase().trim());
        if (!room) return send(res, 400, { error: 'No room with that code.' });
        const already = room.members.find(x => x.accountId === account.id);
        if (already) return send(res, 200, { room: room.code, token: already.token }); // e.g. a second tab
        if (account.balance < room.buyIn) return send(res, 400, { error: `This table's buy-in is ${room.buyIn} EB, and you have ${account.balance} EB.` });
        const m = addMember(room, null, false, account);
        broadcast(room);
        return send(res, 200, { room: room.code, token: m.token });
      }
      const { room, m } = auth(body);
      const s = room.game;
      const isHost = m.pid === room.hostPid;
      if (op === 'lobby') {
        if (body.cmd === 'team' && s.phase === 'lobby') {
          // Anyone can pick their own team; the host can also place other players and bots.
          const target = room.members.find(x => x.pid === (body.pid || m.pid));
          if (!target || (target !== m && !isHost)) return send(res, 403, { error: 'You can only choose your own team.' });
          const t = body.team === null || body.team === undefined ? null : Math.max(0, Math.min(2, +body.team));
          if (t !== null && room.members.filter(x => x !== target && x.team === t).length >= 2) return send(res, 400, { error: 'That team already has 2 players.' });
          target.team = t;
        } else if (body.cmd === 'speed') {
          // Bot speed: host only, any time (also mid-game)
          if (!isHost) return send(res, 403, { error: 'Only the host can change the speed.' });
          room.speed = SPEEDS[body.speed] ? body.speed : 'normal';
          if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; } // re-time the pending bot move
        } else if (body.cmd === 'confirm' && s.phase === 'lobby') {
          // each person confirms the table's Eco-buck bid (buy-in) before the game can start
          if (body.on) {
            const a = memberAccount(m);
            if (!a || a.balance < room.buyIn) return send(res, 400, { error: `You need ${room.buyIn} EB to confirm this bid.` });
          }
          m.confirmed = !!body.on;
        } else if (body.cmd === 'visibility' && s.phase === 'lobby') {
          // public tables can be joined by anyone (Join a random public table); private ones only with the code
          if (!isHost) return send(res, 403, { error: 'Only the host can change that.' });
          room.public = !!body.public;
          if (room.public) room.turnTimer = true; // public tables always use the turn timer
        } else if (body.cmd === 'timer' && s.phase === 'lobby') {
          if (!isHost) return send(res, 403, { error: 'Only the host can change that.' });
          if (room.public && !body.on) return send(res, 400, { error: 'Public tables always use the turn timer.' });
          room.turnTimer = !!body.on;
        } else if (body.cmd === 'hold' && room.tutorial) {
          // Tutorial: the bots wait while the coach is explaining something
          room.hold = !!body.on;
        } else if (body.cmd === 'leave' && s.phase === 'lobby') {
          room.members = room.members.filter(x => x !== m);
          if (isHost) room.hostPid = (room.members.find(x => !x.bot) || {}).pid || null;
        } else {
          if (!isHost) return send(res, 403, { error: 'Only the host can do that.' });
          if (body.cmd === 'addBot') {
            const used = new Set(room.members.map(x => x.name));
            addMember(room, BOT_NAMES.find(n => !used.has(n)) || 'Bot', true);
          } else if (body.cmd === 'remove' && s.phase === 'lobby') {
            room.members = room.members.filter(x => x.pid !== body.pid || x.pid === room.hostPid);
          } else if (body.cmd === 'buyin' && s.phase === 'lobby') {
            // Eco-buck buy-in for this table (every player pays it when the game starts)
            if (!A.ECON.buyIns.includes(+body.amount)) return send(res, 400, { error: 'Pick one of the buy-in amounts.' });
            if (room.buyIn !== +body.amount) unconfirmAll(room); // a new bid has to be confirmed again
            room.buyIn = +body.amount;
          } else if (body.cmd === 'disruptions' && s.phase === 'lobby') {
            // the Disruptions match modifier (host only)
            if (!isHost) return send(res, 403, { error: 'Only the host can change match modifiers.' });
            room.disruptions = !!body.on;
          } else if (body.cmd === 'mode' && s.phase === 'lobby') {
            // 'solo' = everyone for themselves, 'partners' = teams of 2, 'coop' = everyone vs The Anaconda
            const mode = ['solo', 'partners', 'coop'].includes(body.mode) ? body.mode : 'solo';
            if ((room.mode || 'solo') !== mode) unconfirmAll(room); // the mode changes how the pot is paid out
            room.mode = mode;
          } else if (body.cmd === 'start') {
            if (s.phase !== 'lobby') return send(res, 400, { error: 'Already started.' });
            const unconfirmed = room.members.filter(x => !x.bot && !x.confirmed);
            if (unconfirmed.length) return send(res, 400, { error: `Waiting for ${unconfirmed.map(x => x.name).join(', ')} to confirm the ${room.buyIn} EB bid.` });
            // Always play with at least 4: fill empty seats with bots.
            while (room.members.length < MIN_TABLE) {
              const used = new Set(room.members.map(x => x.name));
              addMember(room, BOT_NAMES.find(n => !used.has(n)) || 'Bot', true);
            }
            if (room.mode === 'partners') {
              // Partner mode needs an even table: add a bot if someone would be left without a partner.
              if (room.members.length % 2) {
                if (room.members.length >= G.MAX_PLAYERS) return send(res, 400, { error: 'Partner mode needs an even number of players.' });
                const used = new Set(room.members.map(x => x.name));
                addMember(room, BOT_NAMES.find(n => !used.has(n)) || 'Bot', true);
              }
              const T = room.members.length / 2;
              for (const x of room.members) if (x.team !== null && x.team >= T) x.team = null;
              // Anyone without a team is paired at random (people before bots).
              const open = () => [...Array(T).keys()].filter(t => room.members.filter(x => x.team === t).length < 2);
              const loose = room.members.filter(x => x.team === null || x.team === undefined)
                .sort((a, b) => (a.bot - b.bot) || (Math.random() - 0.5));
              for (const x of loose) { const o = open(); x.team = o[Math.floor(Math.random() * o.length)]; }
            }
            // Take everyone's buy-in (held until the game is settled). Fails if anyone can't cover it.
            const people = room.members.filter(x => !x.bot && x.accountId);
            const gameId = room.code + ':' + Date.now();
            A.takeBuyIns(gameId, people.map(x => x.accountId), room.buyIn);
            room.gameId = gameId; room.settlement = null;
            for (const x of people) x.name = cleanName(memberAccount(x).gamertag);
            room.game = G.newGame();
            for (const x of room.members) G.addPlayer(room.game, { id: x.pid, name: x.name, bot: x.bot, team: room.mode === 'partners' ? x.team : null });
            G.startGame(room.game, { partners: room.mode === 'partners', coop: room.mode === 'coop', disruptions: !!room.disruptions });
            room.chatter = []; room.tricksSeen = 0; resetReactions(room); room.strikes = {}; clearDeadline(room);
            room.pauseUntil = Date.now() + DEAL_PAUSE_MS; // let the shuffle-and-deal animation play first
          } else if (body.cmd === 'botify') {
            // Hand a seat to a bot (e.g. someone left mid-game).
            const i = seatOf(room, body.pid);
            if (i >= 0) { s.players[i].bot = true; s.players[i].name += ' (bot)'; const x = room.members.find(y => y.pid === body.pid); if (x) x.bot = true; }
          } else if (body.cmd === 'rematch') {
            if (room.gameId) { A.refundEscrow(room.gameId); room.gameId = null; } // abandoned before the end: refund
            room.game = G.newGame(); resetReactions(room); room.settlement = null; room.strikes = {}; clearDeadline(room); unconfirmAll(room);
            for (const x of room.members) x.unlocks = [];
          } else return send(res, 400, { error: 'Unknown command.' });
        }
        broadcast(room);
        return send(res, 200, { ok: true });
      }
      if (op === 'chat') {
        // a preset chat line the player owns, shown as a speech bubble over their seat for everyone
        const seat = seatOf(room, m.pid);
        if (seat < 0 || s.phase === 'lobby') return send(res, 400, { error: 'Chat lines can be sent during a game.' });
        const line = CHAT.find(c => c.id === body.line);
        if (!line || !A.ownsChat(memberAccount(m), line.id)) return send(res, 400, { error: "You don't own that chat line." });
        const now = Date.now();
        if (now - (m.lastChat || 0) < CHAT_COOLDOWN_MS) return send(res, 429, { error: 'Slow down a little!' });
        m.lastChat = now;
        say(room, seat, line.text);
        broadcast(room);
        return send(res, 200, { ok: true });
      }
      if (op === 'act') {
        const seat = seatOf(room, m.pid);
        if (seat < 0) return send(res, 400, { error: 'You are not seated in this game.' });
        G.applyAction(s, seat, body.action || {});
        broadcast(room);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'Unknown request.' });
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405); res.end();
  } catch (e) {
    if (e.needAuth) return send(res, 401, { error: e.message, needAuth: true });
    if (e.userError) return send(res, e.gone ? 410 : 400, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on the server.' });
  }
});

// Forget rooms nobody has touched for 6 hours (refunding any buy-ins of a game that never finished).
setInterval(() => {
  for (const [c, r] of rooms) if (Date.now() - r.touched > 6 * 3600e3 && r.clients.size === 0) {
    if (r.gameId) A.refundEscrow(r.gameId);
    rooms.delete(c);
  }
}, 600e3);

// Save accounts before shutting down (hosts send SIGTERM before a restart or redeploy).
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
  try { await Promise.race([A.flush(), new Promise(r => setTimeout(r, 8000))]); } finally { process.exit(0); }
});

// Load the accounts first (from Upstash or the local file), then open the doors.
A.ready.then(() => {
  A.refundAllEscrows(); // buy-ins of games cut short by a restart go back to their players
  server.listen(PORT, listening);
}).catch(e => {
  console.error('\n  Could not load player accounts:', e.message, '\n  Check the UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN settings.\n');
  process.exit(1); // better to stop than to start with empty wallets and overwrite everyone's data
});

function listening() {
  console.log('\n  EVERGLADES is running!\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  Same Wi-Fi friends: http://${a.address}:${PORT}`);
  }
  console.log(`\n  Player accounts are saved to: ${A.storeName()}`);
  console.log('  Keep this window open while you play. Close it to stop the server.\n');
}
