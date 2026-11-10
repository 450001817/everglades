// Everglades — browser client. Renders whatever the server says the game looks like.
'use strict';
const { CARDS, REGIONS, BIOMES, ROLES } = window.EG_DATA;
const $app = document.getElementById('app');
const $peek = document.getElementById('peek');
const $toast = document.getElementById('toast');

let S = null;               // latest game view from the server
let es = null;              // live connection
let sess = loadSess();      // { room, token }
const ui = { showLog: false, unread: 0, sel: null, mode: null, swapHand: null, swapPile: null, err: '', lastRound: null, showRules: false, fresh: null };

const ACTIVE_ABILITY = {
  Fisherman: 'Swap with scoring pile (Water)',
  Hunter: 'Swap with scoring pile (Land)',
  Researcher: 'Swap with scoring pile',
  LandDeveloper: 'Remove a token',
  Tourist: 'Peek at location deck',
};
const SUIT_ORDER = { Water: 0, Wetland: 1, Land: 2 };

// ---------- map geometry (board art is 1926 x 1932 in these units) ----------
// poly = region outline, label = where its name is printed, sum = where the N/I counter sits (just under the name)
const GEO = {
  FSP: { poly: [[300, 0], [980, 0], [980, 220], [1110, 350], [655, 455], [610, 410], [530, 320], [380, 320], [300, 220]], label: [450, 75, 800, 205], sum: [625, 250] },
  LO: { poly: [[980, 0], [1640, 0], [1640, 90], [1510, 215], [1510, 350], [1110, 350], [1000, 220], [980, 220]], label: [1110, 30, 1420, 170], sum: [1265, 215] },
  M: { poly: [[1640, 0], [1926, 0], [1926, 870], [1510, 870], [1520, 700], [1560, 450], [1510, 350], [1510, 215], [1640, 90]], label: [1730, 765, 1890, 820], sum: [1790, 862] },
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hidePeek(); if (ui.showLog) { ui.showLog = false; render(); } if (ui.showRules) { ui.showRules = false; render(); } } });

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
  if (prev && prev.phase === 'lobby') SFX.start();
  if (live) {
    const lt = S.lastTrick, key = lt ? lt.round + ':' + lt.biome : null;
    const newTrick = key && key !== ui.lastRound;
    if (S.phase === 'ended' && prev.phase !== 'ended') setTimeout(SFX.end, 700);
    if (prev.phase === 'choose' && S.phase === 'play') SFX.travel();
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
    const w = S.players[lt.winner];
    showToast(`${esc(w.name)} wins ${esc(BIOMES[lt.biome].name)} with ${esc(CARDS[lt.card].name)}!` +
      (lt.crisis ? '<small>INVASIVE CRISIS — native populations fall!</small>' : ''), lt.crisis, 4200);
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

function renderLobby() {
  const link = location.origin + location.pathname + '?room=' + S.room;
  const humans = S.lobby.filter(m => !m.bot).length;
  const bots = Math.max(0, 4 - S.lobby.length);
  $app.innerHTML = `
  <div class="landing">
    <div class="paper spiral landing-card stack" style="width:min(560px,100%)">
      <h1 class="logo" style="font-size:42px">EVERGLADES</h1>
      <div><div class="panel-title">Room code</div><span class="room-code">${S.room}</span></div>
      <div class="row"><input class="field" readonly value="${esc(link)}" style="flex:1;font-size:15px"><button id="copy" class="btn small">Copy link</button></div>
      <div>
        <div class="panel-title">At the table (${S.lobby.length}/6)</div>
        ${S.lobby.map(m => `
          <div class="member">
            <span class="dot ${m.online ? '' : 'off'}"></span>
            <span style="flex:1">${esc(m.name)}${m.pid === S.yourPid ? ' <span style="color:var(--red)">(you)</span>' : ''}</span>
            ${m.host ? '<span class="tag host">HOST</span>' : ''}${m.bot ? '<span class="tag bot">BOT</span>' : ''}
            ${S.isHost && m.pid !== S.yourPid ? `<button class="btn small" data-remove="${m.pid}">✕</button>` : ''}
          </div>`).join('')}
      </div>
      ${S.isHost ? `
        <div class="row">
          <button id="addbot" class="btn small" ${S.lobby.length >= 6 ? 'disabled' : ''}>+ Add bot</button>
          <span class="hint">${bots ? `${bots} bot${bots > 1 ? 's' : ''} will join when you start, to make 4 players.` : 'Ready when you are.'}</span>
        </div>
        <button id="start" class="btn primary">Start game</button>`
      : `<p class="hint">Waiting for the host to start… ${humans} player${humans > 1 ? 's' : ''} here.</p>`}
      <button id="leave" class="btn small" style="align-self:flex-start">Leave table</button>
    </div>
  </div>`;
  document.getElementById('copy').onclick = () => { navigator.clipboard?.writeText(link); showToast('Link copied — send it to your friends!'); };
  document.getElementById('leave').onclick = async () => { await lobby('leave'); leave(); };
  if (S.isHost) {
    document.getElementById('addbot').onclick = () => lobby('addBot');
    document.getElementById('start').onclick = () => lobby('start');
    $app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => lobby('remove', { pid: b.dataset.remove }));
  }
}

