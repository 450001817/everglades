// Everglades — browser client. Renders whatever the server says the game looks like.
'use strict';
const { CARDS, REGIONS, BIOMES, ROLES, BOSS, CHAR_ANIM } = window.EG_DATA;
const roleInfo = r => r === 'Anaconda' ? BOSS : (r ? ROLES[r] : null);
const $app = document.getElementById('app');
const $peek = document.getElementById('peek');
const $toast = document.getElementById('toast');

let S = null;               // latest game view from the server
let es = null;              // live connection
let sess = loadSess();      // { room, token }
const ui = { dealing: false, handIntro: 0, chatSeen: 0, reactSeen: 0, bubbles: {}, confirm: null, showLog: false, unread: 0, sel: null, mode: null, swapHand: null, swapPile: null, err: '', lastRound: null, showRules: false, fresh: null };

const ACTIVE_ABILITY = {
  Fisherman: 'Swap with scoring pile (Water)',
  Hunter: 'Swap with scoring pile (Land)',
  Researcher: 'Swap with scoring pile',
  LandDeveloper: 'Remove a token',
  Tourist: 'Peek at location deck',
};
const SUIT_ORDER = { Water: 0, Wetland: 1, Land: 2 };
// Bot speed (set by the host; the server does the pacing)
const SPEED_ORDER = ['slow', 'normal', 'fast'];
const SPEED_LABEL = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };
// The finished trick stays on screen (winning card highlighted) until this time.
const holding = () => !!(ui.trickHold && Date.now() < ui.trickHold.until && S && S.lastTrick);

// ---------- map geometry (board art is 1926 x 1932 in these units) ----------
// poly = region outline, label = where its name is printed, sum = where the N/I counter sits (just under the name)
const GEO = {
  FSP: { poly: [[300, 0], [980, 0], [980, 220], [1110, 350], [655, 455], [610, 410], [530, 320], [380, 320], [300, 220]], label: [450, 75, 800, 205], sum: [625, 250] },
  LO: { poly: [[980, 0], [1640, 0], [1640, 90], [1510, 215], [1510, 350], [1110, 350], [1000, 220], [980, 220]], label: [1110, 30, 1420, 170], sum: [1265, 215] },
  M: { poly: [[1640, 0], [1926, 0], [1926, 870], [1510, 870], [1520, 700], [1560, 450], [1510, 350], [1510, 215], [1640, 90]], label: [1730, 765, 1890, 820], sum: [1800, 712] }, // counter sits above the name, inside the region
  BCNP: { poly: [[655, 455], [1110, 350], [1510, 350], [1560, 450], [1520, 700], [1510, 870], [900, 870], [870, 820], [655, 820]], label: [845, 550, 1400, 685], sum: [1122, 730] },
  NG: { poly: [[0, 0], [300, 0], [300, 220], [380, 320], [530, 320], [610, 410], [655, 455], [655, 820], [640, 820], [0, 680]], label: [50, 430, 405, 495], sum: [228, 540] },
  SG: { poly: [[0, 680], [640, 820], [870, 820], [900, 870], [895, 1415], [450, 1415], [0, 1340]], label: [145, 1060, 525, 1120], sum: [335, 1165] },
  ENP: { poly: [[900, 870], [1660, 870], [1660, 1000], [1475, 1330], [1100, 1415], [975, 1415], [895, 1300]], label: [985, 1060, 1520, 1195], sum: [1252, 1240] },
  FK: { poly: [[450, 1415], [1100, 1415], [1475, 1330], [1475, 1932], [450, 1932]], label: [930, 1590, 1250, 1650], sum: [1090, 1695] },
  KW: { poly: [[0, 1340], [450, 1415], [450, 1932], [0, 1932]], label: [65, 1745, 310, 1810], sum: [190, 1855] },
  KL: { poly: [[1660, 870], [1926, 870], [1926, 1932], [1475, 1932], [1475, 1330], [1660, 1000]], label: [1625, 1610, 1890, 1675], sum: [1757, 1720] },
};
const BW = 1926, BH = 1932, TOK = 40; // token square size in board units

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function rng(seed) { let a = 0; for (const c of seed) a = (a * 31 + c.charCodeAt(0)) | 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Fixed scatter spots per region, so each token keeps its place as more arrive.
const SPOTS = {};
for (const [id, g] of Object.entries(GEO)) {
  const r = rng(id), pts = [];
  const xs = g.poly.map(p => p[0]), ys = g.poly.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const [lx0, ly0, lx1, ly1] = g.label, [sx, sy] = g.sum;
  const blocked = (x, y) => (x > lx0 - 30 && x < lx1 + 30 && y > ly0 - 30 && y < ly1 + 30) || (Math.abs(x - sx) < 120 && Math.abs(y - sy) < 55);
  let minD = 66;
  for (let tries = 0; pts.length < 90 && tries < 30000; tries++) {
    if (tries % 6000 === 5999) minD *= 0.8;
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
    const h = TOK / 2 + 6;
    if (!(inPoly(x - h, y - h, g.poly) && inPoly(x + h, y - h, g.poly) && inPoly(x - h, y + h, g.poly) && inPoly(x + h, y + h, g.poly))) continue;
    if (x < 20 || y < 20 || x > BW - 20 || y > BH - 20 || blocked(x, y)) continue;
    if (pts.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 < minD * minD)) continue;
    pts.push([x, y]);
  }
  SPOTS[id] = pts;
}

