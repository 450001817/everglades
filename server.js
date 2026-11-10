// Everglades — multiplayer web server.
// No installs needed: uses only what ships with Node.js.
// Run:  node server.js     then open http://localhost:3000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const G = require('./game.js');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const BOT_DELAY_MS = +process.env.BOT_DELAY_MS || 1100;
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
  const room = { code: code(), members: [], hostPid: null, game: G.newGame(), clients: new Set(), touched: Date.now(), botTimer: null };
  rooms.set(room.code, room);
  return room;
}

function addMember(room, name, bot = false) {
  if (room.game.phase !== 'lobby') throw Object.assign(new Error('That game has already started.'), { userError: true });
  if (room.members.length >= G.MAX_PLAYERS) throw Object.assign(new Error('That table is full.'), { userError: true });
  const m = { token: rid(), pid: rid().slice(0, 8), name: cleanName(name), bot };
  room.members.push(m);
  if (!room.hostPid && !bot) room.hostPid = m.pid;
  return m;
}
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
    lobby: room.members.map(m => ({ pid: m.pid, name: m.name, bot: m.bot, host: m.pid === room.hostPid, online: m.bot || connected.has(m.pid) })),
  };
  if (s.phase === 'lobby') return base;
  const myP = me >= 0 ? s.players[me] : null;
  const myTurn = me >= 0 && G.waitingOn(s) === me;
  return Object.assign(base, {
    players: s.players.map((p, i) => ({
      name: p.name, bot: p.bot, handCount: p.hand.length, pileCount: p.pile.length, tricks: p.biomesWon.length,
      biomesWon: p.biomesWon, online: p.bot || connected.has(p.id),
      role: p.role, // roles are public
    })),
    travel: s.travel, deckCount: s.biomeDeck.length, board: s.board, trick: s.trick,
    leader: s.leader, turn: s.turn, waiting: G.waitingOn(s), round: s.round,
    lastTrick: s.lastTrick, log: s.log.slice(-40),
    step: s.step ? { type: s.step.type, card: s.step.card, left: s.step.left, line: s.step.line, regions: s.step.regions } : null,
    hand: myP ? myP.hand : [], pile: myP ? myP.pile : [], role: myP ? myP.role : null,
    legal: myTurn && s.phase === 'play' && !s.step ? G.legalCards(s, me) : [],
    placeTargets: myTurn ? G.placeTargets(s) : [],
    abilityUsed: s.abilityUsed,
    availableRoles: s.phase === 'draft' ? G.availableRoles(s) : [], draftTurn: s.draftTurn,
    tourPeek: myTurn ? s.tourPeek : null,
    results: ended ? s.results : null,
  });
}

function broadcast(room) {
  room.touched = Date.now();
  for (const c of room.clients) {
    const m = room.members.find(x => x.pid === c.pid);
    c.res.write(`data: ${JSON.stringify(viewFor(room, m))}\n\n`);
  }
  scheduleBot(room);
}

function scheduleBot(room) {
  const s = room.game;
  if (room.botTimer || !['draft', 'choose', 'play'].includes(s.phase)) return;
  const w = G.waitingOn(s);
  if (w < 0 || !s.players[w].bot) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const w2 = G.waitingOn(s);
    if (w2 < 0 || !s.players[w2].bot) return;
    try { G.applyAction(s, w2, G.botAction(s, w2)); } catch (e) { console.error('bot error', e); return; }
    broadcast(room);
  }, BOT_DELAY_MS);
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
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.png' || ext === '.ttf' ? 'public, max-age=86400' : 'no-cache' });
    res.end(buf);
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
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const body = await readBody(req);
      const op = url.pathname.slice(5);
      if (op === 'create') {
        const room = newRoom();
        const m = addMember(room, body.name);
        return send(res, 200, { room: room.code, token: m.token });
      }
      if (op === 'join') {
        const room = rooms.get(String(body.room || '').toUpperCase().trim());
        if (!room) return send(res, 400, { error: 'No room with that code.' });
        const m = addMember(room, body.name);
        broadcast(room);
        return send(res, 200, { room: room.code, token: m.token });
      }
      const { room, m } = auth(body);
      const s = room.game;
      const isHost = m.pid === room.hostPid;
      if (op === 'lobby') {
        if (body.cmd === 'leave' && s.phase === 'lobby') {
          room.members = room.members.filter(x => x !== m);
          if (isHost) room.hostPid = (room.members.find(x => !x.bot) || {}).pid || null;
        } else {
          if (!isHost) return send(res, 403, { error: 'Only the host can do that.' });
          if (body.cmd === 'addBot') {
            const used = new Set(room.members.map(x => x.name));
            addMember(room, BOT_NAMES.find(n => !used.has(n)) || 'Bot', true);
          } else if (body.cmd === 'remove' && s.phase === 'lobby') {
            room.members = room.members.filter(x => x.pid !== body.pid || x.pid === room.hostPid);
          } else if (body.cmd === 'start') {
            if (s.phase !== 'lobby') return send(res, 400, { error: 'Already started.' });
            // Always play with at least 4: fill empty seats with bots.
            while (room.members.length < MIN_TABLE) {
              const used = new Set(room.members.map(x => x.name));
              addMember(room, BOT_NAMES.find(n => !used.has(n)) || 'Bot', true);
            }
            room.game = G.newGame();
            for (const x of room.members) G.addPlayer(room.game, { id: x.pid, name: x.name, bot: x.bot });
            G.startGame(room.game);
          } else if (body.cmd === 'botify') {
            // Hand a seat to a bot (e.g. someone left mid-game).
            const i = seatOf(room, body.pid);
            if (i >= 0) { s.players[i].bot = true; s.players[i].name += ' (bot)'; const x = room.members.find(y => y.pid === body.pid); if (x) x.bot = true; }
          } else if (body.cmd === 'rematch') {
            room.game = G.newGame();
          } else return send(res, 400, { error: 'Unknown command.' });
        }
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
    if (e.userError) return send(res, e.gone ? 410 : 400, { error: e.message });
    console.error(e);
    send(res, 500, { error: 'Something went wrong on the server.' });
  }
});

// Forget rooms nobody has touched for 6 hours.
setInterval(() => {
  for (const [c, r] of rooms) if (Date.now() - r.touched > 6 * 3600e3 && r.clients.size === 0) rooms.delete(c);
}, 600e3);

server.listen(PORT, () => {
  console.log('\n  EVERGLADES is running!\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  Same Wi-Fi friends: http://${a.address}:${PORT}`);
  }
  console.log('\n  Keep this window open while you play. Close it to stop the server.\n');
});