// ---------- the game table ----------
function cardEl(id, cls = '', extra = '', who = '') {
  const c = CARDS[id];
  return `<div class="card eco ${cls}" data-peek="${c.img}" ${extra}><img src="${c.img}" alt="${esc(c.name)}" loading="lazy">${who ? `<div class="who">${esc(who)}</div>` : ''}</div>`;
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

function playersHtml(mini) {
  return S.players.map((p, i) => {
    const role = ROLES[p.role];
    return `<div class="pl ${S.waiting === i ? 'turn' : ''}" data-peek="${role.img}">
      <div class="nm">${S.waiting === i ? '<span class="arrow">▶</span>' : ''}<span class="name">${esc(p.name)}</span>${i === S.you ? '<span class="you">(you)</span>' : ''}${p.online ? '' : '<span class="dot off" title="offline"></span>'}</div>
      ${mini ? '' : `<div class="meta"><span class="rolename">${esc(role.name)}</span><span>Hand ${p.handCount}</span><span>Tricks ${p.tricks}</span></div>`}
      ${!mini && S.isHost && !p.online && !p.bot && S.phase !== 'ended' ? `<button class="btn small" data-botify="${S.lobby.find(m => m.name === p.name)?.pid || ''}">Give seat to a bot</button>` : ''}
    </div>`;
  }).join('');
}

function tableHtml() {
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
    <div class="played" style="--n:${n}">${S.trick.plays.length ? S.trick.plays.map(pl => cardEl(pl.card, '', '', S.players[pl.p].name)).join('') : '<span class="lastline" style="color:var(--blush)">No cards played yet.</span>'}</div>
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
    return `<div class="slot">${cardEl(id, `${cls} ${ui.sel === id ? 'sel' : ''}`, `data-hand="${id}"`)}</div>`;
  }).join('') || '<span class="hint" style="color:var(--blush)">No cards in hand.</span>';
  const role = S.role ? ROLES[S.role] : null;
  if (peekSrc && !document.querySelector(`[data-peek="${peekSrc}"]`)) { /* card may have left; checked after render */ }

  $app.innerHTML = `
  <div class="topbar">
    <span class="logo-sm">EVERGLADES</span>
    <span class="chip">Room ${S.room}</span>
    ${S.phase !== 'ended' ? `<span class="chip">Round ${S.round}</span>` : ''}
    <span class="spacer"></span>
    <div class="notes-wrap">
      <button class="btn small ${ui.showLog ? 'brass' : ''}" id="notesBtn">Field notes ${ui.unread && !ui.showLog ? `<span class="badge">${ui.unread > 9 ? '9+' : ui.unread}</span>` : ''}▾</button>
      ${ui.showLog ? `<div class="paper spiral notes-drop" id="log"><div class="panel-title">Field notes</div>${S.log.map(l => `<p class="${l.startsWith('INVASIVE') ? 'crisis' : ''}">${esc(l)}</p>`).join('')}</div>` : ''}
    </div>
    <button class="btn small" id="mute" title="Sound on/off">${muted ? '♪ Off' : '♪ On'}</button>
    <button class="btn small" id="rules">Rules</button>
    <button class="btn small" id="quit">Leave</button>
  </div>
  <div class="game">
    <aside class="side">
      <div class="paper spiral players"><div class="panel-title">Players</div>${playersHtml(false)}
        <div class="hint" style="font-size:16px;line-height:1;margin-top:4px">Hover a player to read their role</div></div>
    </aside>
    <section class="boardwrap">${boardHtml()}</section>
    <section class="tablecol">${tableHtml()}</section>
    <section class="handarea">
      ${promptHtml()}
      <div class="handrow">
        <div class="hand">${handHtml}</div>
        ${role ? `<div class="rolebox"><div class="cap">You are the <b>${esc(role.name)}</b></div><div class="card" data-peek="${role.img}"><img src="${role.img}" alt="${esc(role.name)}"></div></div>` : ''}
      </div>
    </section>
  </div>
  ${ui.mode === 'swap' ? swapModal() : ''}
  ${ui.showRules ? rulesModal() : ''}
  ${S.phase === 'ended' ? endModal() : ''}`;

  if (peekSrc && !document.querySelector(`[data-peek="${CSS.escape(peekSrc)}"]`)) hidePeek();
  const logEl = document.getElementById('log'); if (logEl) logEl.scrollTop = logEl.scrollHeight;
  wire();
}