// ---------- 8-bit sound effects (made on the fly, no files needed) ----------
let AC = null;
let muted = (() => { try { return localStorage.getItem('eg_mute') === '1'; } catch { return false; } })();
function audio() {
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, { type = 'square', vol = 0.06, at = 0, to = null } = {}) {
  if (muted) return;
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + at;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
const notes = (list, step, opt) => list.forEach((f, i) => tone(f, step * 1.2, Object.assign({ at: i * step }, opt)));
const SFX = {
  click: () => tone(1250, 0.03, { vol: 0.03 }),
  card: () => { tone(700, 0.05, { to: 300, vol: 0.05 }); tone(180, 0.06, { type: 'triangle', at: 0.03, vol: 0.08 }); },
  travel: () => tone(260, 0.28, { type: 'triangle', to: 900, vol: 0.09 }),
  place: () => tone(980, 0.04, { vol: 0.04 }),
  remove: () => tone(240, 0.12, { type: 'sawtooth', to: 70, vol: 0.06 }),
  yourTurn: () => notes([659, 988], 0.09, { vol: 0.05 }),
  trick: () => notes([523, 659, 784], 0.07, { vol: 0.05 }),
  trickMine: () => notes([523, 659, 784, 1047], 0.08, { vol: 0.06 }),
  crisis: () => { tone(330, 0.5, { type: 'sawtooth', to: 55, vol: 0.08 }); tone(311, 0.5, { type: 'square', to: 52, vol: 0.04, at: 0.05 }); },
  error: () => tone(140, 0.14, { vol: 0.06 }),
  start: () => notes([392, 523, 659, 784], 0.09, { type: 'triangle', vol: 0.09 }),
  chat: () => tone(1500, 0.04, { type: 'triangle', vol: 0.03 }),
  end: () => notes([523, 659, 784, 1047, 784, 1047, 1319], 0.12, { vol: 0.06 }),
};
document.addEventListener('pointerdown', () => audio(), { once: true });
document.addEventListener('click', e => { if (e.target.closest('.btn')) SFX.click(); }, true);

// ---------- utilities ----------
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function loadSess() { try { return JSON.parse(localStorage.getItem('eg_sess')) || null; } catch { return null; } }
function saveSess(v) { sess = v; try { v ? localStorage.setItem('eg_sess', JSON.stringify(v)) : localStorage.removeItem('eg_sess'); } catch {} }
function savedName() { try { return localStorage.getItem('eg_name') || ''; } catch { return ''; } }
function saveName(n) { try { localStorage.setItem('eg_name', n); } catch {} }

async function api(op, body) {
  const r = await fetch('/api/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, sess, body)) });
  const j = await r.json().catch(() => ({ error: 'Network error.' }));
  if (r.status === 410) { leave('That game is no longer on the server.'); throw new Error(j.error); }
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
async function act(action) {
  try { await api('act', { action }); ui.err = ''; }
  catch (e) { SFX.error(); showToast(esc(e.message)); }
}
async function lobby(cmd, extra) {
  try { await api('lobby', Object.assign({ cmd }, extra)); }
  catch (e) { SFX.error(); showToast(esc(e.message)); }
}

let toastTimer = null;
function showToast(html, crisis = false, ms = 3200) {
  $toast.innerHTML = html; $toast.className = 'toast' + (crisis ? ' crisis' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.add('hidden'), ms);
}

// ---------- hover (or press-and-hold) for 1 second to read any card ----------
let peekTimer = null, peekSrc = null;
function showPeek(src) { $peek.innerHTML = `<img src="${src}" alt="">`; $peek.classList.remove('hidden'); }
function hidePeek() { clearTimeout(peekTimer); peekTimer = null; peekSrc = null; $peek.classList.add('hidden'); }
function armPeek(src) {
  if (src === peekSrc) return;
  hidePeek(); peekSrc = src;
  peekTimer = setTimeout(() => showPeek(src), 1000);
}
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-peek]');
  if (el) armPeek(el.dataset.peek); else if (peekSrc) hidePeek();
});
document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  const el = e.target.closest('[data-peek]');
  if (el) armPeek(el.dataset.peek);
});
document.addEventListener('pointerup', e => { if (e.pointerType === 'touch') hidePeek(); });
document.addEventListener('pointercancel', hidePeek);
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-peek]')) e.preventDefault(); });
document.addEventListener('click', e => { if (ui.showLog && S && !e.target.closest('.notes-wrap')) { ui.showLog = false; render(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hidePeek(); if (ui.confirm) { ui.confirm = null; render(); } if (ui.showLog) { ui.showLog = false; render(); } if (ui.showRules) { ui.showRules = false; render(); } } });

// ---------- connection ----------
function connect() {
  if (es) es.close();
  if (!sess) return render();
  es = new EventSource(`/api/events?room=${encodeURIComponent(sess.room)}&token=${encodeURIComponent(sess.token)}`);
  es.onmessage = ev => { const prev = S; S = JSON.parse(ev.data); onUpdate(prev); render(); };
  es.onerror = async () => { try { await api('lobby', { cmd: 'ping' }); } catch (e) { /* api() handles a vanished room */ } };
}
function leave(msg) {
  if (es) es.close(); es = null; S = null; saveSess(null); hidePeek();
  ui.err = msg || ''; history.replaceState(null, '', location.pathname);
  render();
}
const boardTotal = b => Object.values(b).reduce((a, t) => a + t.n + t.i, 0);

function onUpdate(prev) {
  if (!S || S.phase === 'lobby') { ui.lastRound = null; return; }
  if (S.waiting !== S.you || (S.step && ui.mode)) ui.mode = null;
  if (S.waiting !== S.you || S.phase !== 'play' || S.step) ui.confirm = null;
  if (S.hand && ui.sel && !S.hand.includes(ui.sel)) ui.sel = null;
  const live = prev && prev.phase !== 'lobby' && prev.board;

  // count field notes written while the dropdown is closed
  if (live && prev.log && S.log) {
    const last = prev.log[prev.log.length - 1];
    const at = S.log.lastIndexOf(last);
    const added = at >= 0 ? S.log.length - 1 - at : S.log.length;
    if (!ui.showLog) ui.unread = (ui.unread || 0) + added;
  }
  // which tokens just arrived (they drop in)
  if (live) {
    ui.fresh = {};
    for (const r of Object.keys(S.board)) ui.fresh[r] = { n: prev.board[r].n, i: prev.board[r].i };
  }

  // sounds
  // bot speech bubbles (only lines that arrive while you're watching)
  const chat = S.chatter || [];
  const fresh = live || (prev && prev.phase === 'lobby');
  for (const c of chat) {
    if (c.id <= ui.chatSeen) continue;
    if (fresh) { ui.bubbles[c.seat] = { text: c.text, until: Date.now() + 4200, id: c.id }; SFX.chat(); }
  }
  if (chat.length) ui.chatSeen = Math.max(ui.chatSeen, chat[chat.length - 1].id);
  if (!chat.length) ui.chatSeen = 0;
  // character reactions (the server decides who reacts to what; see reactionsFor in game.js)
  const reacts = S.reactions || [];
  for (const r of reacts) if (r.id > ui.reactSeen && fresh) react(r.seat, r.anim, r.pri);
  if (reacts.length) ui.reactSeen = Math.max(ui.reactSeen, reacts[reacts.length - 1].id);
  // learn which characters are at the table so their animations are loaded before they're needed
  for (const p of S.players || []) if (p.role && !p.boss) preloadChar(p.role);
  // the game just started: shuffle and deal
  if (prev && prev.phase === 'lobby' && S.phase === 'draft') { ui.dealing = true; ui.chatSeen = 0; setTimeout(playDeal, 60); }
  if (prev && prev.phase === 'lobby') SFX.start();
  if (live) {
    const lt = S.lastTrick, key = lt ? lt.round + ':' + lt.biome : null;
    const newTrick = key && key !== ui.lastRound;
    if (S.phase === 'ended' && prev.phase !== 'ended') setTimeout(SFX.end, 700);
    if (prev.phase === 'choose' && S.phase === 'play') SFX.travel();
    if (prev.phase === 'draft' && S.players.filter(p => p.role).length > prev.players.filter(p => p.role).length) SFX.trick();
    const prevPlays = prev.trick ? prev.trick.plays.length : 0;
    if ((S.trick && S.trick.plays.length > prevPlays) || (newTrick && prevPlays < S.players.length)) SFX.card();
    const d = boardTotal(S.board) - boardTotal(prev.board);
    if (d > 0) SFX.place(); else if (d < 0 && !(newTrick && lt.crisis)) SFX.remove();
    if (newTrick) setTimeout(() => lt.crisis ? SFX.crisis() : (lt.winner === S.you ? SFX.trickMine() : SFX.trick()), 250);
    if (S.waiting === S.you && prev.waiting !== S.you && S.phase !== 'ended') setTimeout(SFX.yourTurn, newTrick ? 900 : 300);
  }

  // trick result banner
  const lt = S.lastTrick;
  const key = lt ? lt.round + ':' + lt.biome : null;
  if (live && key && key !== ui.lastRound) {
    // hold the finished trick on screen before the next round (the server pauses the bots just as long)
    const ms = S.trickPauseMs || 4000;
    ui.trickHold = { key, start: Date.now(), until: Date.now() + ms, ms };
    clearTimeout(ui.holdTimer); ui.holdTimer = setTimeout(render, ms + 30);
    // the finished trick is shown in the play area; a crisis also gets a red banner
    const w = S.players[lt.winner];
    if (lt.crisis) showToast(`${esc(w.name)} wins ${esc(BIOMES[lt.biome].name)} with ${esc(CARDS[lt.card].name)}!` +
      '<small>INVASIVE CRISIS — native populations fall!</small>', true, Math.max(4200, ms));
  }
  ui.lastRound = key;
}

// ---------- screens ----------
function render() {
  if (!sess) return renderLanding();
  if (!S) { $app.innerHTML = `<div class="landing"><div class="paper spiral landing-card"><p class="tagline">Paddling out to the Everglades…</p></div></div>`; return; }
  if (S.phase === 'lobby') return renderLobby();
  renderGame();
}

function renderLanding() {
  const qRoom = new URLSearchParams(location.search).get('room') || '';
  $app.innerHTML = `
  <div class="landing">
    <div class="paper spiral landing-card stack">
      <div>
        <h1 class="logo">EVERGLADES</h1>
        <p class="tagline">A trick-taking card game of the Florida wetlands</p>
      </div>
      <label class="stack" style="gap:4px"><span class="panel-title" style="margin:0">Your name</span>
        <input id="name" class="field" maxlength="16" placeholder="Ranger" value="${esc(savedName())}"></label>
      <button id="create" class="btn primary">Start a new table</button>
      <div class="divider">— or join friends —</div>
      <div class="row" style="flex-wrap:nowrap">
        <input id="code" class="field" maxlength="4" placeholder="CODE" value="${esc(qRoom)}" style="text-transform:uppercase;letter-spacing:4px;width:150px">
        <button id="join" class="btn brass" style="flex:1">Join table</button>
      </div>
      <div class="error">${esc(ui.err)}</div>
      <p class="hint" style="margin:0">2–6 players. Bots fill empty seats so every game has at least 4.</p>
    </div>
  </div>`;
  const name = () => { const n = document.getElementById('name').value.trim(); saveName(n); return n; };
  const go = async (op, body) => {
    try {
      const r = await fetch('/api/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      if (r.error) throw new Error(r.error); enterRoom(r);
    } catch (e) { ui.err = e.message; renderLanding(); }
  };
  document.getElementById('create').onclick = () => go('create', { name: name() });
  const join = () => {
    const code = document.getElementById('code').value.trim().toUpperCase();
    if (!code) { ui.err = 'Type the 4-letter room code.'; return renderLanding(); }
    go('join', { name: name(), room: code });
  };
  document.getElementById('join').onclick = join;
  document.getElementById('code').onkeydown = e => { if (e.key === 'Enter') join(); };
}
function enterRoom(r) {
  ui.err = ''; saveSess({ room: r.room, token: r.token });
  history.replaceState(null, '', '?room=' + r.room);
  S = null; connect(); render();
}

// Partner-mode teams (colours match the board's palette)
const TEAMS = [
  { name: 'Mangrove', color: '#2a9a4a' },
  { name: 'Sawgrass', color: '#b8892a' },
  { name: 'Coral', color: '#e0679f' },
];
const teamTag = t => (t === null || t === undefined) ? '' : `<span class="teamtag" style="--tc:${TEAMS[t].color}">${TEAMS[t].name}</span>`;

function renderLobby() {
  const link = location.origin + location.pathname + '?room=' + S.room;
  const humans = S.lobby.filter(m => !m.bot).length;
  let tableSize = Math.max(4, S.lobby.length);
  if (S.mode === 'partners' && tableSize % 2) tableSize += 1;
  const bots = tableSize - S.lobby.length;
  const nTeams = Math.min(3, Math.max(2, Math.ceil(tableSize / 2)));
  const teamPicker = m => {
    if (S.mode !== 'partners') return '';
    const mine = m.pid === S.yourPid;
    if (!mine && !S.isHost) return teamTag(m.team) || '<span class="hint">no team yet</span>';
    return `<span class="teampick">${[...Array(nTeams).keys()].map(t =>
      `<button class="teamopt ${m.team === t ? 'on' : ''}" style="--tc:${TEAMS[t].color}" data-team="${t}" data-pid="${m.pid}" title="Team ${TEAMS[t].name}">${TEAMS[t].name}</button>`).join('')}</span>`;
  };
  $app.innerHTML = `
  <div class="landing">
    <div class="paper spiral landing-card stack" style="width:min(620px,100%)">
      <h1 class="logo" style="font-size:42px">EVERGLADES</h1>
      <div><div class="panel-title">Room code</div><span class="room-code">${S.room}</span></div>
      <div class="row"><input class="field" readonly value="${esc(link)}" style="flex:1;font-size:15px"><button id="copy" class="btn small">Copy link</button></div>
      <div class="row" style="justify-content:space-between">
        <div><div class="panel-title" style="margin:0">Game mode</div>
          <span style="font-size:18px">${({ solo: 'Everyone for themselves', partners: 'Partners — teams of 2 score together', coop: 'Co-op — everyone vs The Anaconda' })[S.mode || 'solo']}</span></div>
        ${S.isHost ? `<div class="modepick">${[['solo', 'Solo'], ['partners', 'Partners'], ['coop', 'Co-op']].map(([m, l]) =>
          `<button class="btn small ${(S.mode || 'solo') === m ? 'brass' : ''}" data-mode="${m}">${l}</button>`).join('')}</div>` : ''}
      </div>
      <div class="row" style="justify-content:space-between">
        <div><div class="panel-title" style="margin:0">Bot speed</div>
          <span style="font-size:18px">${SPEED_LABEL[S.speed] || 'Normal'}</span> <span class="hint">${({ slow: '— relaxed, plenty of time to read', normal: '— steady pace', fast: '— quick games' })[S.speed] || ''}</span></div>
        ${S.isHost ? `<div class="modepick">${SPEED_ORDER.map(sp =>
          `<button class="btn small ${S.speed === sp ? 'brass' : ''}" data-speed="${sp}">${SPEED_LABEL[sp]}</button>`).join('')}</div>` : ''}
      </div>
      ${S.mode === 'partners' ? `<p class="hint" style="margin:-4px 0 0">Pick a team for yourself${S.isHost ? ' (as host you can also place others and bots)' : ''}. Anyone without a team gets a random partner. Teammates never take turns back to back.</p>` : ''}
      ${S.mode === 'coop' ? `<div class="row" style="flex-wrap:nowrap;gap:12px;align-items:flex-start;margin-top:-4px">
          <img src="${BOSS.portrait}" alt="" class="bossthumb" data-peek="${BOSS.img}">
          <p class="hint" style="margin:0">Everyone plays together against <b>The Anaconda</b>. Players get the Native cards; after each player's turn the Anaconda flips an Invasive card. The game ends after the round it plays its last card. Add up all players' scores — you must beat the Anaconda's total. Hover the portrait to read its boss card.</p></div>` : ''}
      <div>
        <div class="panel-title">At the table (${S.lobby.length}/6)</div>
        ${S.lobby.map(m => `
          <div class="member">
            <span class="dot ${m.online ? '' : 'off'}"></span>
            <span style="flex:1">${esc(m.name)}${m.pid === S.yourPid ? ' <span style="color:var(--red)">(you)</span>' : ''}</span>
            ${teamPicker(m)}
            ${m.host ? '<span class="tag host">HOST</span>' : ''}${m.bot ? '<span class="tag bot">BOT</span>' : ''}
            ${S.isHost && m.pid !== S.yourPid ? `<button class="btn small" data-remove="${m.pid}">✕</button>` : ''}
          </div>`).join('')}
      </div>
      ${S.isHost ? `
        <div class="row">
          <button id="addbot" class="btn small" ${S.lobby.length >= 6 ? 'disabled' : ''}>+ Add bot</button>
          <span class="hint">${bots ? `${bots} bot${bots > 1 ? 's' : ''} will join when you start, to make ${tableSize} players.` : 'Ready when you are.'}</span>
        </div>
        <button id="start" class="btn primary">Start game</button>`
      : `<p class="hint">Waiting for the host to start… ${humans} player${humans > 1 ? 's' : ''} here.</p>`}
      <button id="leave" class="btn small" style="align-self:flex-start">Leave table</button>
    </div>
  </div>`;
  document.getElementById('copy').onclick = () => { navigator.clipboard?.writeText(link); showToast('Link copied — send it to your friends!'); };
  document.getElementById('leave').onclick = async () => { await lobby('leave'); leave(); };
  $app.querySelectorAll('[data-team]').forEach(b => b.onclick = () => {
    const m = S.lobby.find(x => x.pid === b.dataset.pid);
    const t = +b.dataset.team;
    lobby('team', { pid: b.dataset.pid, team: m && m.team === t ? null : t }); // click again to clear
  });
  if (S.isHost) {
    $app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => lobby('mode', { mode: b.dataset.mode }));
    $app.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => lobby('speed', { speed: b.dataset.speed }));
    document.getElementById('addbot').onclick = () => lobby('addBot');
    document.getElementById('start').onclick = () => lobby('start');
    $app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => lobby('remove', { pid: b.dataset.remove }));
  }
}

// ---------- the game table ----------
function cardEl(id, cls = '', extra = '', who = '', badge = '') {
  const c = CARDS[id];
  return `<div class="card eco ${cls}" data-peek="${c.img}" ${extra}><img src="${c.img}" alt="${esc(c.name)}" loading="lazy">${badge}${who ? `<div class="who">${esc(who)}</div>` : ''}</div>`;
}
function biomeEl(id, cls = '', extra = '') {
  const b = BIOMES[id];
  return `<div class="card bio ${cls}" data-peek="${b.img}" ${extra}><img src="${b.img}" alt="${esc(b.name)}"></div>`;
}
const isMine = () => S.you >= 0 && S.waiting === S.you;

function boardHtml() {
  const myTurn = isMine();
  const step = S.step;
  const curRegion = S.trick ? BIOMES[S.trick.biome].region : null;
  const fresh = ui.fresh; ui.fresh = null; // animate new tokens once
  let polys = '', toks = '', sums = '';
  for (const [id, g] of Object.entries(GEO)) {
    const t = S.board[id];
    const target = myTurn && step && step.type === 'place' && S.placeTargets.includes(id);
    polys += `<polygon class="rg ${id === curRegion ? 'current' : ''} ${target ? 'target' : ''}" points="${g.poly.map(p => p.join(',')).join(' ')}" ${target ? `data-place="${id}"` : ''}><title>${esc(REGIONS[id].name)}</title></polygon>`;
    // natives on even spots, invasives on odd spots, so they mingle
    const spots = SPOTS[id];
    const draw = (kind, count, offset) => {
      for (let k = 0; k < count; k++) {
        const s = spots[(k * 2 + offset) % spots.length];
        if (!s) break;
        const isNew = fresh && fresh[id] && k >= fresh[id][kind];
        toks += `<rect class="t ${kind} ${isNew ? 'new' : ''}" x="${(s[0] - TOK / 2).toFixed(0)}" y="${(s[1] - TOK / 2).toFixed(0)}" width="${TOK}" height="${TOK}" ${isNew ? `style="animation-delay:${(k - fresh[id][kind]) * 0.07}s"` : ''}/>`;
      }
    };
    draw('n', t.n, 0); draw('i', t.i, 1);
    const preyHere = myTurn && step && step.type === 'predate' && step.regions.includes(id);
    const pickN = ((preyHere || ui.mode === 'landdev') && t.n > 0);
    const pickI = ((preyHere || ui.mode === 'landdev') && t.i > 0);
    sums += `<div class="sum" style="left:${(g.sum[0] / BW * 100).toFixed(2)}%;top:${(g.sum[1] / BH * 100).toFixed(2)}%">
      <span class="tok n ${t.n ? '' : 'zero'} ${pickN ? 'pick' : ''}" ${pickN ? `data-pick="${id}:n"` : ''} title="Native">${t.n}</span>
      <span class="tok i ${t.i ? '' : 'zero'} ${pickI ? 'pick' : ''}" ${pickI ? `data-pick="${id}:i"` : ''} title="Invasive">${t.i}</span></div>`;
  }
  return `<div class="board"><img class="map" src="assets/board.png" alt="Map of the Everglades">
    <svg viewBox="0 0 ${BW} ${BH}" preserveAspectRatio="none">${polys}<g pointer-events="none">${toks}</g></svg>${sums}</div>`;
}

// A character portrait. Canvases are drawn by the animation loop (drawPortraits), so they survive re-renders.
function portraitHtml(i, p) {
  if (p.boss) return `<div class="portrait boss" data-seat="${i}"><img src="${BOSS.portrait}" alt="The Anaconda"><span class="emote"></span></div>`;
  if (!p.role) return `<div class="portrait empty" data-seat="${i}" title="Choosing a role…"><span class="q">?</span></div>`;
  return `<div class="portrait" data-seat="${i}"><canvas width="${CHAR_ANIM.w}" height="${CHAR_ANIM.h}"></canvas><span class="emote"></span></div>`;
}

function playersHtml(mini) {
  return S.players.map((p, i) => {
    const role = roleInfo(p.role);
    const arrow = S.waiting === i ? '<span class="arrow">▶</span>' : '';
    if (p.boss) return `<div class="pl boss ${S.waiting === i ? 'turn' : ''}" data-seat="${i}" data-peek="${BOSS.img}">${portraitHtml(i, p)}
      <div class="info">
        <div class="nm">${arrow}<span class="name">${esc(p.name)}</span><span class="tag bosstag">BOSS</span></div>
        ${mini ? '' : `<div class="meta"><span>Invasive deck ${p.handCount}</span></div><div class="meta"><span>Tricks ${p.tricks}</span></div>`}
      </div></div>`;
    return `<div class="pl ${S.waiting === i ? 'turn' : ''}" data-seat="${i}" ${role ? `data-peek="${role.img}"` : ''}>${portraitHtml(i, p)}
      <div class="info">
        <div class="nm">${arrow}<span class="name">${esc(p.name)}</span>${i === S.you ? '<span class="you">(you)</span>' : ''}${p.online ? '' : '<span class="dot off" title="offline"></span>'}</div>
        ${mini ? '' : `<div class="meta">${role ? `<span class="rolename">${esc(role.name)}</span>` : '<span>choosing role…</span>'}${teamTag(p.team)}</div>
        <div class="meta"><span>Hand ${p.handCount}</span><span>Tricks ${p.tricks}</span></div>`}
        ${!mini && S.isHost && !p.online && !p.bot && S.phase !== 'ended' ? `<button class="btn small" data-botify="${S.lobby.find(m => m.name === p.name)?.pid || ''}">Give seat to a bot</button>` : ''}
      </div></div>`;
  }).join('');
}

function draftHtml() {
  const myTurn = isMine();
  const owner = {};
  S.players.forEach(p => { if (p.role) owner[p.role] = p.name; });
  const cards = Object.keys(ROLES).filter(r => owner[r] || S.availableRoles.includes(r)).map(r => {
    const R = ROLES[r];
    const free = !owner[r];
    const pick = myTurn && free;
    return `<div class="rolepick ${pick ? 'choosable' : ''} ${free ? '' : 'taken'}" data-peek="${R.img}" ${pick ? `data-role="${r}"` : ''}>
      <img src="${R.img}" alt="${esc(R.name)}">
      ${free ? '' : `<div class="takenby">${esc(owner[r])}</div>`}
    </div>`;
  }).join('');
  return `<div class="tabletop draft"><div class="players-mini">${playersHtml(true)}</div>
    <h3>${myTurn ? '▶ Choose your role' : `${esc(S.players[S.waiting].name)} is choosing a role…`} <span style="color:var(--blush)">(picking in turn order)</span></h3>
    <div class="rolegrid ${myTurn ? 'choosing' : ''}">${cards}</div>
  </div>`;
}

// The trick that just finished, with the winning card raised and highlighted, shown for a moment.
function trickDoneHtml() {
  const lt = S.lastTrick, b = BIOMES[lt.biome], w = S.players[lt.winner];
  const elapsed = Date.now() - ui.trickHold.start;
  const who = p => S.players[p].boss ? 'Anaconda' : S.players[p].name;
  return `<div class="tabletop play trickdone ${lt.crisis ? 'crisis' : ''}"><div class="players-mini">${playersHtml(true)}</div>
    <h3>Round ${lt.round} — trick complete</h3>
    <div class="cur-row">
      ${biomeEl(lt.biome)}
      <div class="tt-info">
        <div class="place">${esc(b.name)}<br><span style="color:var(--blush)">${esc(REGIONS[b.region].name)}</span></div>
        <div class="winline">★ ${esc(w.name)} wins with ${esc(CARDS[lt.card].name)}!</div>
        ${lt.crisis ? '<div class="crisisline">INVASIVE CRISIS!</div>' : ''}
        ${lt.matched === false ? '<span class="lastline" style="color:var(--blush)">No card matched, so the highest Impact won.</span>' : ''}
      </div>
    </div>
    <div class="played" style="--n:${lt.plays.length}">${lt.plays.map(pl => pl.card === lt.card
      ? cardEl(pl.card, 'winner', '', who(pl.p), `<div class="winribbon">${lt.crisis ? 'CRISIS!' : 'WINNER'}</div>`)
      : cardEl(pl.card, 'loser', '', who(pl.p))).join('')}</div>
    <div class="holdbar"><span style="animation-duration:${ui.trickHold.ms}ms;animation-delay:-${elapsed}ms"></span></div>
  </div>`;
}

function tableHtml() {
  if (S.phase === 'draft') return draftHtml();
  if (holding()) return trickDoneHtml();
  const myTurn = isMine();
  const choosing = S.phase === 'choose' || !S.trick;
  const pickNow = S.phase === 'choose' && myTurn;
  const n = S.players.length;
  const deck = `<div class="deckpile"><img src="assets/biome-back.png" alt="">${S.deckCount} left</div>`;
  const travelCards = cls => S.travel.map(id => biomeEl(id, cls, pickNow ? `data-choose="${id}"` : '')).join('');

  if (choosing) {
    // Picking the next biome: the travel row is the star.
    const lt = S.lastTrick;
    return `<div class="tabletop choose"><div class="players-mini">${playersHtml(true)}</div>
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
        <h3>${pickNow ? '▶ Choose where to travel' : `${esc(S.players[S.leader].name)} is choosing where to travel…`}</h3>${deck}
      </div>
      <div class="travel ${pickNow ? 'choosing' : ''}">${travelCards(pickNow ? 'choosable' : '')}</div>
      ${lt ? `<div class="strip">
        <h3>Last trick — ${esc(S.players[lt.winner].name)} won${lt.crisis ? ' · <span style="color:#ffb3b3">Crisis!</span>' : ''}</h3>
        <div class="strip-cards">${biomeEl(lt.biome)}${lt.plays.map(pl => cardEl(pl.card, pl.card === lt.card ? 'win' : '')).join('')}</div>
      </div>` : ''}
    </div>`;
  }
  // A biome has been chosen: the current biome and the played cards take over.
  const b = BIOMES[S.trick.biome];
  const changed = S.trick.risk !== b.risk;
  return `<div class="tabletop play"><div class="players-mini">${playersHtml(true)}</div>
    <h3>Round ${S.round} — exploring</h3>
    <div class="cur-row">
      ${biomeEl(S.trick.biome)}
      <div class="tt-info">
        <div class="place">${esc(b.name)}<br><span style="color:var(--blush)">${esc(REGIONS[b.region].name)}</span></div>
        <span class="suitbadge suit-${b.suit}">${b.suit}</span>
        <span class="risk">Risk <b>${S.trick.risk}</b>${changed ? `<span style="font-size:13px;color:var(--ink-soft)">(was ${b.risk})</span>` : ''}</span>
      </div>
    </div>
    <div class="played" style="--n:${S.trick.seq ? S.trick.seq.length : n}">${S.trick.plays.length ? S.trick.plays.map(pl => cardEl(pl.card, '', '', S.players[pl.p].boss ? 'Anaconda' : S.players[pl.p].name)).join('') : '<span class="lastline" style="color:var(--blush)">No cards played yet.</span>'}</div>
    <div class="strip">
      <h3>Travel row</h3>
      <div class="strip-cards">${travelCards('')}${deck}</div>
    </div>
  </div>`;
}

function renderGame() {
  const myTurn = isMine();
  const hand = (S.hand || []).slice().sort((a, b) => {
    const A = CARDS[a], B = CARDS[b];
    return (A.kind === B.kind ? 0 : A.kind === 'Invasive' ? 1 : -1) || SUIT_ORDER[A.habitat] - SUIT_ORDER[B.habitat] || A.impact - B.impact;
  });
  const canPlay = myTurn && S.phase === 'play' && !S.step && !S.tourPeek && !ui.mode;
  const handHtml = hand.map(id => {
    const legal = canPlay && S.legal.includes(id);
    const cls = !canPlay ? '' : legal ? 'legal' : 'illegal';
    // Invasive cards above the current Invasive Risk can't win this trick: flag them.
    const c = CARDS[id];
    const over = S.trick && c.kind === 'Invasive' && c.impact > S.trick.risk;
    const badge = over ? `<div class="overrisk" title="Impact ${c.impact} is above the Invasive Risk (${S.trick.risk}): this card can't win the trick, but it still populates."><span>!</span></div>` : '';
    return `<div class="slot" style="--i:${hand.indexOf(id)}">${cardEl(id, `${cls} ${ui.sel === id ? 'sel' : ''}`, `data-hand="${id}"`, '', badge)}</div>`;
  }).join('') || '<span class="hint" style="color:var(--blush)">No cards in hand.</span>';
  const role = S.role ? ROLES[S.role] : null;
  if (peekSrc && !document.querySelector(`[data-peek="${peekSrc}"]`)) { /* card may have left; checked after render */ }

  $app.innerHTML = `
  <div class="topbar">
    <span class="logo-sm">EVERGLADES</span>
    <span class="chip">Room ${S.room}</span>
    ${S.phase === 'draft' ? '<span class="chip">Role draft</span>' : S.phase !== 'ended' ? `<span class="chip">Round ${S.round}</span>` : ''}
    ${S.partners ? '<span class="chip">Partners</span>' : ''}${S.coop ? '<span class="chip" style="background:#f2d7c9">Co-op vs The Anaconda</span>' : ''}
    <span class="spacer"></span>
    <div class="notes-wrap">
      <button class="btn small ${ui.showLog ? 'brass' : ''}" id="notesBtn">Field notes ${ui.unread && !ui.showLog ? `<span class="badge">${ui.unread > 9 ? '9+' : ui.unread}</span>` : ''}▾</button>
      ${ui.showLog ? `<div class="paper spiral notes-drop" id="log"><div class="panel-title">Field notes</div>${S.log.map(l => `<p class="${l.startsWith('INVASIVE') ? 'crisis' : ''}">${esc(l)}</p>`).join('')}</div>` : ''}
    </div>
    <button class="btn small" id="speed" ${S.isHost ? '' : 'disabled'} title="${S.isHost ? 'How fast the bots play. Click to change.' : 'Bot speed (the host can change it)'}">Speed: ${SPEED_LABEL[S.speed] || 'Normal'}</button>
    <button class="btn small" id="mute" title="Sound on/off">${muted ? '♪ Off' : '♪ On'}</button>
    <button class="btn small" id="rules">Rules</button>
    <button class="btn small" id="quit">Leave</button>
  </div>
  <div class="game">
    <aside class="side">
      <div class="paper spiral players" style="--rows:${S.players.length}"><div class="panel-title" title="Hover a player to read their role card">Players <span class="hint">· hover to read roles</span></div>${playersHtml(false)}</div>
    </aside>
    <section class="boardwrap">${boardHtml()}</section>
    <section class="tablecol">${tableHtml()}</section>
    <section class="handarea">
      ${promptHtml()}
      <div class="handrow">
        <div class="hand ${ui.dealing ? 'dealing' : ''} ${Date.now() - (ui.handIntro || 0) < 1400 ? 'intro' : ''}">${handHtml}</div>
        ${role ? `<div class="rolebox"><div class="cap">You are the <b>${esc(role.name)}</b></div><div class="card" data-peek="${role.img}"><img src="${role.img}" alt="${esc(role.name)}"></div></div>` : ''}
      </div>
    </section>
  </div>
  ${ui.confirm ? confirmModal() : ''}
  ${ui.mode === 'swap' ? swapModal() : ''}
  ${ui.showRules ? rulesModal() : ''}
  ${S.phase === 'ended' && !holding() ? endModal() : ''}`;

  if (peekSrc && !document.querySelector(`[data-peek="${CSS.escape(peekSrc)}"]`)) hidePeek();
  const logEl = document.getElementById('log'); if (logEl) logEl.scrollTop = logEl.scrollHeight;
  wire();
  drawPortraits(true);
  placeBubbles();
}

function promptHtml() {
  const myTurn = isMine();
  const w = S.waiting >= 0 ? S.players[S.waiting] : null;
  if (holding()) {
    const lt = S.lastTrick;
    return `<div class="paper spiral prompt"><div class="msg">${esc(S.players[lt.winner].name)} wins the trick!<small>${S.phase === 'ended' ? 'Final scores coming up…' : 'Next round in a moment…'}</small></div></div>`;
  }
  if (S.phase === 'ended') return `<div class="paper spiral prompt"><div class="msg">Game over!</div></div>`;
  if (!myTurn) {
    let what = S.phase === 'draft' ? 'to choose a role' : S.phase === 'choose' ? 'to choose where to travel' : 'to play';
    if (S.step?.type === 'place') what = `to spread ${CARDS[S.step.card].name}`;
    if (S.step?.type === 'predate') what = `to hunt with ${CARDS[S.step.card].name}`;
    return `<div class="paper spiral prompt"><div class="msg">Waiting for ${esc(w ? w.name : '…')} ${what}…<small>Hover any card for a second to read it.</small></div></div>`;
  }
  const box = (msg, buttons = '') => `<div class="paper spiral prompt yours"><div class="msg">${msg}</div>${buttons}</div>`;
  if (S.phase === 'draft') return box('Choose your role! Click a role card in the play area.<small>Hover a card for a second to read its objectives. Your hand is already dealt, so plan around it.</small>');
  if (S.phase === 'choose') return box('You lead! Pick a biome in the glowing travel row.<small>Its type sets the lead suit, and its region is where everyone populates.</small>');
  const st = S.step;
  if (st?.type === 'place') return box(`Migratory: place ${st.left} more ${CARDS[st.card].kind} token${st.left > 1 ? 's' : ''}.<small>Click a glowing region on the map. Tokens spread in a continuous line from the current region.</small>`);
  if (st?.type === 'predate') return box(`Predatory: remove up to ${st.left} token${st.left > 1 ? 's' : ''} — Native or Invasive.<small>Click a blinking green or red counter on the map.</small>`, `<button class="btn" id="predDone">Done</button>`);
  if (S.tourPeek) {
    const b = BIOMES[S.tourPeek];
    return box(`Top of the location deck: <b>${esc(b.name)}</b><small>${esc(REGIONS[b.region].name)} · ${b.suit} · Risk ${b.risk}</small>`,
      `${biomeEl(S.tourPeek)}<button class="btn" data-tour="0">Leave on top</button><button class="btn brass" data-tour="1">Put on bottom</button>`);
  }
  if (ui.mode === 'landdev') return box('Land Developer: click any counter on the map to remove 1 token.', `<button class="btn" id="cancelMode">Cancel</button>`);
  const suit = BIOMES[S.trick.biome].suit;
  const follow = S.legal.length < S.hand.length ? (S.coop ? `Follow ${suit} if you can.` : `Follow ${suit} or play an Invasive card.`) : `You can't follow ${suit}, so play anything.`;
  let buttons = '';
  if (S.role && ACTIVE_ABILITY[S.role] && !S.abilityUsed) buttons += `<button class="btn brass" id="ability">${ACTIVE_ABILITY[S.role]}</button>`;
  const sel = ui.sel && S.legal.includes(ui.sel) ? CARDS[ui.sel] : null;
  if (sel && S.role === 'Conservationist' && sel.kind === 'Invasive') {
    buttons += `<button class="btn primary" id="play">Play &amp; populate</button><button class="btn" id="playNoPop">Don't populate</button>`;
  } else {
    buttons += `<button class="btn primary" id="play" ${sel ? '' : 'disabled'}>${sel ? 'Play ' + esc(sel.name) : 'Play card'}</button>`;
  }
  return box(`Your turn — pick a card to play.<small>${follow}${S.abilityUsed ? ' Ability used.' : ''}</small>`, buttons);
}

function swapModal() {
  const role = S.role;
  const okPile = id => {
    if (!ui.swapHand) return false;
    if (role === 'Researcher') return true;
    const need = role === 'Fisherman' ? 'Water' : 'Land';
    return CARDS[id].habitat === need;
  };
  const rule = role === 'Researcher' ? 'any card in your scoring pile'
    : `any ${role === 'Fisherman' ? 'Water' : 'Land'} card in your scoring pile`;
  return `<div class="modal"><div class="paper spiral">
    <div class="panel-title">Swap a card</div>
    <p class="hint" style="margin-top:0">Pick a card from your hand, then ${rule}.</p>
    <div><b>Your hand</b></div>
    <div class="pickrow">${S.hand.map(id => cardEl(id, ui.swapHand === id ? 'win' : '', `data-sh="${id}"`)).join('')}</div>
    <div><b>Your scoring pile</b></div>
    <div class="pickrow">${S.pile.length ? S.pile.map(id => cardEl(id, (ui.swapPile === id ? 'win ' : '') + (okPile(id) ? '' : 'dim'), okPile(id) ? `data-sp="${id}"` : '')).join('') : '<span class="hint">Your scoring pile is empty — win a trick first.</span>'}</div>
    <div class="row"><button class="btn primary" id="doSwap" ${ui.swapHand && ui.swapPile ? '' : 'disabled'}>Swap</button><button class="btn" id="cancelMode">Cancel</button></div>
  </div></div>`;
}

function rulesModal() {
  return `<div class="modal"><div class="paper spiral">
    <div class="row" style="justify-content:space-between"><div class="panel-title">How to play</div><button class="btn small" id="closeRules">Close</button></div>
    <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
      <img src="assets/ref-front.png" data-peek="assets/ref-front.png" alt="On your turn" style="width:min(240px,30%);border:3px solid var(--ink)">
      <img src="assets/ref-back.png" data-peek="assets/ref-back.png" alt="Playing tricks" style="width:min(240px,30%);border:3px solid var(--ink)">
      <div class="hint" style="flex:1;min-width:0;color:var(--ink)">
        <p style="margin-top:0"><b>Setup:</b> after the cards are dealt, players choose roles one at a time in turn order.</p>${S.coop ? `<p><b>Co-op vs The Anaconda:</b> you hold only Native cards. After each player's turn the Anaconda flips its top Invasive card. When it wins a trick it travels to the highest-Risk biome. Its Predatory cards eat Native tokens and its Migratory cards move next door to the most Natives. The game ends after the round it plays its last card. Add all players' scores together — you must beat the Anaconda's score (hover its name to read its boss card).</p>` : ''}<p><b>Each round:</b> the lead player picks a biome from the travel row. Everyone plays one card, in order.</p>
        <p><b>Winning:</b> the highest-Impact card that matches the biome's type wins. Invasive cards match too if their Impact is at or below the current Invasive Risk. A <b>Keystone</b> card lowers the Risk by the number of Native tokens in the region. If nothing matches, the highest Impact card wins.</p>
        <p><b>Invasive Crisis:</b> if an Invasive card wins, each region loses 1 Native token per Invasive token there (or 1 Invasive token if it has only Invasives).</p>
        <p><b>Scoring:</b> 5 points per trick, plus the objectives on your role card. Everyone's role is public — hover a name to read it.</p>
      </div>
    </div></div></div>`;
}

function coopEndModal() {
  const R = S.results;
  const e = R.scores.find(x => x.p === R.ending.p);
  const role = ROLES[e.role];
  const row = sc => `<tr>
        <td><img class="rolethumb" src="${ROLES[sc.role].img}" data-peek="${ROLES[sc.role].img}" alt=""></td>
        <td><b>${esc(sc.name)}</b><br><span class="hint">${esc(ROLES[sc.role].name)}</span></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td>
        <td class="total">${sc.total}</td></tr>`;
  return `<div class="modal"><div class="paper spiral">
    <h2 class="logo" style="font-size:38px;${R.playersWin ? '' : 'color:var(--red)'}">${R.playersWin ? 'THE EVERGLADES ARE SAVED!' : 'THE ANACONDA WINS!'}</h2>
    <p style="font-size:22px;margin:6px 0">Players <b>${R.playersTotal}</b> &nbsp;vs&nbsp; The Anaconda <b>${R.anaconda.total}</b>${R.playersTotal === R.anaconda.total ? ' <span class="hint">(the Anaconda wins ties)</span>' : ''}</p>
    <p class="hint" style="margin:0 0 6px">${R.playersWin
      ? `${esc(e.name)}, the highest scorer, reads the good ending on the ${esc(role.name)} card:`
      : `${esc(e.name)}, the lowest scorer, reads the grim ending on the ${esc(role.name)} card:`}</p>
    <div class="ending" data-peek="${role.ending}"><img src="${role.ending}" alt="Ending"><div class="shade ${R.playersWin ? 'right' : 'left'}"></div></div>
    <table class="scores"><tr><th>Role</th><th>Player</th><th>Breakdown</th><th>Total</th></tr>
      <tr class="teamrow"><td colspan="3">The players, together</td><td class="total">${R.playersTotal}</td></tr>
      ${R.scores.map(row).join('')}
      <tr class="teamrow bossrow"><td colspan="3">The Anaconda</td><td class="total">${R.anaconda.total}</td></tr>
      <tr><td><img class="rolethumb" src="${BOSS.img}" data-peek="${BOSS.img}" alt=""></td><td><b>The Anaconda</b><br><span class="hint">Co-op boss</span></td>
        <td class="lines">${R.anaconda.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td><td class="total">${R.anaconda.total}</td></tr>
    </table>
    <div class="row">${S.isHost ? '<button class="btn primary" id="rematch">Back to lobby</button>' : '<span class="hint">The host can start a new game.</span>'}<button class="btn" id="quit2">Leave</button></div>
  </div></div>`;
}

function endModal() {
  const R = S.results;
  if (R.coop) return coopEndModal();
  const sorted = R.scores.slice().sort((a, b) => b.total - a.total);
  const endings = R.winners.map(w => {
    const sc = R.scores.find(x => x.p === w);
    const role = ROLES[sc.role];
    return `<div class="ending-label">${esc(sc.name)}'s ending — the ${esc(role.name)} (${sc.good ? 'good' : 'grim'} ending)</div>
      <div class="ending" data-peek="${role.ending}"><img src="${role.ending}" alt="Ending"><div class="shade ${sc.good ? 'right' : 'left'}"></div></div>`;
  }).join('');
  const row = sc => `<tr class="${R.winners.includes(sc.p) ? 'winner' : ''}">
        <td><img class="rolethumb" src="${ROLES[sc.role].img}" data-peek="${ROLES[sc.role].img}" alt=""></td>
        <td><b>${esc(sc.name)}</b><br><span class="hint">${esc(ROLES[sc.role].name)}</span></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td>
        <td class="total">${sc.total}</td></tr>`;
  if (R.teams) {
    // Partner mode: one block per team, with the team total
    const tied = R.teams.filter(t => t.total === R.teams[0].total).length > 1;
    const title = tied ? "IT'S A TIE!" : `TEAM ${TEAMS[R.teams[0].team].name.toUpperCase()} WINS!`;
    return `<div class="modal"><div class="paper spiral">
    <h2 class="logo" style="font-size:38px">${title}</h2>
    <p class="hint" style="margin:4px 0 8px">The winning partners read their role cards' backs aloud:</p>
    ${endings}
    <table class="scores"><tr><th>Role</th><th>Player</th><th>Breakdown</th><th>Total</th></tr>
      ${R.teams.map(t => `<tr class="teamrow"><td colspan="3">${teamTag(t.team)} ${t.members.map(m => esc(S.players[m].name)).join(' &amp; ')}</td><td class="total">${t.total}</td></tr>
        ${t.members.map(m => row(R.scores.find(x => x.p === m))).join('')}`).join('')}
    </table>
    <div class="row">${S.isHost ? '<button class="btn primary" id="rematch">Back to lobby</button>' : '<span class="hint">The host can start a new game.</span>'}<button class="btn" id="quit2">Leave</button></div>
  </div></div>`;
  }
  return `<div class="modal"><div class="paper spiral">
    <h2 class="logo" style="font-size:38px">${R.winners.length > 1 ? "IT'S A TIE!" : esc(S.players[R.winners[0]].name).toUpperCase() + ' WINS!'}</h2>
    <p class="hint" style="margin:4px 0 8px">The winner reads their role card's back aloud:</p>
    ${endings}
    <table class="scores"><tr><th>Role</th><th>Player</th><th>Breakdown</th><th>Total</th></tr>
      ${sorted.map(sc => `<tr class="${R.winners.includes(sc.p) ? 'winner' : ''}">
        <td><img class="rolethumb" src="${ROLES[sc.role].img}" data-peek="${ROLES[sc.role].img}" alt=""></td>
        <td><b>${esc(sc.name)}</b><br><span class="hint">${esc(ROLES[sc.role].name)}</span></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td>
        <td class="total">${sc.total}</td></tr>`).join('')}
    </table>
    <div class="row">${S.isHost ? '<button class="btn primary" id="rematch">Back to lobby</button>' : '<span class="hint">The host can start a new game.</span>'}<button class="btn" id="quit2">Leave</button></div>
  </div></div>`;
}

// ---------- "are you sure?" when a card play would waste your ability ----------
function abilityStillUseful() {
  if (!S.role || !ACTIVE_ABILITY[S.role] || S.abilityUsed) return false;
  if (S.role === 'Tourist') return S.deckCount > 0;
  if (S.role === 'LandDeveloper') return boardTotal(S.board) > 0;
  if (S.role === 'Researcher') return S.pile.length > 0 && S.hand.length > 0;
  const need = S.role === 'Fisherman' ? 'Water' : 'Land';
  return S.hand.length > 0 && S.pile.some(pc => CARDS[pc].habitat === need);
}
function warnOff() { try { return sessionStorage.getItem('eg_nowarn_' + S.room) === '1'; } catch { return false; } }
function tryPlay(card, populate) {
  ui.sel = null; hidePeek();
  if (!warnOff() && abilityStillUseful()) { ui.confirm = { card, populate }; return render(); }
  act({ type: 'play', card, populate });
}
function confirmModal() {
  const R = ROLES[S.role];
  const c = CARDS[ui.confirm.card];
  return `<div class="modal"><div class="paper spiral" style="width:min(560px,100%)">
    <div class="panel-title">Use your ability first?</div>
    <p style="margin:0 0 8px;font-size:18px">You haven't used your <b>${esc(R.name)}</b> ability this turn:</p>
    <p class="hint" style="margin:0 0 10px;color:var(--ink);border-left:4px solid var(--brass);padding-left:8px">${esc(R.ability)}</p>
    <p class="hint" style="margin:0 0 14px">Abilities can only be used at the start of your turn, before you play a card. If you play <b>${esc(c.name)}</b> now, you'll miss it until your next turn.</p>
    <div class="row">
      <button class="btn brass" id="cfUse">Use ability first</button>
      <button class="btn primary" id="cfPlay">Play ${esc(c.name)} anyway</button>
      <button class="btn small" id="cfCancel">Cancel</button>
    </div>
    <label class="hint" style="display:flex;gap:8px;align-items:center;margin-top:12px;cursor:pointer"><input type="checkbox" id="cfOff"> Don't warn me again this game</label>
  </div></div>`;
}

// ---------- animated character portraits ----------
// Each portrait plays one animation at a time. Reactions from the server (cheer, upset, shock, signature...)
// interrupt anything weaker; in between, characters idle (breathe and blink), think while it's their turn,
// and now and then do their signature move. Timing lives here, not in the DOM, so re-renders never restart a clip.
const sprites = {};
function sprite(role, anim) {
  const k = role + '/' + anim;
  if (!sprites[k]) { const im = new Image(); im.src = CHAR_ANIM.src(role, anim); sprites[k] = im; }
  return sprites[k];
}
const preloaded = new Set();
function preloadChar(role) {
  if (preloaded.has(role)) return;
  preloaded.add(role);
  for (const a of Object.keys(CHAR_ANIM.anims)) sprite(role, a);
}
const playing = {}; // seat -> { anim, pri, start, until }
const passive = {}; // seat -> time of the next passive animation
const EMOTE = { think: '?', signature: '♪', cheer: '★', upset: '…', shock: '!' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function clipLength(anim) { const A = CHAR_ANIM.anims[anim]; return CHAR_ANIM.frames / A.fps * 1000 * (A.loops || 1); }
function react(seat, anim, pri = 1) {
  if (!CHAR_ANIM.anims[anim]) return;
  const now = performance.now(), cur = playing[seat];
  if (cur && now < cur.until && cur.pri > pri) return; // something more dramatic is still playing
  playing[seat] = { anim, pri, start: now, until: now + clipLength(anim) };
  passive[seat] = now + clipLength(anim) + 2500 + Math.random() * 3000;
}
function nowPlaying(seat, now) {
  let cur = playing[seat];
  if (cur && now >= cur.until) cur = playing[seat] = null;
  if (!cur && !reducedMotion.matches) {
    if (passive[seat] === undefined) passive[seat] = now + 800 + Math.random() * 4000; // stagger the table
    if (now >= passive[seat]) {
      const myTurn = S && S.waiting === +seat && ['draft', 'choose', 'play'].includes(S.phase);
      const anim = myTurn ? (Math.random() < 0.65 ? 'think' : 'idle') : (Math.random() < 0.12 ? 'signature' : 'idle');
      react(seat, anim, 0);
      passive[seat] = now + clipLength(anim) + (myTurn ? 2500 : 4500) + Math.random() * 5000;
      cur = playing[seat];
    }
  }
  return cur;
}
function drawPortraits(force) {
  if (!S || !S.players) return;
  const now = performance.now();
  for (const el of $app.querySelectorAll('.portrait[data-seat]')) {
    const seat = el.dataset.seat, p = S.players[seat];
    if (!p || (!p.role && !p.boss)) continue;
    const cur = nowPlaying(seat, now);
    const emote = el.querySelector('.emote');
    const showEmote = cur && cur.anim !== 'idle' ? cur.anim : '';
    if (emote && emote.dataset.a !== showEmote) { emote.dataset.a = showEmote; emote.textContent = EMOTE[showEmote] || ''; }
    if (p.boss) { if (el.dataset.react !== showEmote) el.dataset.react = showEmote; continue; }
    const cv = el.querySelector('canvas');
    if (!cv) continue;
    let anim = cur ? cur.anim : 'idle';
    let frame = cur ? Math.floor((now - cur.start) / 1000 * CHAR_ANIM.anims[anim].fps) % CHAR_ANIM.frames : 0;
    let im = sprite(p.role, anim);
    if (!im.complete || !im.naturalWidth) { anim = 'idle'; frame = 0; im = sprite(p.role, 'idle'); } // still loading
    if (!im.complete || !im.naturalWidth) continue;
    const key = anim + frame;
    if (!force && cv.dataset.k === key) continue;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, frame * CHAR_ANIM.w, 0, CHAR_ANIM.w, CHAR_ANIM.h, 0, 0, cv.width, cv.height);
    cv.dataset.k = key;
  }
}
(function loop() { drawPortraits(false); requestAnimationFrame(loop); })();

// ---------- bot speech bubbles ----------
const $bubbles = document.getElementById('bubbles');
function placeBubbles() {
  if (!$bubbles) return;
  const now = Date.now();
  let html = '';
  for (const [seat, b] of Object.entries(ui.bubbles)) {
    if (b.until < now || !S || !S.players || !S.players[seat]) { delete ui.bubbles[seat]; continue; }
    const rows = [...document.querySelectorAll(`.pl[data-seat="${seat}"]`)].filter(el => el.offsetParent);
    if (!rows.length) continue;
    const r = rows[0].getBoundingClientRect();
    const below = r.right + 260 > innerWidth;         // no room on the right: hang it underneath instead
    const x = below ? Math.max(8, r.left) : r.right + 12;
    const y = below ? r.bottom + 8 : r.top + 4;
    html += `<div class="bubble ${below ? 'below' : ''}" data-id="${b.id}" style="left:${x}px;top:${y}px">${esc(b.text)}</div>`;
  }
  // keep existing bubbles (so their pop-in animation doesn't replay), add new ones
  const keep = new Set([...$bubbles.children].map(el => el.dataset.id));
  const tmp = document.createElement('div'); tmp.innerHTML = html;
  const want = new Set([...tmp.children].map(el => el.dataset.id));
  [...$bubbles.children].forEach(el => { if (!want.has(el.dataset.id)) el.remove(); });
  [...tmp.children].forEach(el => {
    const old = $bubbles.querySelector(`[data-id="${el.dataset.id}"]`);
    if (old) { old.style.left = el.style.left; old.style.top = el.style.top; old.className = el.className; }
    else $bubbles.appendChild(el);
  });
  void keep;
}
setInterval(() => { if (Object.keys(ui.bubbles).length) placeBubbles(); }, 500);
addEventListener('resize', () => placeBubbles());

// ---------- shuffle and deal animation at the start of a game ----------
const $deal = document.getElementById('deal');
function finishDeal() {
  if (!ui.dealing) return;
  ui.dealing = false; ui.handIntro = Date.now();
  $deal.innerHTML = ''; $deal.classList.add('hidden');
  render();
}
async function playDeal() {
  if (!$deal || matchMedia('(prefers-reduced-motion: reduce)').matches) return finishDeal();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const area = (document.querySelector('.tablecol') || document.body).getBoundingClientRect();
  const W = Math.min(130, area.width / 5), H = W * 1.4;
  const cx = area.left + area.width / 2 - W / 2, cy = area.top + area.height / 2 - H / 2;
  $deal.classList.remove('hidden');
  $deal.innerHTML = `<div class="deal-title">Shuffling the Ecology deck…</div>`;
  $deal.onclick = finishDeal;
  const N = 14, cards = [];
  for (let i = 0; i < N; i++) {
    const el = document.createElement('img');
    el.src = 'assets/ecology-back.png'; el.className = 'deal-card';
    Object.assign(el.style, { width: W + 'px', height: H + 'px', left: cx + 'px', top: cy - i * 1.5 + 'px', zIndex: i });
    $deal.appendChild(el); cards.push(el);
  }
  const title = $deal.querySelector('.deal-title');
  Object.assign(title.style, { left: area.left + area.width / 2 + 'px', top: cy - 60 + 'px' });
  // three riffle shuffles: split left/right, then zip back together
  for (let round = 0; round < 3 && ui.dealing; round++) {
    cards.forEach((el, i) => el.animate([{ transform: 'none' }, { transform: `translate(${i % 2 ? 80 : -80}px, ${(i % 2 ? -1 : 1) * 6}px) rotate(${i % 2 ? 8 : -8}deg)` }],
      { duration: 220, easing: 'steps(4)', fill: 'forwards' }));
    SFX.card(); await wait(260);
    cards.forEach((el, i) => el.animate([{ transform: `translate(${i % 2 ? 80 : -80}px, 0) rotate(${i % 2 ? 8 : -8}deg)` }, { transform: 'none' }],
      { duration: 160, delay: i * 18, easing: 'steps(3)', fill: 'forwards' }));
    for (let k = 0; k < 5; k++) setTimeout(() => tone(1800 + Math.random() * 600, 0.015, { type: 'square', vol: 0.025 }), k * 45);
    await wait(160 + N * 18 + 80);
  }
  if (!ui.dealing) return;
  // deal: cards fly to every seat, three times around the table
  title.textContent = 'Dealing…';
  const seats = S.players.map((p, i) => {
    if (i === S.you) { const h = document.querySelector('.hand'); if (h) { const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2 - W / 2, y: r.top + 10 }; } }
    const row = [...document.querySelectorAll(`.pl[data-seat="${i}"]`)].find(el => el.offsetParent);
    if (row) { const r = row.getBoundingClientRect(); return { x: r.left + r.width / 2 - W / 2, y: r.top + r.height / 2 - H / 2 }; }
    return { x: cx, y: -H };
  });
  for (let round = 0; round < 3 && ui.dealing; round++) {
    for (let i = 0; i < seats.length && ui.dealing; i++) {
      const el = document.createElement('img');
      el.src = 'assets/ecology-back.png'; el.className = 'deal-card';
      Object.assign(el.style, { width: W + 'px', height: H + 'px', left: cx + 'px', top: cy - N * 1.5 + 'px', zIndex: 100 });
      $deal.appendChild(el);
      const t = seats[i], spin = (Math.random() - 0.5) * 40;
      const anim = el.animate([
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: `translate(${t.x - cx}px, ${t.y - (cy - N * 1.5)}px) rotate(${spin}deg) scale(${i === S.you ? 1 : 0.45})`, opacity: i === S.you ? 1 : 0.15 },
      ], { duration: 340, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
      anim.onfinish = () => el.remove();
      tone(i === S.you ? 900 : 700, 0.03, { vol: 0.04 });
      await wait(110);
    }
  }
  await wait(380);
  finishDeal();
}

// ---------- wiring ----------
function wire() {
  const q = (sel, fn) => $app.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.stopPropagation(); fn(el, e); }));
  q('#speed', () => lobby('speed', { speed: SPEED_ORDER[(SPEED_ORDER.indexOf(S.speed) + 1) % SPEED_ORDER.length] }));
  q('#mute', () => { muted = !muted; try { localStorage.setItem('eg_mute', muted ? '1' : '0'); } catch {} render(); });
  q('#rules', () => { ui.showRules = true; ui.showLog = false; render(); });
  q('#notesBtn', () => { ui.showLog = !ui.showLog; ui.unread = 0; render(); });
  q('#closeRules', () => { ui.showRules = false; render(); });
  q('#quit', () => { if (confirm('Leave this game?')) leave(); });
  q('#quit2', () => leave());
  q('#rematch', () => lobby('rematch'));
  q('[data-botify]', el => lobby('botify', { pid: el.dataset.botify }));
  q('[data-role]', el => { hidePeek(); act({ type: 'pickRole', role: el.dataset.role }); });
  q('[data-choose]', el => { hidePeek(); act({ type: 'chooseBiome', biome: el.dataset.choose }); });
  $app.querySelectorAll('[data-place]').forEach(el => el.addEventListener('click', () => act({ type: 'place', region: el.dataset.place })));
  q('[data-pick]', el => {
    const [region, kind] = el.dataset.pick.split(':');
    if (ui.mode === 'landdev') { ui.mode = null; act({ type: 'ability', region, kind }); }
    else act({ type: 'predate', region, kind });
  });
  q('#predDone', () => act({ type: 'predateDone' }));
  q('[data-tour]', el => act({ type: 'tourDecide', bottom: el.dataset.tour === '1' }));
  q('#cancelMode', () => { ui.mode = null; ui.swapHand = ui.swapPile = null; render(); });
  q('#ability', () => {
    if (S.role === 'Tourist') return act({ type: 'ability' });
    if (S.role === 'LandDeveloper') { ui.mode = 'landdev'; return render(); }
    ui.mode = 'swap'; ui.swapHand = ui.swapPile = null; render();
  });
  q('[data-sh]', el => { ui.swapHand = el.dataset.sh; ui.swapPile = null; render(); });
  q('[data-sp]', el => { ui.swapPile = el.dataset.sp; render(); });
  q('#doSwap', () => { const a = { type: 'ability', handCard: ui.swapHand, pileCard: ui.swapPile }; ui.mode = null; ui.swapHand = ui.swapPile = null; act(a); });
  q('[data-hand]', el => {
    const id = el.dataset.hand;
    if (!isMine() || S.phase !== 'play' || S.step || S.tourPeek || ui.mode) return;
    if (!S.legal.includes(id)) { SFX.error(); return showToast(`You must follow ${BIOMES[S.trick.biome].suit} or play an Invasive card.`); }
    hidePeek();
    if (ui.sel === id && !(S.role === 'Conservationist' && CARDS[id].kind === 'Invasive')) return tryPlay(id);
    ui.sel = id; render();
  });
  q('#play', () => tryPlay(ui.sel));
  q('#playNoPop', () => tryPlay(ui.sel, false));
  q('#cfCancel', () => { ui.confirm = null; render(); });
  q('#cfPlay', () => {
    const off = document.getElementById('cfOff')?.checked;
    if (off) try { sessionStorage.setItem('eg_nowarn_' + S.room, '1'); } catch {}
    const { card, populate } = ui.confirm; ui.confirm = null; act({ type: 'play', card, populate });
  });
  q('#cfUse', () => {
    ui.confirm = null;
    if (S.role === 'Tourist') return act({ type: 'ability' });
    if (S.role === 'LandDeveloper') { ui.mode = 'landdev'; return render(); }
    ui.mode = 'swap'; ui.swapHand = ui.swapPile = null; render();
  });
}

connect();
render();