function promptHtml() {
  const myTurn = isMine();
  const w = S.waiting >= 0 ? S.players[S.waiting] : null;
  if (S.phase === 'ended') return `<div class="paper spiral prompt"><div class="msg">Game over!</div></div>`;
  if (!myTurn) {
    let what = S.phase === 'choose' ? 'to choose where to travel' : 'to play';
    if (S.step?.type === 'place') what = `to spread ${CARDS[S.step.card].name}`;
    if (S.step?.type === 'predate') what = `to hunt with ${CARDS[S.step.card].name}`;
    return `<div class="paper spiral prompt"><div class="msg">Waiting for ${esc(w ? w.name : '…')} ${what}…<small>Hover any card for a second to read it.</small></div></div>`;
  }
  const box = (msg, buttons = '') => `<div class="paper spiral prompt yours"><div class="msg">${msg}</div>${buttons}</div>`;
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
  const follow = S.legal.length < S.hand.length ? `Follow ${suit} or play an Invasive card.` : `You can't follow ${suit}, so play anything.`;
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
    return CARDS[id].habitat === need && CARDS[id].impact < CARDS[ui.swapHand].impact;
  };
  const rule = role === 'Researcher' ? 'any card in your scoring pile'
    : `a ${role === 'Fisherman' ? 'Water' : 'Land'} card in your scoring pile with a lower Impact than the hand card`;
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
        <p style="margin-top:0"><b>Each round:</b> the lead player picks a biome from the travel row. Everyone plays one card, in order.</p>
        <p><b>Winning:</b> the highest-Impact card that matches the biome's type wins. Invasive cards match too if their Impact is at or below the current Invasive Risk. If nothing matches, the highest Impact card wins.</p>
        <p><b>Invasive Crisis:</b> if an Invasive card wins, each region loses 1 Native token per Invasive token there (or 1 Invasive token if it has only Invasives).</p>
        <p><b>Scoring:</b> 5 points per trick, plus the objectives on your role card. Everyone's role is public — hover a name to read it.</p>
      </div>
    </div></div></div>`;
}

function endModal() {
  const R = S.results;
  const sorted = R.scores.slice().sort((a, b) => b.total - a.total);
  const endings = R.winners.map(w => {
    const sc = R.scores.find(x => x.p === w);
    const role = ROLES[sc.role];
    return `<div class="ending-label">${esc(sc.name)}'s ending — the ${esc(role.name)} (${sc.good ? 'good' : 'grim'} ending)</div>
      <div class="ending" data-peek="${role.ending}"><img src="${role.ending}" alt="Ending"><div class="shade ${sc.good ? 'right' : 'left'}"></div></div>`;
  }).join('');
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

// ---------- wiring ----------
function wire() {
  const q = (sel, fn) => $app.querySelectorAll(sel).forEach(el => el.addEventListener('click', e => { e.stopPropagation(); fn(el, e); }));
  q('#mute', () => { muted = !muted; try { localStorage.setItem('eg_mute', muted ? '1' : '0'); } catch {} render(); });
  q('#rules', () => { ui.showRules = true; ui.showLog = false; render(); });
  q('#notesBtn', () => { ui.showLog = !ui.showLog; ui.unread = 0; render(); });
  q('#closeRules', () => { ui.showRules = false; render(); });
  q('#quit', () => { if (confirm('Leave this game?')) leave(); });
  q('#quit2', () => leave());
  q('#rematch', () => lobby('rematch'));
  q('[data-botify]', el => lobby('botify', { pid: el.dataset.botify }));
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
    if (ui.sel === id && !(S.role === 'Conservationist' && CARDS[id].kind === 'Invasive')) { ui.sel = null; return act({ type: 'play', card: id }); }
    ui.sel = id; render();
  });
  q('#play', () => { const id = ui.sel; ui.sel = null; hidePeek(); act({ type: 'play', card: id }); });
  q('#playNoPop', () => { const id = ui.sel; ui.sel = null; hidePeek(); act({ type: 'play', card: id, populate: false }); });
}

connect();
render();
