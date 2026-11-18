// Everglades — browser client. Renders whatever the server says the game looks like.
'use strict';
const { CARDS, REGIONS, BIOMES, ROLES, BOSS, CHAR_ANIM, SKINS, CHAT, CHAT_GROUP_NAMES, DISRUPTIONS, FOIL_PRICE, SPLASHES, TREATMENTS, CHAT_SLOTS } = window.EG_DATA;
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
document.addEventListener('keydown', () => audio(), { once: true });

// ---------- music (music.js) ----------
// The title theme on the home page, lobby, loading screen and results; a tenser theme during a game; a darker one
// against the Anaconda in co-op. Switching tracks crossfades (the old one fades out as the new one fades in).
const TRACKS = window.EG_THEME ? Object.fromEntries(Object.entries(EG_THEME.SONGS).map(([k, s]) => [k, EG_THEME.createTheme(() => audio(), s)])) : {};
let musicOn = (() => { try { return localStorage.getItem('eg_music') !== '0'; } catch { return true; } })();
function wantedTrack() {
  if (!musicOn) return null;
  if (!sess || !S || S.phase === 'lobby' || S.phase === 'ended') return 'title';
  return S.coop ? 'coop' : 'match';
}
function updateMusic() {
  const want = wantedTrack();
  for (const [k, tr] of Object.entries(TRACKS)) {
    if (k === want && !tr.playing) tr.start();
    else if (k !== want && tr.playing) tr.stop();
  }
}
// ---------- the title screen ----------
// Every visit that starts on the home page opens on just the title over the animated backdrop, with a slowly
// pulsing "Click to begin". A click (or key) glides the title to where it sits on the home page, then the menu
// fades in around it. The home page is already rendered underneath (hidden), so the title lands exactly on it.
(function intro() {
  if (sess) return; // rejoining a table: straight back in
  const root = document.documentElement;
  root.classList.add('intro-on', 'intro-hold');
  const el = document.createElement('div');
  el.id = 'titlescreen'; el.className = 'titlescreen'; el.setAttribute('role', 'button'); el.tabIndex = 0;
  el.setAttribute('aria-label', 'Everglades: click to begin');
  el.innerHTML = `<div class="intro-title"><h1 class="logo">EVERGLADES</h1><p class="tagline">A trick-taking card game for the River of Grass</p></div>
    <p class="intro-begin">${matchMedia('(hover: none)').matches ? 'Tap' : 'Click'} to begin</p>`;
  document.body.appendChild(el);
  el.focus({ preventScroll: true });
  let started = false;
  const textBox = node => { const r = document.createRange(); r.selectNodeContents(node); return r.getBoundingClientRect(); };
  function begin(e) {
    if (started) return; started = true;
    if (e) { e.preventDefault(); e.stopPropagation(); }
    el.classList.add('going');
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const MOVE = still ? 0 : 1500;
    // where the home page's own title and tagline are
    const pairs = [['.logo', '.hero .logo'], ['.tagline', '.hero .tagline']].map(([a, b]) => [el.querySelector(a), $app.querySelector(b)]);
    for (const [from, to] of pairs) {
      if (!from || !to || still) continue;
      const f = textBox(from), t = textBox(to), k = t.height / f.height; // (k < 1 when the home page is scaled to fit)
      const o = from.getBoundingClientRect(); from.style.transformOrigin = `${f.left - o.left}px ${f.top - o.top}px`;
      from.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${t.left - f.left}px, ${t.top - f.top}px) scale(${k.toFixed(3)})` }],
        { duration: MOVE, easing: 'cubic-bezier(.5, 0, .25, 1)', fill: 'forwards' });
    }
    setTimeout(() => { root.classList.add('intro-reveal'); root.classList.remove('intro-on'); }, still ? 0 : MOVE * 0.55); // the menu fades in
    setTimeout(() => { // the title has landed: hand over to the real one
      root.classList.remove('intro-hold');
      if (still) { el.classList.add('fadeout'); setTimeout(() => el.remove(), 600); } else el.remove();
    }, MOVE);
    setTimeout(() => root.classList.remove('intro-reveal'), MOVE + 1400);
  }
  el.addEventListener('click', begin);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') begin(e); });
})();

// The eye button: hide everything so the animated backdrop can be watched on its own (Escape or the eye brings it back).
function setSceneOnly(on) {
  const root = document.documentElement, eye = document.getElementById('sceneEye');
  if (root.classList.contains('scene-only') === on) return;
  root.classList.toggle('scene-only', on);
  if (on) hidePeek();
  if (eye) {
    eye.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = on ? 'Bring the menus back' : 'Hide the menus and watch the Everglades';
    eye.title = label; eye.setAttribute('aria-label', label);
  }
}
document.getElementById('sceneEye')?.addEventListener('click', () => setSceneOnly(!document.documentElement.classList.contains('scene-only')));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setSceneOnly(false); });
// The music toggle, with the friends dropdown button beside it (top right of the home page and lobby; in the game's top bar)
// (phones show the short labels: <span class="lbl-l"> is hidden and <span class="lbl-s"> shown; see style.css)
const musicLabel = () => `♪ Music: ${musicOn ? 'On' : 'Off'}`;
const musicBtnHtml = (cls = 'musicbtn') => {
  const music = `<button class="btn small" id="musicBtn" data-music title="Music on/off">${musicLabel()}</button>`;
  // phones get the single Menu button instead of the row (see menuHtml)
  return cls ? `<div class="topctl ${cls}">${lbBtnHtml()}${statsBtnHtml()}${friendsBtnHtml()}${music}</div>${menuHtml()}` : lbBtnHtml() + statsBtnHtml() + friendsBtnHtml() + music;
};
document.addEventListener('click', e => {
  if (!e.target.closest('[data-music]')) return;
  musicOn = !musicOn;
  try { localStorage.setItem('eg_music', musicOn ? '1' : '0'); } catch {}
  for (const b of document.querySelectorAll('[data-music]')) {
    if (b.classList.contains('mi')) b.querySelector('.mi-v').textContent = musicOn ? 'On' : 'Off'; else b.innerHTML = musicLabel();
  }
  updateMusic();
});

// ---------- the phone menu ----------
// Phones have no room for a row of buttons, so everything that sits along the top on a computer (leaderboard, stats,
// friends, music, and in a game: chat, field notes, sound, speed, rules, leave) lives in one Menu button with a list.
// Desktop keeps its buttons; style.css shows one or the other.
function menuHtml(game = false) {
  const nFr = frBadgeCount(), badge = n => n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : '';
  const on = fr.data ? fr.data.friends.filter(f => f.online).length : 0;
  const item = (attrs, icon, label, extra = '', cls = '') => `<button class="mi ${cls}" ${attrs}><span class="mi-ic">${icon}</span><span class="mi-l">${label}</span>${extra}</button>`;
  const val = v => `<span class="mi-v">${v}</span>`;
  let main = '', more = '';
  if (game) {
    if (S.you >= 0) main += item('data-g="chat"', '💬', 'Chat lines');
    if (S.role) main += item('data-g="myrole"', '🃏', 'My role card', `<span class="mi-v">${esc(roleInfo(S.role).name)}</span>`);
    main += item('data-g="players"', '📋', 'Players &amp; tricks won');
    if (S.you >= 0) main += item('data-g="pile"', '🗂', 'My scoring pile', `<span class="mi-v">${(S.pile || []).length}</span>`);
    main += item('data-g="notes"', '📜', 'Field notes', badge(ui.unread || 0));
    main += item('data-g="rules"', '📖', 'Rules');
  }
  if (acct.me) {
    main += item('data-lb', '🏆', 'Leaderboard') + item('data-stats', '📊', 'Stats');
    main += item('data-friends', '👥', 'Friends', (on ? `<span class="fon">${on}</span>` : '') + badge(nFr));
  }
  more += item('data-music', '♪', 'Music', val(musicOn ? 'On' : 'Off'), 'keep');
  if (game) {
    more += item('data-g="mute"', '🔊', 'Sound', val(muted ? 'Off' : 'On'), 'keep');
    more += item(`data-g="speed" ${S.isHost ? '' : 'disabled'}`, '⏩', 'Bot speed', val(SPEED_LABEL[S.speed] || 'Normal'), 'keep');
    more += item('data-g="quit"', '🚪', 'Leave game', '', 'danger');
  }
  const head = game ? `<div class="mi-head">${S.tutorial ? 'Tutorial' : `Room <span class="code">${S.room}</span>`}${S.coop ? ' · Co-op' : S.partners ? ' · Partners' : ''}</div>` : '';
  return `<div class="mmenu ${ui.menuOpen ? 'open' : ''}">
    <button class="btn small menubtn ${ui.menuOpen ? 'brass' : ''}" data-menu aria-expanded="${ui.menuOpen ? 'true' : 'false'}" aria-label="Menu">☰ Menu${badge(nFr)}</button>
    <div class="paper menusheet" role="menu">${head}${main}<div class="mi-sep"></div>${more}</div></div>`;
}
function syncMenu() {
  for (const m of document.querySelectorAll('.mmenu')) {
    m.classList.toggle('open', !!ui.menuOpen);
    const b = m.querySelector('[data-menu]'); b.classList.toggle('brass', !!ui.menuOpen); b.setAttribute('aria-expanded', ui.menuOpen ? 'true' : 'false');
  }
}
// (capture: runs before the item's own handler, which may stop the click from bubbling)
document.addEventListener('click', e => {
  if (e.target.closest('[data-menu]')) { ui.menuOpen = !ui.menuOpen; return syncMenu(); }
  if (!ui.menuOpen) return;
  if (e.target.closest('.menusheet') && !e.target.closest('.mi:not(.keep)')) return; // toggles keep the menu open
  ui.menuOpen = false; syncMenu();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.menuOpen) { ui.menuOpen = false; syncMenu(); } });
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

// ---------- player accounts (see accounts.js on the server) ----------
// acct.modal: null | 'profile' | 'store' | { buy: itemId }
const acct = { session: null, me: null, config: null, loading: true, modal: null, msg: '' };
try { acct.session = localStorage.getItem('eg_acct'); } catch {}
function setSession(t) { acct.session = t; try { t ? localStorage.setItem('eg_acct', t) : localStorage.removeItem('eg_acct'); } catch {} }
function deviceKey() { // identifies this browser for its guest account
  let k = null; try { k = localStorage.getItem('eg_device'); } catch {}
  if (!k) { k = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join(''); try { localStorage.setItem('eg_device', k); } catch {} }
  return k;
}
async function acctApi(op, body) {
  const r = await fetch('/api/' + op, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ session: acct.session }, body)) });
  const j = await r.json().catch(() => ({ error: 'Network error.' }));
  if (r.status === 401) { setSession(null); acct.me = null; }
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
async function initAccounts() {
  try { acct.config = await acctApi('config', {}); } catch {}
  if (acct.session) await refreshMe();
  acct.loading = false; render();
  if (acct.me) { finishPurchase(); pollFriends(); }
}
async function refreshMe() { // also collects the daily log-in bonus, once per day
  if (!acct.session) return;
  try {
    const r = await acctApi('me', {}); acct.me = r.me;
    announceBonus(r.bonus);
  } catch {}
}
// daily log-in bonus (paid by the server on the first sign-in or visit of the day)
function announceBonus(n) {
  if (n > 0) setTimeout(() => showToast(`You've got mail! Your daily bonus is waiting.<small>Click the envelope to open it and collect ${n} EB.</small>`, false, 5000), 300);
}
async function signInGuest() {
  try { const r = await acctApi('auth/guest', { deviceKey: deviceKey() }); setSession(r.session); acct.me = r.me; ui.err = ''; announceBonus(r.bonus); pollFriends(); }
  catch (e) { ui.err = e.message; }
  render();
}
async function signInGoogle(credential) {
  try { const r = await acctApi('auth/google', { credential }); setSession(r.session); acct.me = r.me; ui.err = ''; announceBonus(r.bonus); pollFriends(); if (r.gift) setTimeout(() => showToast(`You've got mail: a gift from Goblin Ink!<small>Click the envelope to open it.</small>`, false, 6000), 1200); }
  catch (e) { ui.err = e.message; }
  render();
}
async function signOut() {
  try { await acctApi('auth/signout', {}); } catch {}
  setSession(null); acct.me = null; acct.modal = null;
  fr.data = null; fr.open = false; fr.first = true; renderFriends();
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  render();
}
// ---------- browsers that need special handling for Google sign-in ----------
const UA = navigator.userAgent || '';
const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPads report as Macs
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; // saved to the home screen
const isSafari = /Safari/.test(UA) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\//.test(UA);
// The built-in browsers of other apps, where Google refuses to sign anyone in ("Error 403: disallowed_useragent").
const IN_APP = [['Instagram', /Instagram/], ['Facebook', /FBAN|FBAV|FB_IAB|FBIOS/], ['Messenger', /Messenger|MessengerForiOS/], ['TikTok', /TikTok|musical_ly|BytedanceWebview/],
  ['Snapchat', /Snapchat/], ['LinkedIn', /LinkedInApp/], ['X', /Twitter/], ['Line', /\bLine\//], ['Discord', /Discord/], ['Reddit', /Reddit/]];
function inAppBrowser() {
  const hit = IN_APP.find(([, re]) => re.test(UA));
  if (hit) return hit[0];
  // any other app's built-in browser on iPhone/iPad (no "Safari" in its name, and not saved to the home screen)
  if (isIOS && /AppleWebKit/.test(UA) && !/Safari/.test(UA) && !isStandalone && !/CriOS|FxiOS|EdgiOS|GSA\//.test(UA)) return 'this app';
  return null;
}
// iPhone, iPad, Safari and home-screen mode: Google's sign-in popup can end on a blank white page, so these sign in
// with a full-page redirect instead (Google posts the sign-in to /auth/google; see server.js).
const googleRedirectMode = () => isIOS || isSafari || isStandalone;
// Guest accounts live in browser storage, which Safari erases after 7 days without a visit.
const guestAtRisk = () => (isIOS || isSafari) && !isStandalone;

// "Sign in with Google" button (only when the server has a Google client id set up)
let gsiReady = false;
function mountGoogleButton() {
  const el = document.getElementById('gbtn');
  const cid = acct.config && acct.config.googleClientId;
  if (!el || !cid || el.childElementCount) return; // (already drawn: the page is patched in place, so it stays)
  const app = inAppBrowser();
  if (app) {
    el.innerHTML = `<div class="inapp">Google doesn't allow signing in inside ${esc(app === 'this app' ? 'this app' : app)}'s built-in browser.
      <b>Open this page in ${isIOS ? 'Safari' : 'your browser'}</b>: tap the <b>•••</b> or share menu and choose <i>Open in ${isIOS ? 'Safari' : 'browser'}</i>.
      <button class="btn small" id="copyLink" type="button">Copy link</button></div>`;
    const b = document.getElementById('copyLink');
    if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(location.href); b.textContent = 'Copied!'; } catch { b.textContent = location.href; } };
    return;
  }
  if (!(window.google && google.accounts && google.accounts.id)) {
    if (!document.getElementById('gsi')) {
      const s = document.createElement('script'); s.id = 'gsi'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = mountGoogleButton; document.head.appendChild(s);
    }
    return;
  }
  if (!gsiReady) {
    const opts = { client_id: cid, callback: r => signInGoogle(r.credential) };
    if (googleRedirectMode()) {
      Object.assign(opts, { ux_mode: 'redirect', login_uri: location.origin + '/auth/google' });
      // the redirect lands on the home page: remember a room link the player came in with
      const room = new URLSearchParams(location.search).get('room');
      try { if (room) sessionStorage.setItem('eg_pending_room', room); } catch {}
    }
    google.accounts.id.initialize(opts); gsiReady = true;
  }
  google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular', width: 260 });
}

const fmtEB = n => `<span class="eb">${Number(n || 0).toLocaleString()}<i>EB</i></span>`;
// bots have no accounts: give each one a fitting wildlife picture
const BOT_AVATARS = { Gator: 'AmericanCrocodile', Heron: 'GreatBlueHeron', Manatee: 'Manatee', Otter: 'RiverOtter', Panther: 'FloridaPanther', Stork: 'WoodStork' };
const botAvatar = name => `assets/avatars/animal_${BOT_AVATARS[String(name).split(' ')[0]] || 'Manatee'}.png`;
// A player banner: profile picture, gamertag and (if they own one) a sparkling title
function bannerHtml(p, { you = false, extra = '', size = '' } = {}) {
  return `<div class="pbanner ${size}">
    <img class="pavatar" src="${esc(p.avatarSrc)}" alt="">
    <div class="pb-text">
      <div class="pb-name">${esc(p.gamertag)}${you ? ' <span class="you">(you)</span>' : ''}</div>
      ${p.titleName ? `<div class="pb-title ${['goblin', 'alpha'].includes(p.titleStyle) ? p.titleStyle : 'sparkle'}">${esc(p.titleName)}</div>` : ''}
      ${extra}
    </div></div>`;
}

// Profile: gamertag, profile picture, stats
function profileModal() {
  const me = acct.me, C = acct.config; if (!me || !C) return '';
  const need = C.econ.unlockWins;
  const tile = (a, locked, label, sub) => `<button class="avtile ${me.avatar === a.id ? 'on' : ''} ${locked ? 'locked' : ''}" ${locked ? 'disabled' : `data-avatar="${a.id}"`} title="${esc(label)}">
      <img src="${a.src}" alt="${esc(label)}">${locked ? `<span class="lock">${sub}</span>` : ''}</button>`;
  // the characters, each followed by the skins of it you own
  const ownedSkins = (C.avatars.skins || []).filter(s => me.owned.includes(s.id));
  const chars = C.avatars.characters.map(a => {
    const role = a.id.split(':')[1];
    return tile(a, false, role.replace('LandDeveloper', 'Land Developer')) +
      ownedSkins.filter(s => s.role === role).map(s => tile(s, false, `${s.name} (${ROLES[role].name} skin)`)).join('');
  }).join('');
  const skinNote = (C.avatars.skins || []).length > ownedSkins.length ? ' — skins you buy appear here too' : '';
  const unlockedN = C.avatars.animals.filter(a => me.unlocked.includes(a.id)).length;
  const animals = C.avatars.animals.map(a => {
    const wins = me.cardWins[a.card] || 0, locked = !me.unlocked.includes(a.id);
    return tile(a, locked, `${a.name}${locked ? ` — win ${need} tricks with this card (${wins}/${need})` : ''}`, `${wins}/${need}`);
  }).join('');
  return `<div class="modal"><div class="paper spiral acctmodal">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Your profile</div><button class="btn small" data-close>Close</button></div>
    ${bannerHtml(me, { size: 'big', extra: `<div class="pb-bal">${fmtEB(me.balance)}</div>` })}
    <div class="row" style="flex-wrap:nowrap">
      <input id="tagInput" class="field" maxlength="16" value="${esc(me.gamertag)}" aria-label="Username">
      <button class="btn brass" id="saveTag">Save username</button>
    </div>
    <p class="hint" style="margin:0">Games ${me.stats.games} · First places ${me.stats.firsts} · Won ${Number(me.stats.ebWon).toLocaleString()} EB · Lost ${Number(me.stats.ebLost).toLocaleString()} EB${me.guest ? ' · Guest account (this browser only)' : ''}</p>
    <div class="panel-title" style="margin:6px 0 0">Characters <span class="hint" style="text-transform:none;letter-spacing:0">${skinNote}</span></div>
    <div class="avgrid">${chars}</div>
    <div class="panel-title" style="margin:6px 0 0">Wildlife <span class="hint" style="text-transform:none;letter-spacing:0">— ${unlockedN}/${C.avatars.animals.length} unlocked. Win ${need} tricks with an animal card to unlock its picture.</span></div>
    <div class="avgrid">${animals}</div>
    ${me.staff ? `<div class="giftbox">
      <div class="panel-title" style="margin:0">Gift Eco-bucks <span class="hint" style="text-transform:none;letter-spacing:0">— Goblin Ink staff only</span></div>
      <p class="hint" style="margin:0">The Eco-bucks arrive as a letter in that player's mailbox straight away.</p>
      <div class="row" style="flex-wrap:nowrap">
        <input id="giftTag" class="field" maxlength="16" placeholder="player's username" autocomplete="off" spellcheck="false" style="flex:2">
        <input id="giftAmount" class="field" type="number" min="1" max="100000" value="500" style="flex:1;min-width:90px">
        <button class="btn brass" id="sendGift">Gift</button>
      </div></div>` : ''}
    <div class="error">${esc(acct.msg)}</div>
  </div></div>`;
}
// Store: spend Eco-bucks (items are defined in accounts.js)
function storeModal() {
  const me = acct.me; if (!me || !acct.config) return '';
  // staff accounts also see their exclusive items (never shown to anyone else)
  const C = Object.assign({}, acct.config, { store: acct.config.store.concat(me.exclusiveStore || []) });
  if (acct.modal && acct.modal.buy) {
    const it = C.store.find(i => i.id === acct.modal.buy);
    const isSkin = it.type === 'skin';
    return `<div class="modal"><div class="paper spiral" style="width:min(520px,100%)">
      <div class="panel-title">Confirm purchase</div>
      ${isSkin ? `<div class="row" style="flex-wrap:nowrap;align-items:center;gap:12px;margin:4px 0 10px"><div class="pthumb idle" style="background-image:url('${CHAR_ANIM.src(it.role, 'idle', it.skin)}')"></div>
        <p style="font-size:18px;margin:0">Buy <b>${esc(it.name)}</b>, a ${esc(ROLES[it.role].name)} skin, for ${fmtEB(it.price)}?</p></div>`
        : `<p style="font-size:18px;margin:4px 0 10px">Buy <b>${esc(it.name)}</b> for ${fmtEB(it.price)}?</p>`}
      <p class="hint" style="margin:0 0 12px">Your balance: ${fmtEB(me.balance)} → ${fmtEB(me.balance - it.price)}. Purchases can't be refunded.${isSkin ? ' The skin is equipped as soon as you buy it.' : ''}</p>
      <div class="row"><button class="btn primary" id="confirmBuy">Buy it</button>${isSkin ? `<button class="btn" data-skinshop="${it.role}" data-skinview="${it.skin}">Back</button>` : '<button class="btn" data-store>Back</button>'}</div>
      <div class="error">${esc(acct.msg)}</div>
    </div></div>`;
  }
  // One page per kind of product; the header and tabs stay put and the page scrolls.
  const payOn = !!(C.payments && C.payments.enabled);
  const tab = STORE_TABS[acct.storeTab] && (acct.storeTab !== 'eb' || payOn) ? acct.storeTab : 'skins';
  const ownedOf = type => C.store.filter(it => it.type === type && me.owned.includes(it.id)).length;
  const totalOf = type => C.store.filter(it => it.type === type).length;
  const tabs = Object.entries(STORE_TABS).filter(([k]) => k !== 'eb' || payOn).map(([k, t]) =>
    `<button class="storetab ${k === tab ? 'on' : ''} ${k === 'eb' ? 'ebtab' : ''}" data-storetab="${k}">${t.label}${t.type ? ` <small>${ownedOf(t.type)}/${totalOf(t.type)}</small>` : ''}</button>`).join('');
  let page = '';
  if (tab === 'eb') page = ebStoreHtml(me, C);
  if (tab === 'titles') page = titleStoreHtml(me, C);
  if (tab === 'splash') page = splashStoreHtml(me, C);
  if (tab === 'skins') page = skinStoreHtml(me);
  if (tab === 'chat') page = chatStoreHtml(me);
  if (tab === 'foil') page = foilStoreHtml(me);
  return `<div class="modal"><div class="paper spiral acctmodal storemodal">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Eco-buck store</div><div class="row">Balance ${fmtEB(me.balance)}${payOn && tab !== 'eb' ? '<button class="btn small brass" data-storetab="eb">+ Get EB</button>' : ''}<button class="btn small" data-close>Close</button></div></div>
    <div class="storetabs">${tabs}</div>
    <div class="storepage">${page}</div>
    <div class="error">${esc(acct.msg)}</div>
    <p class="hint" style="margin:0">Earn Eco-bucks by finishing in the top spots at a table.</p>
  </div></div>`;
}
const STORE_TABS = {
  eb: { label: 'Buy Eco-bucks', type: null },
  skins: { label: 'Character skins', type: 'skin' },
  chat: { label: 'Chat lines', type: 'chat' },
  foil: { label: 'Foil cards', type: 'foil' },
  splash: { label: 'Splash effects', type: 'splash' },
  titles: { label: 'Titles', type: 'title' },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-storetab]'); if (!t) return;
  acct.storeTab = t.dataset.storetab; acct.msg = ''; acct.chatConfirm = acct.foilConfirm = null; render();
});
// Eco-buck packs for real money (Stripe Checkout; see payments.js). The price shown is only for display:
// the server sets the real price when it opens the Stripe page.
function ebStoreHtml(me, C) {
  const P = C.payments;
  const guestBlocked = me.guest && C.googleClientId;
  const packs = P.packs.map(p => `<div class="ebpack ${p.tag ? 'best' : ''}">
      ${p.tag ? `<div class="ebtag">${esc(p.tag)}</div>` : ''}
      <div class="ebamt">${fmtEB(p.eb)}</div>
      <div class="hint ebper">${p.eb / p.cents >= 1.1 ? `${Math.round((p.eb / p.cents - 1) * 100)}% more per dollar` : '&nbsp;'}</div>
      <button class="btn primary" data-buypack="${p.id}" ${guestBlocked || acct.paying ? 'disabled' : ''}>${acct.paying === p.id ? 'Opening checkout…' : '$' + (p.cents / 100).toFixed(2)}</button>
    </div>`).join('');
  return `<p class="hint" style="margin:0 0 8px">Top up your Eco-bucks. Payment is handled securely by Stripe, and the Eco-bucks are added as soon as it goes through.</p>
    ${P.testMode ? '<p class="hint" style="margin:0 0 8px;color:var(--red)"><b>Test mode:</b> no real money is charged. Use Stripe\'s test card 4242 4242 4242 4242.</p>' : ''}
    ${guestBlocked ? '<p class="hint" style="margin:0 0 8px;color:var(--red)">Sign in with Google to buy Eco-bucks, so your purchase is safe on every device. (Sign out, then use the Google button.)</p>' : ''}
    <div class="ebpacks">${packs}</div>
    <p class="hint" style="margin:8px 0 0;font-size:15px">Eco-bucks are in-game currency only. They have no cash value and can't be exchanged back for money. By buying, you agree to our <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="refunds.html" target="_blank" rel="noopener">Refund Policy</a>. All sales are final except as the Refund Policy describes.</p>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-buypack]'); if (!b || acct.paying) return;
  acct.paying = b.dataset.buypack; acct.msg = ''; render();
  try { const r = await acctApi('pay/checkout', { pack: acct.paying }); location.href = r.url; }
  catch (err) { acct.paying = null; acct.msg = err.message; render(); }
});
// Coming back from Stripe: ?purchase=success&session_id=... (or ?purchase=cancel)
async function finishPurchase() {
  const q = new URLSearchParams(location.search), status = q.get('purchase');
  if (!status) return;
  const sid = q.get('session_id');
  q.delete('purchase'); q.delete('session_id');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  if (status !== 'success' || !sid) return showToast('Purchase cancelled. You were not charged.');
  for (let i = 0; i < 4; i++) { // the payment can take a moment to settle
    try {
      const r = await acctApi('pay/confirm', { sessionId: sid });
      acct.me = r.me; render();
      if (r.result.credited || r.result.already) { SFX.trickMine && SFX.trickMine(); return showToast(`<b>+${Number(r.result.eb).toLocaleString()} EB</b> added to your wallet. Thank you!`, false, 5200); }
    } catch (err) { return showToast(esc(err.message), true, 6000); }
    await new Promise(r => setTimeout(r, 2500));
  }
  showToast('Your payment is still processing. Your Eco-bucks will appear as soon as it clears.', false, 6000);
}
// Splash effects: preview each one on a sample card, buy it, and pick which one you use.
function splashStoreHtml(me, C) {
  const items = C.store.filter(it => it.type === 'splash').map(it => {
    const owned = me.owned.includes(it.id), using = me.splash === it.splash;
    const action = owned
      ? `<button class="btn ${using ? '' : 'brass'}" data-splashwear="${using ? '' : it.splash}">${using ? 'Turn off' : 'Use this effect'}</button>`
      : `<button class="btn primary" data-buy="${it.id}" ${me.balance < it.price ? 'disabled' : ''}>Buy · ${Number(it.price).toLocaleString()} EB</button>`;
    return `<div class="storeitem">
      <div class="storeprev splashprev"><button class="splashdemo" data-splashpreview="${it.splash}" title="Preview">${cardEl({ splash: 'Manatee', stink: 'BurmesePython', leaves: 'EvergladesCypress' }[it.splash] || 'Flamingo', '', 'data-splashcard="' + it.splash + '"')}<span>▶ Preview</span></button></div>
      <div class="storeinfo"><b>${esc(it.name)}</b><span class="hint">${esc(it.blurb)}</span>
        <span>${it.exclusive ? '<span class="staffex">Goblin Ink staff exclusive</span>' : fmtEB(it.price)}${owned ? ` · <span style="color:var(--native)">${using ? 'In use' : 'Owned'}</span>` : me.balance < it.price ? ` · <span class="hint">you need ${(it.price - me.balance).toLocaleString()} more</span>` : ''}</span></div>
      <div>${action}</div></div>`;
  }).join('');
  return `<p class="hint" style="margin:0 0 8px">Your splash effect bursts from every card you play, and everyone at the table sees it. The one you use here is your default; each character's profile can pick a different one.</p><div class="storelist">${items}</div>`;
}
document.addEventListener('click', async e => {
  const pv = e.target.closest('[data-splashpreview]');
  if (pv) { e.preventDefault(); const card = pv.querySelector('.card'); if (card) playSplash(pv.dataset.splashpreview, card, true); return; }
  const w = e.target.closest('[data-splashwear]'); if (!w) return;
  try { acct.msg = ''; acct.me = (await acctApi('profile', { splash: w.dataset.splashwear || null })).me; } catch (err) { acct.msg = err.message; SFX.error(); }
  render();
});

// ---------- splash effects (pixel-art particles drawn over a card) ----------
// A canvas laid over the card (and a margin around it) for about a second. Drawn at 1/3 resolution and scaled up
// without smoothing, so the particles are chunky pixels like the rest of the game.
const SPLASH_PX = 3;
// Fall leaves: a 3x4 sheet of 9x9 pixel leaves (made by tools/make_leaf_sprites.js), loaded once up front
const LEAF_SHEET = new Image(); LEAF_SHEET.src = 'assets/splash/leaves.png?v=1';
function playSplash(type, el, preview = false) {
  if (!el || !SPLASHES.some(s => s.id === type)) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches && !preview) return;
  const r = el.getBoundingClientRect(); if (!r.width) return;
  const M = Math.round(Math.max(40, r.width * 0.7)); // room around the card for the burst
  const cv = document.createElement('canvas');
  cv.className = 'splashfx';
  const W = Math.ceil((r.width + 2 * M) / SPLASH_PX), H = Math.ceil((r.height + 2 * M) / SPLASH_PX);
  cv.width = W; cv.height = H;
  Object.assign(cv.style, { left: (r.left - M) + 'px', top: (r.top - M) + 'px', width: W * SPLASH_PX + 'px', height: H * SPLASH_PX + 'px' });
  document.body.appendChild(cv);
  const g = cv.getContext('2d');
  const cx = W / 2, cy = H / 2, cw = r.width / SPLASH_PX, ch = r.height / SPLASH_PX;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dot = (x, y, c, s = 1) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), s, s); };
  let parts = [], dur = 1100;
  if (type === 'sparkle') {
    dur = 1200;
    for (let i = 0; i < 32; i++) { // stars burst from the card's edges and twinkle as they drift out
      const a = rnd(0, Math.PI * 2), sp = rnd(10, 34);
      const ex = cx + Math.cos(a) * cw * 0.45, ey = cy + Math.sin(a) * ch * 0.45;
      parts.push({ x: ex, y: ey, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6, big: Math.random() < 0.35, ph: rnd(0, 6), c: ['#fff6b0', '#ffd84a', '#ffffff', '#ffe98a'][i % 4], life: rnd(0.65, 1) });
    }
  } else if (type === 'leaves') { // fall leaves: a gust throws them up from the card, then they tumble and sway down
    dur = 1800;
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? -1 : 1, edge = rnd(0, 0.5);
      parts.push({ x: cx + side * cw * edge, y: cy - ch * rnd(0.1, 0.45), vx: side * rnd(6, 30) * (0.5 + edge), vy: -rnd(35, 75),
        shape: i % 3, col: Math.floor(rnd(0, 4)), spin: rnd(5, 11), ph: rnd(0, 6), sway: rnd(2, 5), delay: rnd(0, 0.18), life: rnd(0.8, 1) });
    }
  } else if (type === 'stink') { // stink cloud: green puffs billow out and drift up, wavy stink lines rise, a fly buzzes
    dur = 1500;
    for (let i = 0; i < 14; i++) { // cloud puffs around the card
      const a = rnd(0, Math.PI * 2);
      parts.push({ kind: 'puff', x: cx + Math.cos(a) * cw * rnd(0.2, 0.5), y: cy + Math.sin(a) * ch * rnd(0.15, 0.45), vx: Math.cos(a) * rnd(4, 12), vy: -rnd(6, 16),
        r: rnd(3, 6), c: ['#7fbf3f', '#9bd34a', '#5e9a2c', '#b6e06a'][i % 4], delay: rnd(0, 0.25), life: rnd(0.8, 1) });
    }
    for (let i = 0; i < 4; i++) parts.push({ kind: 'line', x: cx + (i - 1.5) * cw * 0.28, y: cy - ch * 0.15, ph: rnd(0, 6), delay: 0.1 + i * 0.06, life: 1 });
    parts.push({ kind: 'fly', ph: rnd(0, 6), delay: 0, life: 1 });
  } else { // water splash: a crown of droplets thrown out from the card's base, falling back; a ripple rings out
    const base = cy + ch / 2 - 2;
    for (let i = 0; i < 48; i++) {
      const side = i % 2 ? -1 : 1, edge = rnd(0.15, 0.5); // more droplets from near the card's sides
      parts.push({ x: cx + side * cw * edge, y: base - rnd(0, ch * 0.15), vx: side * rnd(10, 38) * (0.6 + edge), vy: -rnd(45, 95),
        s: Math.random() < 0.55 ? 2 : 1, c: ['#d8f6ff', '#6fd0f4', '#2e8fd0', '#ffffff', '#4fb4e6'][i % 5], life: rnd(0.75, 1) });
    }
  }
  const t0 = performance.now();
  (function frame(now) {
    const t = (now - t0) / dur; // 0..1
    g.clearRect(0, 0, W, H);
    if (t >= 1 || !cv.isConnected) { cv.remove(); return; }
    const dt = (now - t0) / 1000;
    if (type === 'sparkle') {
      // a quick flash around the card first
      if (t < 0.18) { g.globalAlpha = 1 - t / 0.18; g.strokeStyle = '#fff6b0'; g.lineWidth = 1; g.strokeRect(Math.round(cx - cw / 2) - 1, Math.round(cy - ch / 2) - 1, Math.round(cw) + 2, Math.round(ch) + 2); g.globalAlpha = 1; }
      for (const p of parts) {
        if (t > p.life) continue;
        const k = 1 - Math.min(1, dt * 1.6) * 0.6; // slow down as they drift
        const x = p.x + p.vx * dt * k, y = p.y + p.vy * dt * k + 8 * dt * dt;
        const tw = Math.sin(dt * 18 + p.ph) > -0.2; // twinkle
        g.globalAlpha = Math.max(0, 1 - t / p.life);
        if (!tw) { dot(x, y, p.c); continue; }
        dot(x, y, p.c); dot(x - 1, y, p.c); dot(x + 1, y, p.c); dot(x, y - 1, p.c); dot(x, y + 1, p.c); // a little plus-shaped star
        if (p.big && t < 0.6) { dot(x - 2, y, '#ffffff'); dot(x + 2, y, '#ffffff'); dot(x, y - 2, '#ffffff'); dot(x, y + 2, '#ffffff'); }
      }
    } else if (type === 'leaves') {
      g.imageSmoothingEnabled = false;
      for (const p of parts) {
        const q = (t - p.delay) / (p.life - p.delay); if (q <= 0 || q >= 1) continue;
        const tt = dt - p.delay * dur / 1000;
        const fall = Math.min(tt, 0.55), drift = Math.max(0, tt - 0.55); // the gust, then a gentle fall at a steady speed
        const x = p.x + p.vx * fall * (1 - fall * 0.6) + p.vx * 0.25 * drift + Math.sin(tt * 4 + p.ph) * p.sway;
        const y = p.y + p.vy * fall + 70 * fall * fall + 22 * drift;
        const flip = Math.cos(tt * p.spin + p.ph); // tumbling: the leaf turns edge-on and over
        const w = Math.max(1, Math.round(9 * Math.abs(flip)));
        g.globalAlpha = Math.min(1, (1 - q) * 3);
        if (LEAF_SHEET.complete && LEAF_SHEET.naturalWidth) {
          g.save(); g.translate(Math.round(x), Math.round(y)); if (flip < 0) g.scale(-1, 1);
          g.drawImage(LEAF_SHEET, p.shape * 9, p.col * 9, 9, 9, -Math.floor(w / 2), -4, w, 9);
          g.restore();
        } else dot(x, y, ['#c8371f', '#e2731c', '#e0ae22', '#8a5a2b'][p.col], 3); // (sheet not loaded yet)
      }
    } else if (type === 'stink') {
      for (const p of parts) {
        const q = (t - p.delay) / (p.life - p.delay); if (q <= 0 || q >= 1) continue;
        const tt = dt - p.delay * dur / 1000;
        if (p.kind === 'puff') { // a chunky pixel cloud that swells, drifts up and fades
          const x = p.x + p.vx * tt, y = p.y + p.vy * tt, r = p.r * (0.6 + q * 0.9);
          g.globalAlpha = Math.min(1, (1 - q) * 1.6) * 0.85;
          for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy * 1.4 <= r * r) dot(x + xx, y + yy, p.c);
          g.globalAlpha *= 0.9; dot(x - r * 0.4, y - r * 0.5, '#d9f59a', 2); // a highlight
        } else if (p.kind === 'line') { // a wavy stink line rising
          g.globalAlpha = Math.min(1, (1 - q) * 2) * 0.9;
          const top = p.y - tt * 26;
          for (let k = 0; k < 14; k++) dot(p.x + Math.round(Math.sin(k * 0.6 + tt * 9 + p.ph) * 1.5), top - k, '#4f8a1e');
        } else { // one fly buzzing in loops around the card
          g.globalAlpha = 1;
          const fx = cx + Math.cos(tt * 7 + p.ph) * cw * 0.55, fy = cy - ch * 0.35 + Math.sin(tt * 11 + p.ph) * ch * 0.18;
          dot(fx, fy, '#1d1b26', 2); dot(fx - 1, fy - 1, (Math.floor(tt * 30) % 2) ? '#e8f4ff' : '#9fb4c7'); dot(fx + 2, fy - 1, (Math.floor(tt * 30) % 2) ? '#9fb4c7' : '#e8f4ff');
        }
      }
    } else {
      // ripple: two pixel ellipses spreading out under the card
      for (const [delay, col] of [[0, '#7fd6f5'], [0.18, '#bfefff']]) {
        const q = (t - delay) / 0.75; if (q <= 0 || q >= 1) continue;
        const rx = cw * (0.35 + q * 0.55), ry = Math.max(2, rx * 0.22), by = cy + ch / 2 - 2;
        g.globalAlpha = (1 - q) * 0.9;
        for (let a = 0; a < Math.PI * 2; a += 0.12) dot(cx + Math.cos(a) * rx, by + Math.sin(a) * ry, col);
      }
      // the first moment: two columns of spray shooting up from the base corners
      if (t < 0.3) {
        g.globalAlpha = 1 - t / 0.3;
        const hgt = Math.round(ch * 0.55 * Math.sin(Math.min(1, t / 0.15) * Math.PI / 2));
        for (const sx of [cx - cw * 0.42, cx + cw * 0.42]) for (let k = 0; k < hgt; k += 2) dot(sx + (k % 4 ? 1 : -1), cy + ch / 2 - 2 - k, k % 6 ? '#bfefff' : '#ffffff', 2);
      }
      for (const p of parts) {
        if (t > p.life) continue;
        const vy = p.vy + 150 * dt, x = p.x + p.vx * dt, y = p.y + p.vy * dt + 75 * dt * dt; // gravity
        g.globalAlpha = Math.max(0, Math.min(1, (p.life - t) * 4));
        dot(x, y, p.c, p.s);
        if (vy < 0) dot(x, y + p.s, p.c, 1); // a short streak while rising
      }
    }
    g.globalAlpha = 1;
    requestAnimationFrame(frame);
  })(t0);
}

function titleStoreHtml(me, C) {
  const items = C.store.filter(it => it.type === 'title').map(it => {
    const owned = me.owned.includes(it.id), wearing = me.title === it.id;
    const action = owned
      ? `<button class="btn ${wearing ? '' : 'brass'}" data-wear="${wearing ? '' : it.id}">${wearing ? 'Take off' : 'Wear title'}</button>`
      : `<button class="btn primary" data-buy="${it.id}" ${me.balance < it.price ? 'disabled' : ''}>Buy · ${Number(it.price).toLocaleString()} EB</button>`;
    return `<div class="storeitem">
      <div class="storeprev">${bannerHtml(Object.assign({}, me, { titleName: it.name, titleStyle: it.style || 'sparkle' }))}</div>
      <div class="storeinfo"><b>${esc(it.name)}</b><span class="hint">${esc(it.blurb)}</span>
        <span>${it.exclusive ? '<span class="staffex">Goblin Ink staff exclusive</span>' : fmtEB(it.price)}${owned ? ' · <span style="color:var(--native)">Owned</span>' : me.balance < it.price ? ` · <span class="hint">you need ${(it.price - me.balance).toLocaleString()} more</span>` : ''}</span></div>
      <div>${action}</div></div>`;
  }).join('');
  return `<p class="hint" style="margin:0 0 8px">Titles sparkle under your name on your player banner.</p><div class="storelist">${items}</div>`;
}
// Every skin at once, grouped by character: buy, equip, or open the character's shop for the animated preview.
const ownsSkinOk = s => !s.exclusive || !!(acct.me && acct.me.owned.includes('skin:' + s.id)); // staff skins only for their owner
function skinStoreHtml(me) {
  const groups = Object.keys(ROLES).map(role => {
    const on = mySkin(role);
    const tile = s => {
      const id = s ? s.id : null, owned = !s || me.owned.includes('skin:' + s.id), isOn = on === id;
      const action = owned ? (isOn ? '<span class="tag equipped">Equipped</span>' : `<button class="btn small brass" data-equip="${role}:${id || ''}">Equip</button>`)
        : `<button class="btn small primary" data-buy="skin:${s.id}" ${me.balance < s.price ? 'disabled' : ''}>Buy · ${s.price.toLocaleString()} EB</button>`;
      return `<div class="skintile ${isOn ? 'on' : ''}">
        <button class="skinpick" data-skinshop="${role}" data-skinview="${id || ''}" title="Preview ${esc(s ? s.name : 'the original')}"><div class="pthumb idle" style="background-image:url('${CHAR_ANIM.src(role, 'idle', id)}')"></div></button>
        <b>${esc(s ? s.name : 'Original')}</b>${s ? `<span class="hint skinblurb">${esc(s.blurb)}</span>` : ''}${action}</div>`;
    };
    return `<div class="skingroup"><div class="skingroup-title">${esc(ROLES[role].name)}</div>
      <div class="skingrid">${tile(null)}${SKINS.filter(s => s.role === role && ownsSkinOk(s)).map(tile).join('')}</div></div>`;
  }).join('');
  return `<p class="hint" style="margin:0 0 8px">${fmtEB(SKINS[0].price)} each. Everyone at the table sees your skin when you play that character. Click a portrait for the animated preview.</p>${groups}`;
}
// ---------- chat lines (bought in the store, sent during a game) ----------
const chatGroupName = g => CHAT_GROUP_NAMES[g] || (ROLES[g] ? ROLES[g].name : g);
const CHAT_GROUP_ORDER = [...new Set(CHAT.map(c => c.group))];
function chatDropHtml() {
  const me = S.myAccount || {};
  const owned = new Set((me.owned || []).filter(x => x.startsWith('chat:')).map(x => x.slice(5)));
  // the lines equipped for your character (before roles are picked: every character's equipped lines)
  const L = myLoadout(S.role);
  const equipped = new Set(L ? L.chat : Object.values(me.chars || {}).flatMap(c => c.chat));
  const mine = CHAT.filter(c => owned.has(c.id) && equipped.has(c.id));
  if (!owned.size) return `<div class="paper spiral chat-drop"><div class="panel-title">Chat</div>
    <p class="hint" style="margin:0">You don't own any chat lines yet. Buy them in the <b>Store</b> on the home page or in the lobby: every line the bots say, ${CHAT[0].price} EB each.</p></div>`;
  if (!mine.length) return `<div class="paper spiral chat-drop"><div class="panel-title">Chat</div>
    <p class="hint" style="margin:0">No chat lines are equipped for this character. Click the character on the home page to open its profile and equip up to ${CHAT_SLOTS}.</p></div>`;
  // your own character's lines first
  const order = CHAT_GROUP_ORDER.slice().sort((a, b) => (b === S.role) - (a === S.role));
  const groups = order.map(g => {
    const lines = mine.filter(c => c.group === g);
    return lines.length ? `<div class="chat-group"><div class="chat-gname">${esc(chatGroupName(g))}</div>${lines.map(c => `<button class="chat-line" data-chatline="${c.id}">${esc(c.text)}</button>`).join('')}</div>` : '';
  }).join('');
  return `<div class="paper spiral chat-drop"><div class="panel-title">Say something</div>${groups}</div>`;
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-chatline]'); if (!t || !S) return;
  ui.showChat = false; render();
  try { await api('chat', { line: t.dataset.chatline }); }
  catch (err) { SFX.error(); showToast(esc(err.message)); }
});
// Store section: every chat line, grouped, two clicks to buy (Buy → Confirm)
function chatStoreHtml(me) {
  const g = acct.chatGroup && CHAT_GROUP_ORDER.includes(acct.chatGroup) ? acct.chatGroup : CHAT_GROUP_ORDER[0];
  const have = grp => CHAT.filter(c => c.group === grp && me.owned.includes('chat:' + c.id)).length;
  const tabs = CHAT_GROUP_ORDER.map(x => `<button class="skintab ${x === g ? 'on' : ''}" data-chatgroup="${x}">${esc(chatGroupName(x))} <small>${have(x)}/${CHAT.filter(c => c.group === x).length}</small></button>`).join('');
  const rows = CHAT.filter(c => c.group === g).map(c => {
    const owned = me.owned.includes('chat:' + c.id), arming = acct.chatConfirm === c.id;
    const btn = owned ? '<span class="tag equipped">Owned</span>'
      : arming ? `<button class="btn small primary" data-chatbuy="${c.id}">Confirm · ${c.price} EB</button>`
      : `<button class="btn small brass" data-chatarm="${c.id}" ${me.balance < c.price ? 'disabled' : ''}>Buy · ${c.price} EB</button>`;
    return `<div class="chatitem ${owned ? 'owned' : ''}"><span class="chat-quote">“${esc(c.text)}”</span>${btn}</div>`;
  }).join('');
  return `<div class="panel-title" style="margin:6px 0 0">Chat lines <span class="hint" style="text-transform:none;letter-spacing:0">— ${CHAT[0].price} EB each. Everything the bots say. Equip up to ${CHAT_SLOTS} per character in its profile (click a character on the home page), then send them from the 💬 Chat button during a game.</span></div>
    <div class="skintabs">${tabs}</div><div class="chatlist">${rows}</div>`;
}
// Store section: foil versions of every Ecology and Disruption card (seen only by their owner when dealt)
const FOIL_DECKS = { Native: 'Native', Invasive: 'Invasive', Disruption: 'Disruption' };
function foilStoreHtml(me) {
  const deck = FOIL_DECKS[acct.foilDeck] ? acct.foilDeck : 'Native';
  const ids = deck === 'Disruption' ? Object.keys(DISRUPTIONS) : Object.keys(CARDS).filter(id => CARDS[id].kind === deck).sort((a, b) => CARDS[a].name.localeCompare(CARDS[b].name));
  const count = d => (d === 'Disruption' ? Object.keys(DISRUPTIONS) : Object.keys(CARDS).filter(id => CARDS[id].kind === d));
  const tabs = Object.keys(FOIL_DECKS).map(d => `<button class="skintab ${d === deck ? 'on' : ''}" data-foildeck="${d}">${d} <small>${count(d).filter(id => me.owned.includes('foil:' + id)).length}/${count(d).length}</small></button>`).join('');
  const items = ids.map(id => {
    const owned = me.owned.includes('foil:' + id), arming = acct.foilConfirm === id;
    const card = deck === 'Disruption' ? disEl(id, 'foil') : cardEl(id, 'foil');
    const btn = owned ? '<span class="tag equipped">Owned</span>'
      : arming ? `<button class="btn small primary" data-foilbuy="${id}">Confirm · ${FOIL_PRICE} EB</button>`
      : `<button class="btn small brass" data-foilarm="${id}" ${me.balance < FOIL_PRICE ? 'disabled' : ''}>Buy · ${FOIL_PRICE} EB</button>`;
    return `<div class="foilitem">${card}${btn}</div>`;
  }).join('');
  return `<div class="panel-title" style="margin:6px 0 0">Foil cards <span class="hint" style="text-transform:none;letter-spacing:0">— ${FOIL_PRICE} EB each. Whenever the card is dealt to you, it shines as foil (only you see it). Switch foils on or off per character in its profile. Hover a card to read it.</span></div>
    <div class="skintabs">${tabs}</div><div class="foilgrid">${items}</div>`;
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-foildeck],[data-foilarm],[data-foilbuy]'); if (!t) return;
  if (t.dataset.foildeck) { acct.foilDeck = t.dataset.foildeck; acct.foilConfirm = null; return render(); }
  if (t.dataset.foilarm) { acct.foilConfirm = t.dataset.foilarm; acct.msg = ''; return render(); }
  try {
    acct.msg = '';
    const r = await acctApi('store/buy', { item: 'foil:' + t.dataset.foilbuy });
    acct.me = r.me; acct.foilConfirm = null; SFX.end();
    showToast(`New foil card: <b>${esc(r.item.name)}</b>`);
  } catch (err) { acct.msg = err.message; SFX.error(); }
  render();
});
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-chatgroup],[data-chatarm],[data-chatbuy]'); if (!t) return;
  if (t.dataset.chatgroup) { acct.chatGroup = t.dataset.chatgroup; acct.chatConfirm = null; return render(); }
  if (t.dataset.chatarm) { acct.chatConfirm = t.dataset.chatarm; acct.msg = ''; return render(); }
  try {
    acct.msg = '';
    const r = await acctApi('store/buy', { item: 'chat:' + t.dataset.chatbuy });
    acct.me = r.me; acct.chatConfirm = null; SFX.end();
    showToast(`New chat line: <b>“${esc(r.item.name)}”</b>`);
  } catch (err) { acct.msg = err.message; SFX.error(); }
  render();
});

// ---------- character skin shops (open by clicking a character on the home page) ----------
// The skin you have on for a character (null = original). Only skins you own count.
function mySkin(role) {
  const me = acct.me, id = me && me.skins && me.skins[role];
  return id && me.owned.includes('skin:' + id) ? id : null;
}
// ---------- character profiles: skin, chat lines, splash effect and card treatments, per character ----------
// acct.modal = { skins: role, view: skin id being previewed, tab: 'skin' | 'chat' | 'splash' | 'cards' }
const CHAR_TABS = { skin: 'Skin', chat: 'Chat lines', splash: 'Splash effect', cards: 'Card treatments' };
function skinShopModal() {
  const role = acct.modal.skins, R = ROLES[role]; if (!R) return '';
  const me = acct.me;
  const tab = CHAR_TABS[acct.modal.tab] ? acct.modal.tab : 'skin';
  const L = myLoadout(role);
  const roleTabs = Object.keys(ROLES).map(r => `<button class="skintab ${r === role ? 'on' : ''}" data-skinshop="${r}" data-chartab="${tab}">${esc(ROLES[r].name)}</button>`).join('');
  const count = { chat: L ? ` <small>${L.chat.length}/${CHAT_SLOTS}</small>` : '', cards: L ? ` <small>${Object.keys(L.finish).length}</small>` : '' };
  const secTabs = Object.entries(CHAR_TABS).map(([k, label]) => `<button class="storetab ${k === tab ? 'on' : ''}" data-chartab="${k}">${label}${count[k] || ''}</button>`).join('');
  let page;
  if (tab === 'skin') page = charSkinHtml(role);
  else if (!me || !L) page = `<p class="hint">Sign in to set up the ${esc(R.name)}'s ${tab === 'chat' ? 'chat lines' : tab === 'splash' ? 'splash effect' : 'card treatments'}.</p>`;
  else if (tab === 'chat') page = charChatHtml(role, L);
  else if (tab === 'splash') page = charSplashHtml(role, L);
  else page = charCardsHtml(role, L);
  return `<div class="modal"><div class="paper spiral acctmodal storemodal skinshop charprofile">
    <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
      <div class="row" style="flex-wrap:nowrap;gap:10px"><div class="pthumb idle charhead" style="background-image:url('${CHAR_ANIM.src(role, 'idle', mySkin(role))}')"></div>
        <div><div class="panel-title" style="margin:0">${esc(R.name)}</div><span class="hint">Character profile${me ? '' : ' · sign in to customise'}</span></div></div>
      <div class="row">${me ? `Balance ${fmtEB(me.balance)}` : ''}<button class="btn small" data-close>Close</button></div></div>
    <div class="skintabs">${roleTabs}</div>
    <div class="storetabs">${secTabs}</div>
    <div class="storepage">${page}</div>
    <div class="error">${esc(acct.msg)}</div>
  </div></div>`;
}
// Send one change to this character's loadout.
async function saveCharacter(role, change) {
  try { acct.msg = ''; acct.me = (await acctApi('profile', { character: Object.assign({ role }, change) })).me; }
  catch (err) { acct.msg = err.message; SFX.error(); }
  render();
}
// Chat lines: up to CHAT_SLOTS equipped per character; they're the ones in the 💬 Chat menu during a game.
function charChatHtml(role, L) {
  const me = acct.me, R = ROLES[role];
  const owned = CHAT.filter(c => me.owned.includes('chat:' + c.id));
  const full = L.chat.length >= CHAT_SLOTS;
  const slots = Array.from({ length: CHAT_SLOTS }, (_, i) => {
    const c = CHAT.find(x => x.id === L.chat[i]);
    return c ? `<div class="chatitem owned chatslot"><span class="chat-quote">“${esc(c.text)}”</span><span class="row" style="flex-wrap:nowrap;gap:6px"><span class="hint">${esc(chatGroupName(c.group))}</span><button class="btn small" data-chatunequip="${c.id}" title="Unequip">✕</button></span></div>`
      : `<div class="chatitem chatslot empty"><span class="hint">Empty slot ${i + 1}</span></div>`;
  }).join('');
  const groups = CHAT_GROUP_ORDER.slice().sort((a, b) => (b === role) - (a === role)).filter(g => owned.some(c => c.group === g));
  const g = groups.includes(acct.modal.chatGroup) ? acct.modal.chatGroup : groups[0];
  const gtabs = groups.map(x => `<button class="skintab ${x === g ? 'on' : ''}" data-charchatgroup="${x}">${esc(chatGroupName(x))} <small>${owned.filter(c => c.group === x).length}</small></button>`).join('');
  const rows = owned.filter(c => c.group === g).map(c => {
    const on = L.chat.includes(c.id);
    const btn = on ? '<span class="tag equipped">Equipped</span>'
      : `<button class="btn small brass" data-chatequip="${c.id}" ${full ? `disabled title="All ${CHAT_SLOTS} slots are full: unequip a line first"` : ''}>Equip</button>`;
    return `<div class="chatitem ${on ? 'owned' : ''}"><span class="chat-quote">“${esc(c.text)}”</span>${btn}</div>`;
  }).join('');
  return `<p class="hint" style="margin:0 0 8px">Equip up to ${CHAT_SLOTS} of your chat lines for the ${esc(R.name)}. They're the lines in your 💬 Chat menu whenever you play this character.${L.chatCustom ? '' : ' (Until you change them, your first owned lines are equipped, this character\'s own lines first.)'}</p>
    <div class="chatlist chatslots">${slots}</div>
    <div class="panel-title" style="margin:12px 0 4px">Your chat lines <span class="hint" style="text-transform:none;letter-spacing:0">— ${owned.length} owned · <button class="linkbtn" data-gostore="chat">buy more in the store</button></span></div>
    ${owned.length ? `<div class="skintabs">${gtabs}</div><div class="chatlist" style="margin-top:8px">${rows}</div>` : '<p class="hint">You don\'t own any chat lines yet.</p>'}`;
}
// Splash effect: the account-wide one (set in the store), none, or a different owned effect for this character.
function charSplashHtml(role, L) {
  const me = acct.me, R = ROLES[role];
  const ownedFx = SPLASHES.filter(s => me.owned.includes('splash:' + s.id));
  const globalFx = SPLASHES.find(s => s.id === me.splash && me.owned.includes('splash:' + s.id));
  const pick = L.splashCustom ? (L.splash || 'none') : 'default';
  const demoCard = id => ({ splash: 'Manatee', stink: 'BurmesePython', leaves: 'EvergladesCypress' }[id] || 'Flamingo');
  const opt = (val, title, blurb, fx) => `<div class="storeitem ${pick === val ? 'picked' : ''}">
      <div class="storeprev splashprev">${fx ? `<button class="splashdemo" data-splashpreview="${fx}" title="Preview">${cardEl(demoCard(fx))}<span>▶ Preview</span></button>` : `<div class="splashdemo">${cardEl('Flamingo')}<span>No effect</span></div>`}</div>
      <div class="storeinfo"><b>${esc(title)}</b><span class="hint">${esc(blurb)}</span></div>
      <div>${pick === val ? '<span class="tag equipped">In use</span>' : `<button class="btn brass" data-charsplash="${val}">Use</button>`}</div></div>`;
  return `<p class="hint" style="margin:0 0 8px">The burst that plays over every card you play as the ${esc(R.name)}. Everyone at the table sees it.</p>
    <div class="storelist">
      ${opt('default', `Account default${globalFx ? ` (${globalFx.name})` : ' (none)'}`, 'Follows the effect you pick in the store\'s Splash effects tab.', globalFx && globalFx.id)}
      ${opt('none', 'No effect', `The ${R.name}'s cards land without a splash.`, null)}
      ${ownedFx.map(s => opt(s.id, s.name, s.blurb, s.id)).join('')}
    </div>
    <p class="hint">${ownedFx.length ? '' : 'You don\'t own any splash effects yet. '}<button class="linkbtn" data-gostore="splash">Get splash effects in the store</button></p>`;
}
// Card treatments: for each card you own a treatment for (foil, and more later), pick which one this character shows.
function charCardsHtml(role, L) {
  const me = acct.me, R = ROLES[role];
  const ownedTs = id => TREATMENTS.filter(t => me.owned.includes(t.id + ':' + id));
  const decks = { Native: Object.values(CARDS).filter(c => c.kind === 'Native').map(c => c.id), Invasive: Object.values(CARDS).filter(c => c.kind === 'Invasive').map(c => c.id), Disruption: Object.keys(DISRUPTIONS) };
  const mine = Object.fromEntries(Object.entries(decks).map(([d, ids]) => [d, ids.filter(id => ownedTs(id).length)]));
  const all = Object.values(mine).flat();
  if (!all.length) return `<p class="hint">Card treatments make the cards dealt to you shine (only you see them). You don't own any yet: foil versions of every card are in the store.</p>
    <button class="btn brass" data-gostore="foil">Browse foil cards</button>`;
  const deck = mine[acct.modal.deck] && mine[acct.modal.deck].length ? acct.modal.deck : Object.keys(mine).find(d => mine[d].length);
  const tabs = Object.keys(mine).filter(d => mine[d].length).map(d => `<button class="skintab ${d === deck ? 'on' : ''}" data-chardeck="${d}">${d} <small>${mine[d].filter(id => L.finish[id]).length}/${mine[d].length}</small></button>`).join('');
  const items = mine[deck].map(id => {
    const cur = L.finish[id] || 'none', cls = (TREATMENTS.find(t => t.id === cur) || {}).cls || '';
    const opts = [{ id: 'none', name: 'Plain' }, ...ownedTs(id)].map(t => `<button class="seg ${cur === t.id ? 'on' : ''}" data-charfinish="${id}:${t.id}">${esc(t.name)}</button>`).join('');
    return `<div class="foilitem">${deck === 'Disruption' ? disEl(id, cls) : cardEl(id, cls)}<div class="segs">${opts}</div></div>`;
  }).join('');
  return `<p class="hint" style="margin:0 0 8px">Choose, card by card, how your cards look when they're dealt to you as the ${esc(R.name)} (only you see them). New treatments will show up here as they arrive.</p>
    <div class="row" style="justify-content:space-between"><div class="skintabs">${tabs}</div>
      <div class="row"><button class="btn small brass" data-charfinishall="default">Everything on</button><button class="btn small" data-charfinishall="none">All plain</button></div></div>
    <div class="foilgrid" style="margin-top:8px">${items}</div>
    <p class="hint"><button class="linkbtn" data-gostore="foil">Get more foil cards in the store</button></p>`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-chartab]:not([data-skinshop]),[data-charchatgroup],[data-chardeck],[data-chatequip],[data-chatunequip],[data-charsplash],[data-charfinish],[data-charfinishall],[data-gostore]');
  if (!t) return;
  if (t.dataset.gostore) { acct.storeTab = t.dataset.gostore; acct.modal = 'store'; acct.msg = ''; return render(); }
  if (!acct.modal || !acct.modal.skins) return;
  const role = acct.modal.skins, L = myLoadout(role);
  if (t.dataset.chartab) { acct.modal = Object.assign({}, acct.modal, { tab: t.dataset.chartab }); acct.msg = ''; return render(); }
  if (t.dataset.charchatgroup) { acct.modal = Object.assign({}, acct.modal, { chatGroup: t.dataset.charchatgroup }); return render(); }
  if (t.dataset.chardeck) { acct.modal = Object.assign({}, acct.modal, { deck: t.dataset.chardeck }); return render(); }
  if (!L) return;
  if (t.dataset.chatequip) return saveCharacter(role, { chat: L.chat.concat(t.dataset.chatequip) });
  if (t.dataset.chatunequip) return saveCharacter(role, { chat: L.chat.filter(id => id !== t.dataset.chatunequip) });
  if (t.dataset.charsplash) return saveCharacter(role, { splash: t.dataset.charsplash === 'none' ? null : t.dataset.charsplash });
  if (t.dataset.charfinish) { const [card, tr] = t.dataset.charfinish.split(':'); return saveCharacter(role, { finish: { [card]: tr } }); }
  if (t.dataset.charfinishall) {
    const owned = [...Object.keys(CARDS), ...Object.keys(DISRUPTIONS)].filter(id => TREATMENTS.some(x => acct.me.owned.includes(x.id + ':' + id)));
    return saveCharacter(role, { finish: Object.fromEntries(owned.map(id => [id, t.dataset.charfinishall])) });
  }
});
// The Skin tab: the character's skin shop, with the big animated preview.
function charSkinHtml(role) {
  const R = ROLES[role], me = acct.me;
  const skins = SKINS.filter(s => s.role === role && ownsSkinOk(s));
  const on = mySkin(role);
  const view = acct.modal.view !== undefined ? acct.modal.view : on; // which look the big preview shows
  const viewing = skins.find(s => s.id === view);
  const owned = s => !!me && me.owned.includes('skin:' + s.id);
  const tile = (s) => { // s = a skin, or null for the original look
    const id = s ? s.id : null, isOn = on === id;
    let action;
    if (!s || owned(s)) action = isOn ? '<span class="tag equipped">Equipped</span>' : (me ? `<button class="btn small brass" data-equip="${role}:${id || ''}">Equip</button>` : '');
    else if (!me) action = '<span class="hint">Sign in to buy</span>';
    else action = `<button class="btn small primary" data-buy="skin:${s.id}" ${me.balance < s.price ? `disabled title="You need ${(s.price - me.balance).toLocaleString()} more EB"` : ''}>Buy · ${s.price.toLocaleString()} EB</button>`;
    return `<div class="skintile ${view === id ? 'viewing' : ''} ${isOn ? 'on' : ''}">
      <button class="skinpick" data-skinview="${id || ''}" title="Preview ${esc(s ? s.name : 'the original')}">
        <div class="pthumb idle" style="background-image:url('${CHAR_ANIM.src(role, 'idle', id)}')"></div></button>
      <b>${esc(s ? s.name : 'Original')}</b>${action}</div>`;
  };
  return `<div class="skinstage">
      <div class="skinprev"><canvas width="${CHAR_ANIM.w}" height="${CHAR_ANIM.h}" data-role="${role}" data-skin="${view || ''}"></canvas></div>
      <div class="skininfo">
        <h3>${esc(viewing ? viewing.name : 'The original')}</h3>
        <p>${esc(viewing ? viewing.blurb : `The ${R.name} from the role card.`)}</p>
        <p class="hint">Your skin shows in every game where you play the ${esc(R.name)}, for everyone at the table. It's only a new look; the role plays the same.</p>
        <span class="btn small" ${peekAttrs(role, view)}>Hover here to read the role card</span>
      </div>
    </div>
    <div class="skingrid" style="margin-top:10px">${tile(null)}${skins.map(tile).join('')}</div>`;
}
// The big preview in a skin shop plays every animation in turn.
const PREVIEW_ORDER = ['idle', 'signature', 'cheer', 'think', 'shock', 'idle', 'upset'];
function drawSkinPreview() {
  const cv = document.querySelector('.skinprev canvas'); if (!cv) return;
  const role = cv.dataset.role, skin = cv.dataset.skin || null;
  const now = performance.now();
  if (!cv._start || cv._for !== role + skin) { cv._start = now; cv._for = role + skin; }
  let t = now - cv._start, i = 0;
  const total = PREVIEW_ORDER.reduce((x, a) => x + clipLength(a), 0);
  t %= total;
  while (t >= clipLength(PREVIEW_ORDER[i])) { t -= clipLength(PREVIEW_ORDER[i]); i++; }
  let anim = PREVIEW_ORDER[i];
  let frame = reducedMotion.matches ? 0 : Math.floor(t / 1000 * CHAR_ANIM.anims[anim].fps) % CHAR_ANIM.frames;
  let im = sprite(role, anim, skin);
  if (!im.complete || !im.naturalWidth) { frame = 0; im = sprite(role, 'idle', skin); }
  if (!im.complete || !im.naturalWidth) return;
  const key = role + skin + anim + frame;
  if (cv.dataset.k === key) return;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(im, frame * CHAR_ANIM.w, 0, CHAR_ANIM.w, CHAR_ANIM.h, 0, 0, cv.width, cv.height);
  cv.dataset.k = key;
}
const acctModalHtml = () => !acct.modal ? '' : acct.modal === 'profile' ? profileModal() : acct.modal === 'mail' ? mailModal() : acct.modal.skins ? skinShopModal() : storeModal();

// ---------- mailbox: daily bonuses and staff gifts arrive as letters to open ----------
const ENVELOPE_SVG = (open = false) => `<svg viewBox="0 0 16 12" width="32" height="24" shape-rendering="crispEdges" aria-hidden="true">
  <path fill="#1f1b26" d="M0 ${open ? 4 : 0}h16v${open ? 8 : 12}H0z"/>
  <path fill="#fff7e0" d="M1 ${open ? 5 : 1}h14v${open ? 6 : 10}H1z"/>
  ${open ? '<path fill="#e8d9b0" d="M1 5h14L8 0z"/><path fill="#1f1b26" d="M0 4h1v1H0zM15 4h1v1h-1zM1 3h2v1H1zM13 3h2v1h-2zM3 2h2v1H3zM11 2h2v1h-2zM5 1h2v1H5zM9 1h2v1H9zM7 0h2v1H7z"/><path fill="#2a9a4a" d="M5 6h6v4H5z"/><path fill="#fff" d="M7 7h2v2H7z"/>'
    : '<path fill="#e8d9b0" d="M1 1h14v1h-1v1h-2v1h-2v1H6V4H4V3H2V2H1z"/><path fill="#1f1b26" d="M2 2h1v1H2zM13 2h1v1h-1zM4 3h2v1H4zM10 3h2v1h-2zM6 4h4v1H6z"/><path fill="#d6343c" d="M7 5h2v2H7z"/>'}
</svg>`;
function mailButtonHtml(me) {
  const n = (me.inbox || []).length;
  return `<button class="btn small mailbtn ${n ? 'hasmail' : ''}" data-mail title="${n ? `You have ${n} unopened letter${n > 1 ? 's' : ''}` : 'Your mailbox is empty'}">${ENVELOPE_SVG(false)}${n ? `<span class="mailcount">${n}</span>` : ''}</button>`;
}
function mailModal() {
  const me = acct.me; if (!me) return '';
  const inbox = (me.inbox || []).slice().reverse();
  const letter = m => `<div class="letter ${m.kind}">
      <div class="lenv">${ENVELOPE_SVG(false)}</div>
      <div class="ltext"><b>${esc(m.note || (m.kind === 'gift' ? 'A gift' : 'Daily bonus'))}</b><span class="hint">${new Date(m.at).toLocaleDateString()} · ${m.itemName ? `the “${esc(m.itemName)}” title${m.amount ? ` and ${fmtEB(m.amount)}` : ''} inside` : `${fmtEB(m.amount)} inside`}</span></div>
      <button class="btn primary" data-openmail="${m.id}">Open</button></div>`;
  return `<div class="modal"><div class="paper spiral acctmodal mailmodal">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Mailbox</div><div class="row">${inbox.length > 1 ? '<button class="btn small brass" data-openmail="all">Open all</button>' : ''}<button class="btn small" data-close>Close</button></div></div>
    ${acct.mailOpened ? `<div class="mailopened">${ENVELOPE_SVG(true)}<div>${acct.mailOpened.amount ? `<b>+${Number(acct.mailOpened.amount).toLocaleString()} EB</b> added to your wallet!` : ''}${acct.mailOpened.items.map(n => `<div>New title unlocked: <b>${esc(n)}</b>! Wear it from Store → Titles.</div>`).join('')}</div></div>` : ''}
    ${inbox.length ? `<div class="letters">${inbox.map(letter).join('')}</div>` : `<p class="hint" style="margin:6px 0">No letters right now. Your daily bonus arrives here each day you visit.</p>`}
    <div class="error">${esc(acct.msg)}</div>
  </div></div>`;
}
document.addEventListener('click', async e => {
  const mb = e.target.closest('[data-mail]');
  if (mb) { acct.modal = 'mail'; acct.msg = ''; acct.mailOpened = 0; if (acct.me) await refreshMe(); render(); return; }
  const om = e.target.closest('[data-openmail]'); if (!om) return;
  try {
    const r = await acctApi('mail/open', { id: om.dataset.openmail });
    acct.me = r.me; acct.mailOpened = { amount: r.amount, items: r.items || [] }; acct.msg = '';
    SFX.trickMine && SFX.trickMine();
  } catch (err) { acct.msg = err.message; SFX.error(); }
  render();
});
// ---------- friends: requests by username, who's online, and invites to your table ----------
// The dropdown lives in its own element outside #app, so the constant re-renders of a game don't disturb it
// (or wipe what you're typing). The list is polled every 20 seconds, which also tells the server you're online.
const fr = { open: false, data: null, msg: '', busy: false, confirmRemove: null, seenInvites: new Set(), first: true };
const $friends = document.createElement('div'); $friends.id = 'friendsPanel'; $friends.className = 'paper spiral friendspanel hidden';
document.body.appendChild($friends);
const frBadgeCount = () => fr.data ? fr.data.incoming.length + fr.data.invites.length : 0;
function friendsBtnHtml() {
  if (!acct.me) return '';
  const n = frBadgeCount(), on = fr.data ? fr.data.friends.filter(f => f.online).length : 0;
  return `<button class="btn small friendsbtn ${fr.open ? 'brass' : ''}" data-friends title="Friends${on ? ` (${on} online)` : ''}">👥 Friends${on ? ` <span class="fon">${on}</span>` : ''}<span class="fbadge">${n ? `<span class="badge">${n > 9 ? '9+' : n}</span>` : ''}</span><span class="caret"> ▾</span></button>`;
}
function refreshFriendsBtns() { // update the buttons in place (no full re-render)
  for (const b of document.querySelectorAll('[data-friends]:not(.mi)')) b.outerHTML = friendsBtnHtml();
  // the phone menu's badge (friend requests and table invites)
  const n = frBadgeCount();
  for (const b of document.querySelectorAll('[data-menu]')) { b.querySelector('.badge')?.remove(); if (n) b.insertAdjacentHTML('beforeend', `<span class="badge">${n > 9 ? '9+' : n}</span>`); }
}
async function pollFriends() {
  if (!acct.session || !acct.me) { fr.data = null; return; }
  if (document.hidden) return; // a background tab doesn't poll (it catches up the moment it's shown again)
  try { applyFriends(await acctApi('friends', {})); } catch {}
}
function applyFriends(d) {
  fr.data = d;
  // new table invites: tell the player once
  for (const v of d.invites) if (!fr.seenInvites.has(v.id)) {
    fr.seenInvites.add(v.id);
    if (!fr.first) { SFX.chat(); showToast(`<b>${esc(v.from)}</b> invited you to their table!<small>Open 👥 Friends to join.</small>`, false, 6000); }
  }
  fr.first = false;
  refreshFriendsBtns();
  if (fr.open) renderFriends();
}
setInterval(pollFriends, 20000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollFriends(); });
const atLobbyTable = () => sess && S && S.phase === 'lobby' && !S.tutorial;
const inRunningGame = () => sess && S && !S.tutorial && S.phase !== 'lobby' && S.phase !== 'ended';
const STATUS = { game: 'In a game', lobby: 'At a table', tutorial: 'Learning to play' };
function renderFriends() {
  if (!fr.open || !acct.me) { $friends.classList.add('hidden'); return; }
  // keep what's being typed in the add-friend box across re-renders
  const input = document.getElementById('friendName'), typed = input ? input.value : '', focused = document.activeElement === input;
  const d = fr.data;
  const myTable = atLobbyTable() ? new Set(S.lobby.filter(m => m.profile).map(m => m.profile.gamertag.toLowerCase())) : null;
  const who = (f, sub) => `<img class="pavatar tiny" src="${esc(f.avatarSrc)}" alt=""><div class="fname"><b>${esc(f.username)}</b>${sub ? `<span class="hint">${sub}</span>` : ''}</div>`;
  const friendRow = f => {
    if (fr.confirmRemove === f.id) return `<div class="frow">${who(f, 'Remove from friends?')}<button class="btn small" data-unfriend="${f.id}" data-sure="1">Remove</button><button class="btn small" data-unfriend="">Keep</button></div>`;
    const here = myTable && myTable.has(f.username.toLowerCase());
    let btns = '';
    if (f.online && myTable && !here) btns += `<button class="btn small primary" data-invite="${f.id}">Invite</button>`;
    if (here) btns += '<span class="hint">At your table</span>';
    else if (f.room && !(sess && S && S.room === f.room)) btns += `<button class="btn small brass" data-joinroom="${f.room}">Join</button>`;
    btns += `<button class="btn small fx" data-unfriend="${f.id}" title="Remove friend">✕</button>`;
    return `<div class="frow ${f.online ? 'on' : 'off'}"><span class="fdot ${f.online ? 'on' : ''}"></span>${who(f, f.online ? (STATUS[f.where] || 'Online') : 'Offline')}${btns}</div>`;
  };
  let body = '';
  if (!d) body = '<p class="hint">Loading…</p>';
  else {
    if (d.invites.length) body += `<div class="fsec">Table invites</div>` + d.invites.map(v => `<div class="frow invite"><div class="fname"><b>${esc(v.from)}</b><span class="hint">invited you to table ${esc(v.room)}</span></div>
      <button class="btn small primary" data-joinroom="${v.room}">Join</button><button class="btn small fx" data-dismiss="${v.id}" title="Decline">✕</button></div>`).join('');
    if (d.incoming.length) body += `<div class="fsec">Friend requests</div>` + d.incoming.map(f => `<div class="frow">${who(f, 'wants to be friends')}
      <button class="btn small primary" data-frrespond="${f.id}" data-accept="1">Accept</button><button class="btn small" data-frrespond="${f.id}">Decline</button></div>`).join('');
    const online = d.friends.filter(f => f.online), offline = d.friends.filter(f => !f.online);
    body += `<div class="fsec">Online · ${online.length}</div>` + (online.length ? online.map(friendRow).join('') : '<p class="hint fempty">No friends online right now.</p>');
    body += `<div class="fsec">Offline · ${offline.length}</div>` + (offline.length ? offline.map(friendRow).join('') : `<p class="hint fempty">${d.friends.length ? 'Everyone is online!' : 'Add friends by their username above.'}</p>`);
    if (d.outgoing.length) body += `<div class="fsec">Requests you sent</div>` + d.outgoing.map(f => `<div class="frow">${who(f, 'waiting for them to accept')}<button class="btn small" data-unfriend="${f.id}" data-sure="1">Cancel</button></div>`).join('');
  }
  $friends.innerHTML = `<div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Friends</div><button class="btn small" data-friends-close>Close</button></div>
    <div class="row" style="flex-wrap:nowrap;gap:6px"><input id="friendName" class="field" maxlength="16" placeholder="Friend's username" autocomplete="off" spellcheck="false" style="flex:1;min-width:0">
      <button class="btn small brass" id="addFriend" ${fr.busy ? 'disabled' : ''}>Add friend</button></div>
    ${fr.msg ? `<div class="fmsg ${fr.msgErr ? 'error' : ''}">${esc(fr.msg)}</div>` : ''}
    ${atLobbyTable() ? '' : '<p class="hint" style="margin:2px 0 0;font-size:14px">Sit down at a table to invite online friends to it.</p>'}
    <div class="flist">${body}</div>`;
  $friends.classList.remove('hidden');
  const ni = document.getElementById('friendName');
  ni.value = typed; if (focused) { ni.focus(); ni.setSelectionRange(typed.length, typed.length); }
  ni.onkeydown = e => { if (e.key === 'Enter') addFriend(); };
}
function frSay(msg, err = false) { fr.msg = msg; fr.msgErr = err; }
async function frCall(op, body, okMsg) {
  fr.busy = true;
  try { const r = await acctApi(op, body); if (r.friends) applyFriends(r); if (okMsg) frSay(okMsg(r)); return r; }
  catch (e) { frSay(e.message, true); SFX.error(); }
  finally { fr.busy = false; renderFriends(); }
}
async function addFriend() {
  const el = document.getElementById('friendName'); const name = el ? el.value.trim() : '';
  if (!name) { frSay("Type your friend's username.", true); return renderFriends(); }
  const r = await frCall('friends/request', { username: name }, r => r.status === 'friends' ? `You and ${r.to} are now friends!` : `Friend request sent to ${r.to}.`);
  if (r) { const i = document.getElementById('friendName'); if (i) i.value = ''; }
}
// leave the current table (if any) and sit down at another one
async function joinTable(code) {
  if (inRunningGame()) { frSay('Finish (or leave) your game first.', true); return renderFriends(); }
  try {
    if (sess) { try { if (S && S.phase === 'lobby') await api('lobby', { cmd: 'leave' }); } catch {} if (es) es.close(); es = null; S = null; saveSess(null); }
    const r = await acctApi('join', { room: code });
    fr.open = false; renderFriends(); enterRoom(r);
  } catch (e) { frSay(e.message, true); renderFriends(); render(); }
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-friends],[data-friends-close],#addFriend,[data-frrespond],[data-unfriend],[data-invite],[data-joinroom],[data-dismiss]');
  if (!t) { // a click anywhere else closes the dropdown
    if (fr.open && !e.target.closest('#friendsPanel')) { fr.open = false; renderFriends(); refreshFriendsBtns(); }
    return;
  }
  if (t.matches('[data-friends]')) {
    fr.open = !fr.open; fr.msg = ''; fr.confirmRemove = null;
    refreshFriendsBtns(); renderFriends();
    if (fr.open) pollFriends();
  } else if (t.matches('[data-friends-close]')) { fr.open = false; renderFriends(); refreshFriendsBtns(); }
  else if (t.matches('#addFriend')) addFriend();
  else if (t.matches('[data-frrespond]')) {
    const accept = !!t.dataset.accept;
    frCall('friends/respond', { id: t.dataset.frrespond, accept }, r => accept ? `You and ${r.name} are now friends!` : 'Request declined.');
  } else if (t.matches('[data-unfriend]')) {
    const id = t.dataset.unfriend;
    if (!id) { fr.confirmRemove = null; return renderFriends(); }
    if (!t.dataset.sure) { fr.confirmRemove = id; fr.msg = ''; return renderFriends(); }
    fr.confirmRemove = null; frCall('friends/remove', { id }, () => 'Done.');
  } else if (t.matches('[data-invite]')) {
    if (!atLobbyTable()) { frSay('Sit down at a table first.', true); return renderFriends(); }
    frCall('friends/invite', { id: t.dataset.invite, room: S.room }, r => `Invite sent to ${r.to}.`);
  } else if (t.matches('[data-dismiss]')) frCall('friends/dismiss', { id: t.dataset.dismiss }, () => 'Invite declined.');
  else if (t.matches('[data-joinroom]')) joinTable(t.dataset.joinroom);
});

// ---------- stats: your win rate (overall and per character); admins also see the whole server ----------
// Like the friends dropdown, it lives outside #app so game re-renders leave it alone. Fetched each time it opens.
const st = { open: false, tab: 'me', data: null, msg: '' };
const $stats = document.createElement('div'); $stats.id = 'statsPanel'; $stats.className = 'paper spiral friendspanel statspanel hidden';
document.body.appendChild($stats);
function statsBtnHtml() {
  if (!acct.me) return '';
  return `<button class="btn small ${st.open ? 'brass' : ''}" data-stats title="Your win rate and record">📊 Stats<span class="caret"> ▾</span></button>`;
}
const refreshStatsBtns = () => { for (const b of document.querySelectorAll('[data-stats]:not(.mi)')) b.outerHTML = statsBtnHtml(); };
const pctOf = (w, g) => g ? Math.round(100 * w / g) : 0;
const pctTxt = (w, g) => g ? pctOf(w, g) + '%' : '—';
const avg = (sum, n, d = 1) => n ? (sum / n).toFixed(d) : '—';
const roleName = r => (ROLES[r] && ROLES[r].name) || r;
const roleIcon = r => `<img class="pavatar tiny" src="assets/avatars/char_${esc(r)}.png" alt="">`;
const MODE_NAMES = { classic: 'Classic', partners: 'Partners', coop: 'Co-op' };
// a win-rate bar; the tick marks the fair share (0..1) when there is one
const statBar = (w, g, fair) => `<span class="sbar"><span style="width:${pctOf(w, g)}%"></span>${fair ? `<i style="left:${Math.round(100 * fair)}%" title="Fair share: ${Math.round(100 * fair)}%"></i>` : ''}</span>`;
const fmtDur = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; };

function myStatsHtml(r) {
  if (!r || !r.games) return '<p class="hint">No games on record yet. Finish a game (not the tutorial) and your results show up here.</p>';
  const roles = Object.keys(ROLES).map(id => [id, r.roles[id] || { games: 0, wins: 0 }])
    .sort((a, b) => b[1].games - a[1].games || roleName(a[0]).localeCompare(roleName(b[0])));
  const modes = Object.entries(r.modes || {}).filter(([, m]) => m.games);
  return `<div class="sbig"><b>${pctTxt(r.wins, r.games)}</b><span>win rate<br>${r.wins} won · ${r.games - r.wins} lost · ${r.games} game${r.games === 1 ? '' : 's'}</span></div>
    ${modes.length > 1 ? `<div class="schips">${modes.map(([k, m]) => `<span>${MODE_NAMES[k] || k}: <b>${pctTxt(m.wins, m.games)}</b> (${m.games})</span>`).join('')}</div>` : ''}
    <div class="fsec">By character</div>
    <div class="slist">${roles.map(([id, x]) => `<div class="srow ${x.games ? '' : 'off'}">${roleIcon(id)}<div class="fname"><b>${esc(roleName(id))}</b>
      <span class="hint">${x.games ? `${x.wins} of ${x.games} won${x.scored ? ` · avg ${avg(x.score, x.scored)} pts` : ''}` : 'Not played yet'}</span></div>
      ${statBar(x.wins, x.games)}<b class="spct">${pctTxt(x.wins, x.games)}</b></div>`).join('')}</div>
    ${r.since ? `<p class="hint" style="margin:2px 0 0;font-size:13px">Recorded since ${new Date(r.since).toLocaleDateString()}.</p>` : ''}`;
}

function serverStatsHtml(S) {
  if (!S) return '';
  const competitive = Object.entries(S.modes).filter(([k]) => k !== 'coop').reduce((a, [, m]) => a + m.games, 0);
  const tbl = (head, rows) => `<div class="stable"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="hint">No data yet.</td></tr>`}</tbody></table></div>`;
  const tip = t => `<p class="hint stip">${t}</p>`;
  const seatsTxt = x => `${esc(roleName(x.role))}${x.bot ? ' (bot)' : ''} ${x.score}`;
  // characters (classic and partners: the modes where players compete)
  const roleRows = Object.entries(S.roles).sort((a, b) => pctOf(b[1].wins, b[1].seats) - pctOf(a[1].wins, a[1].seats)).map(([id, x]) => {
    const d = x.seats ? Math.round(100 * (x.wins - x.fair) / x.seats) : 0;
    return `<tr><td class="sname">${roleIcon(id)}${esc(roleName(id))}</td><td>${x.seats}</td>
      <td>${statBar(x.wins, x.seats, x.seats ? x.fair / x.seats : 0)} <b>${pctTxt(x.wins, x.seats)}</b></td><td class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '+' : ''}${d}</td>
      <td>${pctTxt(x.hWins, x.hSeats)} <span class="hint">(${x.hSeats})</span></td><td>${avg(x.score, x.seats)}</td><td>${avg(x.tricks, x.seats)}</td>
      <td>${pctTxt(x.good, x.seats)}</td><td>${avg(x.crises, x.seats, 2)}</td><td>${avg(x.pickSum, x.picks)}</td><td>${pctTxt(x.first, x.picks)}</td></tr>`;
  });
  const coopRoles = Object.entries(S.coopRoles).sort((a, b) => b[1].seats - a[1].seats).map(([id, x]) =>
    `<tr><td class="sname">${roleIcon(id)}${esc(roleName(id))}</td><td>${x.seats}</td><td>${statBar(x.wins, x.seats)} <b>${pctTxt(x.wins, x.seats)}</b></td><td>${avg(x.score, x.seats)}</td><td>${pctTxt(x.good, x.seats)}</td></tr>`);
  const seatRows = Object.entries(S.seatOrder).sort((a, b) => +a[0] - +b[0]).map(([k, x]) =>
    `<tr><td>${+k + 1}${['st', 'nd', 'rd'][k] || 'th'}</td><td>${x.seats}</td><td>${statBar(x.wins, x.seats, x.seats ? x.fair / x.seats : 0)} <b>${pctTxt(x.wins, x.seats)}</b></td><td>${pctTxt(x.fair, x.seats)}</td></tr>`);
  const countRows = Object.entries(S.counts).sort((a, b) => +a[0] - +b[0]).map(([k, x]) => {
    const comp = x.games - (x.coop || 0);
    return `<tr><td>${k}</td><td>${x.games}</td><td>${avg(x.topScore, comp)}</td><td>${avg(x.margin, x.margins)}</td><td>${x.coop ? `${pctTxt(x.coopWins, x.coop)} <span class="hint">(${x.coop})</span>` : '—'}</td></tr>`;
  });
  const cards = Object.entries(S.cards).filter(([id]) => CARDS[id]).map(([id, c]) => ({ id, c, r: c.played ? c.won / c.played : 0 }))
    .sort((a, b) => b.r - a.r || b.c.played - a.c.played);
  const cardRows = cards.map(({ id, c }) => `<tr><td class="sname">${esc(CARDS[id].name)}</td><td><span class="ckind ${CARDS[id].kind === 'Invasive' ? 'inv' : ''}">${CARDS[id].kind}</span></td>
    <td>${CARDS[id].impact ?? ''}</td><td>${c.played}</td><td>${c.won}</td><td>${statBar(c.won, c.played)} <b>${pctTxt(c.won, c.played)}</b></td></tr>`);
  const disRows = Object.entries(S.dis).filter(([id]) => DISRUPTIONS[id]).sort((a, b) => b[1].played - a[1].played).map(([id, x]) => {
    const comp = x.played - (x.coop || 0);
    return `<tr><td class="sname">${esc(DISRUPTIONS[id].name)}</td><td>${x.played}</td><td>${statBar(x.wins, x.played, comp ? x.fair / comp : 0)} <b>${pctTxt(x.wins, x.played)}</b></td><td>${pctTxt(x.fair, comp)}</td></tr>`;
  });
  const recent = S.recent.map(g => `<tr><td>${new Date(g.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
    <td>${MODE_NAMES[g.mode] || g.mode}${g.dis ? ' + Dis.' : ''}</td><td>${g.n}</td><td>${g.rounds}</td><td>${fmtDur(g.ms)}</td>
    <td>${g.mode === 'coop' ? `${g.playersWin ? 'Players' : 'Anaconda'} (${g.seats.reduce((a, x) => a + x.score, 0)}–${g.anaconda ?? '?'})` : g.seats.filter(x => x.win).map(seatsTxt).join(', ')}</td>
    <td class="hint">${g.mode === 'coop' ? g.seats.map(seatsTxt).join(', ') : g.seats.filter(x => !x.win).map(seatsTxt).join(', ')}</td></tr>`);
  const A = S.accounts || {};
  const modes = Object.entries(S.modes).map(([k, m]) => `<span>${MODE_NAMES[k] || k}: <b>${m.games}</b>${k === 'coop' ? ` · players win ${pctTxt(m.wins, m.games)}` : ''}</span>`).join('');
  return `<div class="stiles">
      <div><b>${S.games}</b><span>games</span></div>
      <div><b>${S.games ? fmtDur(S.ms / S.games) : '—'}</b><span>avg length</span></div>
      <div><b>${avg(S.rounds, S.games)}</b><span>avg rounds</span></div>
      <div><b>${pctTxt(S.humanSeats, S.humanSeats + S.botSeats)}</b><span>seats played by people</span></div>
      <div><b>${pctTxt(S.disruptionGames, S.games)}</b><span>with Disruptions</span></div>
      <div><b>${avg(S.crises, S.games, 2)}</b><span>Invasive Crises / game</span></div>
      <div><b>${pctTxt(S.ties, S.modes.classic ? S.modes.classic.games : 0)}</b><span>classic games tied</span></div>
      <div><b>${A.played ?? '—'}</b><span>players with a game · ${A.activeWeek ?? 0} this week</span></div>
    </div>
    <div class="schips">${modes}<span>Accounts: <b>${A.total ?? '—'}</b> (${A.google ?? 0} Google, ${A.guests ?? 0} guest)</span></div>
    <div class="fsec">Characters — classic &amp; partners (${competitive} games)</div>
    ${tip('Win % counts every seat, bots included; the tick on each bar is the fair share for the table sizes played, and ±fair is how many points above or below it. People = win % of the seats played by people. Pick = average place in the role draft (1 = first).')}
    ${tbl(['Character', 'Seats', 'Win %', '±fair', 'People', 'Avg pts', 'Tricks', 'Good end', 'Crises', 'Pick', '1st pick'], roleRows)}
    <div class="fsec">Characters — co-op</div>
    ${tbl(['Character', 'Seats', 'Players won', 'Avg pts', 'Good end'], coopRoles)}
    <div class="fsec">Turn order — classic</div>
    ${tip('Does going first (or last) help? Seat 1 leads the first round.')}
    ${tbl(['Seat', 'Games', 'Win %', 'Fair'], seatRows)}
    <div class="fsec">Table size</div>
    ${tbl(['Players', 'Games', 'Avg top score', 'Avg winning margin', 'Co-op won'], countRows)}
    <div class="fsec">Disruptions</div>
    ${tip("Win % of the player who played it (in co-op: whether the players' team won).")}
    ${tbl(['Disruption', 'Played', 'Owner won', 'Fair'], disRows)}
    <details class="sdetails"><summary>Ecology cards: how often each wins the trick it's played in (${cards.length})</summary>
      ${tbl(['Card', 'Kind', 'Impact', 'Played', 'Won', 'Win %'], cardRows)}</details>
    <details class="sdetails" open><summary>Recent games (${S.recent.length})</summary>
      ${tbl(['When', 'Mode', 'Players', 'Rounds', 'Length', 'Won', 'Others'], recent)}</details>
    <p class="hint stip">Recorded since ${new Date(S.since).toLocaleDateString()}. Tutorials are not counted.</p>`;
}
function renderStats() {
  if (!st.open || !acct.me) { $stats.classList.add('hidden'); return; }
  const d = st.data, admin = !!(d && d.server);
  const tab = admin ? st.tab : 'me';
  $stats.classList.toggle('wide', tab === 'server');
  $stats.innerHTML = `<div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Stats</div><button class="btn small" data-stats-close>Close</button></div>
    ${admin ? `<div class="row stabs"><button class="btn small ${tab === 'me' ? 'brass' : ''}" data-stats-tab="me">My record</button><button class="btn small ${tab === 'server' ? 'brass' : ''}" data-stats-tab="server">Server summary</button></div>` : ''}
    ${st.msg ? `<div class="fmsg error">${esc(st.msg)}</div>` : ''}
    <div class="flist">${!d ? '<p class="hint">Loading…</p>' : tab === 'server' ? serverStatsHtml(d.server) : myStatsHtml(d.me)}</div>`;
  $stats.classList.remove('hidden');
}
async function loadStats() {
  try { st.data = await acctApi('stats', {}); st.msg = ''; } catch (e) { st.msg = e.message; }
  renderStats();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-stats],[data-stats-close],[data-stats-tab]');
  if (!t) { // a click anywhere else closes the dropdown
    if (st.open && !e.target.closest('#statsPanel')) { st.open = false; renderStats(); refreshStatsBtns(); }
    return;
  }
  if (t.matches('[data-stats]')) { st.open = !st.open; st.msg = ''; refreshStatsBtns(); renderStats(); if (st.open) loadStats(); }
  else if (t.matches('[data-stats-close]')) { st.open = false; renderStats(); refreshStatsBtns(); }
  else if (t.matches('[data-stats-tab]')) { st.tab = t.dataset.statsTab; renderStats(); }
});

// ---------- leaderboards: who earned the most Eco-bucks from games today, this month and of all time ----------
// Another dropdown beside Stats (outside #app, fetched each time it opens or switches tab).
const lb = { open: false, period: 'day', data: {}, msg: '' };
const $lb = document.createElement('div'); $lb.id = 'lbPanel'; $lb.className = 'paper spiral friendspanel statspanel lbpanel hidden';
document.body.appendChild($lb);
function lbBtnHtml() {
  if (!acct.me) return '';
  return `<button class="btn small ${lb.open ? 'brass' : ''}" data-lb title="Who earned the most Eco-bucks">🏆 <span class="lbl-l">Leaders</span><span class="lbl-s">Top</span><span class="caret"> ▾</span></button>`;
}
const refreshLbBtns = () => { for (const b of document.querySelectorAll('[data-lb]:not(.mi)')) b.outerHTML = lbBtnHtml(); };
const LB_TABS = [['day', 'Today'], ['month', 'This month'], ['all', 'All time']];
function lbUntil(ts) { // "resets in 5 h 12 min" / "in 3 days"
  const m = Math.max(1, Math.round((ts - Date.now()) / 60000));
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} days`;
}
function renderLb() {
  if (!lb.open || !acct.me) { $lb.classList.add('hidden'); return; }
  const d = lb.data[lb.period];
  const medal = r => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : '#' + r;
  const row = (x, cls = '') => `<div class="lbrow ${cls} ${x.id === acct.me.id ? 'me' : ''}"><b class="lbrank">${medal(x.rank)}</b>
    <img class="pavatar tiny" src="${esc(x.avatarSrc)}" alt=""><div class="fname"><b>${esc(x.username)}${x.id === acct.me.id ? ' <span class="hint">(you)</span>' : ''}</b>${x.titleName ? `<span class="hint">${esc(x.titleName)}</span>` : ''}</div>${fmtEB(x.eb)}</div>`;
  let body;
  if (!d) body = '<p class="hint">Loading…</p>';
  else {
    body = d.top.length ? d.top.map(x => row(x)).join('') : `<p class="hint">Nobody has earned Eco-bucks ${lb.period === 'day' ? 'today' : lb.period === 'month' ? 'this month' : 'yet'}. Win a game with a buy-in to get on the board!</p>`;
    if (d.me && !d.top.some(x => x.id === d.me.id)) body += `<div class="fsec">You</div>` + row(d.me);
    else if (!d.me) body += `<p class="hint lbnote">You're not on this board yet. Come out ahead in a game with a buy-in to join it.</p>`;
  }
  $lb.innerHTML = `<div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Leaderboard</div><button class="btn small" data-lb-close>Close</button></div>
    <div class="row stabs">${LB_TABS.map(([k, n]) => `<button class="btn small ${lb.period === k ? 'brass' : ''}" data-lb-tab="${k}">${n}</button>`).join('')}</div>
    <p class="hint lbnote">Eco-bucks won from games, beyond the buy-in.${d && d.resetsAt ? ` Starts again in ${lbUntil(d.resetsAt)} (midnight UTC${lb.period === 'month' ? ' on the 1st' : ''}).` : ''}${d && d.players > d.top.length ? ` Top ${d.top.length} of ${d.players}.` : ''}</p>
    ${lb.msg ? `<div class="fmsg error">${esc(lb.msg)}</div>` : ''}
    <div class="flist">${body}</div>`;
  $lb.classList.remove('hidden');
}
async function loadLb() {
  const period = lb.period;
  try { lb.data[period] = await acctApi('leaderboard', { period }); lb.msg = ''; } catch (e) { lb.msg = e.message; }
  if (lb.period === period) renderLb();
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-lb],[data-lb-close],[data-lb-tab]');
  if (!t) { // a click anywhere else closes the dropdown
    if (lb.open && !e.target.closest('#lbPanel')) { lb.open = false; renderLb(); refreshLbBtns(); }
    return;
  }
  if (t.matches('[data-lb]')) { lb.open = !lb.open; lb.msg = ''; lb.data = {}; refreshLbBtns(); renderLb(); if (lb.open) loadLb(); }
  else if (t.matches('[data-lb-close]')) { lb.open = false; renderLb(); refreshLbBtns(); }
  else if (t.matches('[data-lb-tab]')) { lb.period = t.dataset.lbTab; renderLb(); loadLb(); }
});

// clicks inside the profile / store / account panel
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-close],[data-store],[data-profile],[data-avatar],[data-buy],[data-wear],[data-skinshop],[data-skinview],[data-equip],#saveTag,#confirmBuy,#signout,#guest,#sendGift');
  if (!t) return;
  const run = async (fn) => { try { acct.msg = ''; await fn(); } catch (err) { acct.msg = err.message; SFX.error(); } render(); };
  if (t.matches('[data-close]')) { acct.modal = null; acct.msg = ''; render(); }
  else if (t.matches('[data-skinshop]')) {
    acct.modal = { skins: t.dataset.skinshop, tab: t.dataset.chartab || 'skin' }; acct.msg = ''; // switching character keeps the open tab
    if (t.dataset.skinview) acct.modal.view = t.dataset.skinview;
    if (acct.me) await refreshMe();
    render();
  }
  else if (t.matches('[data-skinview]')) { acct.modal = Object.assign({}, acct.modal, { view: t.dataset.skinview || null }); render(); }
  else if (t.matches('[data-equip]')) run(async () => {
    const [role, id] = t.dataset.equip.split(':');
    acct.me = (await acctApi('profile', { skin: { role, id: id || null } })).me;
    acct.modal = { skins: role, view: id || null };
  });  else if (t.matches('[data-store]')) { acct.modal = 'store'; acct.msg = ''; await refreshMe(); render(); }
  else if (t.matches('[data-profile]')) { acct.modal = 'profile'; acct.msg = ''; await refreshMe(); render(); }
  else if (t.matches('[data-avatar]')) run(async () => { acct.me = (await acctApi('profile', { avatar: t.dataset.avatar })).me; });
  else if (t.matches('#saveTag')) run(async () => { acct.me = (await acctApi('profile', { gamertag: document.getElementById('tagInput').value })).me; showToast('Username saved.'); });
  else if (t.matches('[data-buy]')) { acct.modal = { buy: t.dataset.buy }; acct.msg = ''; render(); }
  else if (t.matches('#confirmBuy')) run(async () => {
    const r = await acctApi('store/buy', { item: acct.modal.buy }); acct.me = r.me;
    acct.modal = r.item.type === 'skin' ? { skins: r.item.role, view: r.item.skin } : 'store';
    SFX.end(); showToast(r.item.type === 'skin' ? `You bought <b>${esc(r.item.name)}</b>! Equipped for the ${esc(ROLES[r.item.role].name)}.` : `You bought <b>${esc(r.item.name)}</b>!`);
  });
  else if (t.matches('[data-wear]')) run(async () => { acct.me = (await acctApi('profile', { title: t.dataset.wear || null })).me; });
  else if (t.matches('#sendGift')) run(async () => {
    const tag = document.getElementById('giftTag').value, amount = +document.getElementById('giftAmount').value;
    const r = await acctApi('admin/gift', { tag, amount });
    showToast(`Sent <b>${Number(r.amount).toLocaleString()} EB</b> to ${esc(r.to)}.<small>It's waiting in their mailbox.</small>`, false, 5200);
    document.getElementById('giftTag').value = '';
  });
  else if (t.matches('#signout')) signOut();
  else if (t.matches('#guest')) signInGuest();
});

let toastTimer = null;
function showToast(html, crisis = false, ms = 3200) {
  $toast.innerHTML = html; $toast.className = 'toast' + (crisis ? ' crisis' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.classList.add('hidden'), ms);
}

// ---------- hover (or press-and-hold) for 1 second to read any card ----------
let peekTimer = null, peekSrc = null, peekKey = null;
// A role card (data-peekrole) is shown with its living portrait, in the skin given by data-peekskin.
function showPeek(src, role, skin) {
  $peek.innerHTML = role && ROLES[role] ? roleCardHtml(role, skin) : `<img src="${src}" alt="">`;
  $peek.classList.remove('hidden');
}
function hidePeek() { clearTimeout(peekTimer); peekTimer = null; peekSrc = null; peekKey = null; peekPinned = false; $peek.classList.add('hidden'); $peek.classList.remove('pinned'); }
function armPeek(el) {
  const src = el.dataset.peek, role = el.dataset.peekrole || null, skin = el.dataset.peekskin || null;
  const key = src + '|' + (skin || '');
  if (key === peekKey) return;
  hidePeek(); peekSrc = src; peekKey = key;
  peekTimer = setTimeout(() => showPeek(src, role, skin), 1000);
}
// Touch screens: a tap on a role card (a player, "You are the ...", a portrait) shows it straight away and keeps it up
// until it's tapped again (the card itself or the same player); tapping another player switches to theirs. Holding
// covered the card with the finger. Other cards (hand, biomes) still show while held, since a tap on them plays/picks.
let peekPinned = false, lastPointer = 'mouse';
const roleTap = el => !!(el && el.dataset.peekrole && !el.dataset.role); // (a role you can pick in the draft: a tap picks it)
const peekKeyOf = el => el.dataset.peek + '|' + (el.dataset.peekskin || '');
function pinPeek(el) {
  hidePeek();
  peekSrc = el.dataset.peek; peekKey = peekKeyOf(el); peekPinned = true;
  showPeek(el.dataset.peek, el.dataset.peekrole, el.dataset.peekskin || null);
  // a player's tile (or your own "You are the ..."): what they've done so far, above the card
  const seat = el.dataset.seat !== undefined ? +el.dataset.seat : el.classList.contains('myrole') && S ? S.you : -1;
  if (seat >= 0) $peek.insertAdjacentHTML('afterbegin', seatInfoHtml(seat));
  $peek.insertAdjacentHTML('beforeend', '<div class="peekclose">Tap to close</div>');
  $peek.classList.add('pinned');
}
document.addEventListener('mouseover', e => {
  if (lastPointer === 'touch') return; // (a tap also sends a pretend mouseover)
  const el = e.target.closest('[data-peek]');
  if (el) armPeek(el); else if (peekSrc) hidePeek();
});
document.addEventListener('pointerdown', e => {
  lastPointer = e.pointerType;
  if (e.pointerType !== 'touch') return;
  const el = e.target.closest('[data-peek]');
  if (el && !roleTap(el) && !peekPinned) armPeek(el);
}, true);
document.addEventListener('pointerup', e => { if (e.pointerType === 'touch' && !peekPinned) hidePeek(); });
document.addEventListener('pointercancel', () => { if (!peekPinned) hidePeek(); });
document.addEventListener('click', e => {
  if (lastPointer !== 'touch') return;
  if (e.target.closest('#peek')) { if (peekPinned) hidePeek(); return; } // tapping the card closes it
  const el = e.target.closest('[data-peek]');
  if (!roleTap(el)) return;
  if (peekPinned && peekKeyOf(el) === peekKey) hidePeek(); else pinPeek(el);
}, true);
$peek.addEventListener('click', () => { if (peekPinned) hidePeek(); });
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-peek]')) e.preventDefault(); });
document.addEventListener('click', e => {
  if (ui.showLog && S && !e.target.closest('.notes-wrap')) { ui.showLog = false; render(); }
  if (ui.showChat && S && !e.target.closest('.chat-wrap')) { ui.showChat = false; render(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hidePeek(); if (ui.confirm) { ui.confirm = null; render(); } if (ui.showLog) { ui.showLog = false; render(); } if (ui.showChat) { ui.showChat = false; render(); } if (ui.showRules) { ui.showRules = false; render(); } if (ui.showPlayers) { ui.showPlayers = false; render(); } if (ui.showPile) { ui.showPile = false; render(); } } });

// ---------- connection ----------
function connect() {
  if (es) es.close();
  if (!sess) return render();
  es = new EventSource(`/api/events?room=${encodeURIComponent(sess.room)}&token=${encodeURIComponent(sess.token)}`);
  es.onmessage = ev => { const prev = S; S = JSON.parse(ev.data); if (S.serverNow) ui.clockSkew = S.serverNow - Date.now(); onUpdate(prev); render(); };
  es.addEventListener('kicked', () => leave(`You ran out of time ${S && S.maxStrikes || 3} times, so a bot took over your seat.`));
  es.onerror = async () => { try { await api('lobby', { cmd: 'ping' }); } catch (e) { /* api() handles a vanished room */ } };
}
function leave(msg) {
  if (es) es.close(); es = null; S = null; saveSess(null); hidePeek();
  ui.err = msg || ''; history.replaceState(null, '', location.pathname);
  render();
  refreshMe().then(render);
}
const boardTotal = b => Object.values(b).reduce((a, t) => a + t.n + t.i, 0);

function onUpdate(prev) {
  // newly unlocked animal profile pictures (5 tricks won with that card)
  const un = (S && S.unlocks) || [];
  if (un.length < (ui.unlockSeen || 0)) ui.unlockSeen = 0;
  if (prev && un.length > (ui.unlockSeen || 0)) {
    const id = un[un.length - 1];
    setTimeout(() => showToast(`New profile picture unlocked: <b>${esc(CARDS[id].name)}</b>!<small>Pick it in your Profile.</small>`, false, 5200), 1800);
  }
  ui.unlockSeen = un.length;
  if (S && S.myAccount) acct.me = Object.assign(acct.me || {}, S.myAccount); // keep the wallet current
  if (prev && S && S.phase === 'ended' && prev.phase !== 'ended') setTimeout(() => refreshMe(), 500);
  if (!S || S.phase === 'lobby') { ui.lastRound = null; ui.stage = 'table'; ui.mapNew = false; return; }
  if (!prev || prev.phase === 'lobby') { ui.stage = 'table'; ui.mapNew = false; ui.lastSuit = null; if (window.EG_TERRAIN) EG_TERRAIN.reset(); } // a game starts (or you rejoin one) on the table
  if (S.waiting !== S.you || (S.step && ui.mode)) ui.mode = null;
  // phones: scroll to the map when you must click it, or to the play area when you must pick a biome or role
  if (prev && S.waiting === S.you && S.phase !== 'ended') {
    const stepNow = S.step && S.step.type, stepBefore = prev.step && prev.waiting === S.you && prev.step.type;
    const mapStep = stepNow === 'place' || stepNow === 'predate' || (stepNow === 'dis' && ['remove', 'dest', 'scatter'].includes(S.step.mode));
    if (mapStep && (stepNow !== stepBefore || (stepNow === 'dis' && prev.step.mode !== S.step.mode))) ui.scrollTo = 'board';
    else if (prev.waiting !== S.you && (S.phase === 'choose' || S.phase === 'draft')) ui.scrollTo = 'table';
  }
  // phones: after you've finished clicking the map, go back to the table; while you look at the table, the Map
  // switch shows a dot when the map changes
  const myMapStep = v => v && v.waiting === v.you && v.step && (['place', 'predate'].includes(v.step.type) || (v.step.type === 'dis' && ['remove', 'dest', 'scatter'].includes(v.step.mode)));
  if (prev && myMapStep(prev) && !myMapStep(S) && !ui.scrollTo) ui.scrollTo = 'table';
  if (prev && prev.board && S.board && ui.stage === 'map' && !myMapStep(S) && !ui.scrollTo && S.lastTrick && (!prev.lastTrick || prev.lastTrick.round !== S.lastTrick.round)) ui.scrollTo = 'table'; // a trick just ended: show it
  if (prev && prev.board && S.board && ui.stage !== 'map' && JSON.stringify(prev.board) !== JSON.stringify(S.board)) ui.mapNew = true;
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
  for (const p of S.players || []) if (p.role && !p.boss) preloadChar(p.role, p.skin);
  // the game just started: shuffle and deal
  if (prev && prev.phase === 'lobby' && S.phase === 'draft') { ui.dealing = true; ui.chatSeen = 0; setTimeout(playDeal, 60); }
  if (prev && prev.phase === 'lobby') SFX.start();
  if (live) {
    const lt = S.lastTrick, key = lt ? lt.round + ':' + lt.biome : null;
    const newTrick = key && key !== ui.lastRound;
    if (S.phase === 'ended' && prev.phase !== 'ended') setTimeout(SFX.end, 700);
    if (prev.phase === 'choose' && S.phase === 'play') SFX.travel();
    if (prev.phase === 'draft' && S.players.filter(p => p.role).length > prev.players.filter(p => p.role).length) SFX.trick();
    // splash effects: cards that just landed in the trick, played by someone with an effect equipped
    const nowPlays = S.trick ? S.trick.plays : newTrick ? lt.plays : [];
    const before = new Set(prev.trick ? prev.trick.plays.map(x => x.card) : []);
    for (const pl of nowPlays) if (!before.has(pl.card) && S.players[pl.p] && S.players[pl.p].splash) (ui.fxQueue = ui.fxQueue || []).push({ card: pl.card, type: S.players[pl.p].splash });
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
// ---------- updating the page in place ----------
// Every render builds the screen as HTML, but writing it with innerHTML would throw away and re-create every
// element: portrait canvases came back blank for a frame (a black flash), animations lost their place and
// restarted, and the hand's deal-in replayed on every update. view.html = '...' instead patches the page:
// elements that are still there are kept (only their changed attributes and text are updated), new ones are
// added and gone ones removed. Elements are matched by data-key or id when they have one (so a card keeps its
// element when the cards around it change), otherwise by position and tag. data-keep: leave its insides alone
// (the Google sign-in button draws its own). Event handlers must be set with .onclick or wire()'s on() (not a bare
// addEventListener), so a kept element never ends up with two.
const RUNTIME_ATTRS = new Set(['data-k']); // set by the drawing code, not by the HTML
const ON_PROPS = ['onclick', 'onkeydown', 'onkeyup', 'oninput', 'onchange', 'onsubmit', 'onpointerdown', 'onpointerup', 'onfocus', 'onblur'];
const keyOf = n => n.nodeType === 1 ? (n.getAttribute('data-key') || n.id || null) : null;
const sameKind = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || (a.tagName === b.tagName && keyOf(a) === keyOf(b)));
function patchNode(o, n) {
  if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
  // forget the last render's handlers: a kept element may now be something else (a lobby button's spot can become
  // a card), and every render wires its own handlers again straight after patching
  for (const h of ON_PROPS) if (o[h]) o[h] = null;
  o.__on = null;
  for (const { name } of [...o.attributes]) {
    if (n.hasAttribute(name) || RUNTIME_ATTRS.has(name)) continue;
    if (o.tagName === 'CANVAS' && (name === 'width' || name === 'height')) continue; // a canvas sized by its drawing code (terrain.js)
    o.removeAttribute(name);
  }
  for (const { name, value } of n.attributes) {
    if (o.getAttribute(name) === value) continue;
    o.setAttribute(name, value);
    if (name === 'value' && 'value' in o && o !== document.activeElement) o.value = value;
    if (name === 'checked') o.checked = true;
  }
  if (o.tagName === 'INPUT' && !n.hasAttribute('checked') && (o.type === 'checkbox' || o.type === 'radio')) o.checked = false;
  if (o.tagName === 'CANVAS' || o.hasAttribute('data-keep')) return;
  patchChildren(o, n);
}
function patchChildren(parent, src) {
  const olds = [...parent.childNodes], news = [...src.childNodes];
  const byKey = new Map(); for (const o of olds) { const k = keyOf(o); if (k && !byKey.has(k)) byKey.set(k, o); }
  const free = olds.filter(o => !keyOf(o)); let fi = 0;
  // pair each new node with an old one it can update in place
  const pairs = news.map(n => {
    const k = keyOf(n);
    if (k) { const o = byKey.get(k); if (o && sameKind(o, n)) { byKey.delete(k); return o; } return null; }
    while (fi < free.length) { const o = free[fi++]; if (sameKind(o, n)) return o; }
    return null;
  });
  const kept = new Set(pairs.filter(Boolean));
  for (const o of olds) if (!kept.has(o)) o.remove();
  news.forEach((n, i) => {
    const o = pairs[i], node = o || n;
    if (o) patchNode(o, n);
    const at = parent.childNodes[i];
    if (at !== node) parent.insertBefore(node, at || null);
  });
}
const view = { set html(h) { const t = document.createElement('template'); t.innerHTML = h; patchChildren($app, t.content); } };

function render() {
  renderScreen();
  updateMusic();
  fitScreen();
  // the friends dropdown follows the table you're at (Invite buttons), unless you're typing in it
  if (fr.open && !(document.activeElement && document.activeElement.id === 'friendName')) renderFriends();
}
// Computers: the home page and the lobby never scroll. On a short window their panel is scaled down to fit
// (down to 70%; below that it scrolls rather than become unreadable). Phones scroll these pages normally.
function fitScreen() {
  const L = $app.querySelector('.landing'); if (!L) return;
  const box = L.querySelector('.landing-inner') || L.querySelector('.landing-card'); if (!box) return;
  const was = box.style.zoom;
  box.style.zoom = '';
  if (isPhone()) return;
  if (box.classList.contains('landing-card')) box.style.maxHeight = 'none';
  const room = L.clientHeight - 32, need = box.offsetHeight;
  const z = need > room ? Math.max(0.7, Math.floor(room / need * 1000) / 1000) : 1;
  box.style.zoom = z < 1 ? String(z) : '';
  if (box.classList.contains('landing-card')) box.style.maxHeight = z === 0.7 ? '' : 'none';
  if (box.style.zoom !== was) L.scrollTop = 0;
}
addEventListener('resize', () => { if (!S || S.phase === 'lobby') fitScreen(); });
function renderScreen() {
  // home page, loading screen and lobby sit on the animated backdrop (scenery.js)
  const scenic = !sess || !S || S.phase === 'lobby';
  document.body.classList.toggle('scenic', scenic);
  if (!scenic) setSceneOnly(false); // a game starting always brings the screen back
  if (!sess) return renderLanding();
  if (!S) { view.html = `<div class="landing">${musicBtnHtml()}<div class="paper spiral landing-card"><p class="tagline">Paddling out to the Everglades…</p></div></div>`; return; }
  if (S.phase === 'lobby') return renderLobby();
  renderGame();
}

function renderLanding() {
  let qRoom = new URLSearchParams(location.search).get('room') || '';
  if (!qRoom) try { qRoom = sessionStorage.getItem('eg_pending_room') || ''; if (qRoom && acct.me) sessionStorage.removeItem('eg_pending_room'); } catch {}
  // the six characters, gently idling (CSS steps through each one's idle strip), in the skins you have on.
  // Click one to open its character profile (skin, chat lines, splash effect, card treatments).
  const cast = Object.keys(ROLES).map((r, i) => `<button class="castmember" data-skinshop="${r}" title="${esc(ROLES[r].name)}: character profile">
      <div class="pthumb idle" style="background-image:url('${CHAR_ANIM.src(r, 'idle', mySkin(r))}');animation-delay:-${(i * 0.83).toFixed(2)}s"></div>
      <span class="castname">${esc(ROLES[r].name)}</span><span class="castshop">Profile</span></button>`).join('');
  view.html = `
  <div class="landing home">
    ${musicBtnHtml()}
    <div class="landing-inner">
    <section class="hero">
      <h1 class="logo">EVERGLADES</h1>
      <p class="tagline">A trick-taking card game for the River of Grass</p>
      <div class="paper spiral blurb">
        <p>South Florida's River of Grass is under siege. Burmese pythons slide through the sawgrass, lionfish strip the reefs, and climbing ferns smother whole tree islands. Six travelers head into the Everglades, each chasing a different future for the wetlands.</p>
        <p>Travel the watershed, release wildlife into its habitats, and win tricks to claim what you find. Native species hold the ecosystem together. Let the invaders win, and an <b class="crisisword">Invasive Crisis</b> ripples across the map. When the last card falls, the state of the Everglades decides how each traveler's story ends.</p>
        <p class="stakes"><b>What's at stake:</b> 1.5 million acres of wetland, dozens of endangered species, and the drinking water of 8 million Floridians.</p>
      </div>
      <div class="cast">${cast}</div>
      <div class="facts"><span>2–6 players</span><span>Solo · Partners · Co-op vs The Anaconda</span><span>Bots fill empty seats</span></div>
    </section>
    <div class="paper spiral landing-card stack">
      <div class="panel-title" style="margin:0">Head into the swamp</div>
      ${accountPanelHtml()}
      <button id="create" class="btn primary" ${acct.me ? '' : 'disabled'}>Start a new table</button>
      <button id="tutorial" class="btn brass" ${acct.me ? '' : 'disabled'} title="A short guided game against two bots. Free, nothing at stake.">New here? Learn to play</button>
      <button id="quickjoin" class="btn" ${acct.me ? '' : 'disabled'} title="Join a public table that's waiting for players (or start one)">Join a random public table</button>
      <div class="divider">— or join friends —</div>
      <div class="row" style="flex-wrap:nowrap">
        <input id="code" class="field codefield" maxlength="4" placeholder="CODE" value="${esc(qRoom)}" style="width:170px" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button id="join" class="btn brass" style="flex:1" ${acct.me ? '' : 'disabled'}>Join table</button>
      </div>
      <div class="error">${esc(ui.err)}</div>
      <p class="hint" style="margin:0">Tables have an Eco-buck buy-in, or the host can make it a free table just for fun. Start a table and share its 4-letter code or link. Bots fill empty seats, so every game has at least 4 players.</p>
      <p class="legal-links"><a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> · <a href="refunds.html" target="_blank" rel="noopener">Refund Policy</a></p>
    </div>
    </div>
    ${acctModalHtml()}
  </div>`;
  mountGoogleButton();
  const go = async (op, body) => {
    try { const r = await acctApi(op, body); enterRoom(r); }
    catch (e) { ui.err = e.message; renderLanding(); }
  };
  document.getElementById('create').onclick = () => go('create', {});
  document.getElementById('tutorial').onclick = () => startTutorial();
  document.getElementById('quickjoin').onclick = async () => {
    try {
      const r = await acctApi('quickjoin', {}); enterRoom(r);
      setTimeout(() => showToast(r.created ? 'No public tables were open, so you started one. Anyone can join it now.' : 'You joined a public table!', false, 4200), 400);
    } catch (e) { ui.err = e.message; renderLanding(); }
  };
  const join = () => {
    const code = document.getElementById('code').value.trim().toUpperCase();
    if (!code) { ui.err = 'Type the 4-letter room code.'; return renderLanding(); }
    go('join', { room: code });
  };
  document.getElementById('join').onclick = join;
  document.getElementById('code').onkeydown = e => { if (e.key === 'Enter' && acct.me) join(); };
}
// Sign-in, or your banner and wallet once you're signed in
function accountPanelHtml() {
  if (acct.loading) return '<p class="hint" style="margin:0">Checking your account…</p>';
  const C = acct.config || {};
  if (!acct.me) return `<div class="signin stack" style="gap:8px">
      <span class="hint" style="margin:0">Sign in to keep your Eco-bucks, profile picture and unlocks.</span>
      ${C.googleClientId ? '<div id="gbtn" class="gbtn" data-keep></div>' : ''}
      ${C.guestsAllowed !== false ? `<button id="guest" class="btn">${C.googleClientId ? 'Play as a guest instead' : 'Play as guest'}</button>` : ''}
      ${C.guestsAllowed !== false && C.googleClientId && guestAtRisk() ? '<span class="hint" style="margin:0;font-size:15px">On iPhone, iPad and Safari, a guest account is erased if you don\'t play for 7 days. Sign in with Google to keep your Eco-bucks.</span>' : ''}
      ${!C.googleClientId ? '<span class="hint" style="margin:0;font-size:16px">(Google sign-in isn’t set up on this server yet. Guest accounts are saved in this browser.)</span>' : ''}
    </div>`;
  const me = acct.me;
  return `<div class="acctbox">
    ${bannerHtml(me, { extra: `<div class="pb-bal">${fmtEB(me.balance)}</div>` })}
    <div class="row" style="gap:6px"><button class="btn small" data-profile>Profile</button><button class="btn small brass" data-store>Store</button><button class="btn small" id="signout">Sign out</button>${mailButtonHtml(me)}</div>
    ${me.guest && C.googleClientId && guestAtRisk() ? '<span class="hint guestwarn">You\'re on a guest account. Safari erases guest accounts after 7 days without a visit, so sign out and sign in with Google to keep your progress safe.</span>' : ''}
  </div>`;
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
  view.html = `
  <div class="landing">
    ${musicBtnHtml()}
    <div class="paper spiral landing-card stack lobbycard" style="width:min(620px,100%)">
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
        <div><div class="panel-title" style="margin:0">Match modifiers</div>
          <span style="font-size:18px">Disruptions: <b>${S.disruptions ? 'On' : 'Off'}</b></span>
          <span class="hint">— each player drafts 2 Disruption cards and may play one face down after the biome is chosen</span></div>
        ${S.isHost ? `<div class="modepick"><button class="btn small ${S.disruptions ? 'brass' : ''}" data-dis="1">On</button><button class="btn small ${S.disruptions ? '' : 'brass'}" data-dis="0">Off</button></div>` : ''}
      </div>
      <div class="row" style="justify-content:space-between">
        <div><div class="panel-title" style="margin:0">Table</div>
          <span style="font-size:18px">${S.public ? 'Public' : 'Private'}</span> <span class="hint">${S.public ? '— anyone can join with “Join a random public table”' : '— only people with the code or link can join'}</span></div>
        ${S.isHost ? `<div class="modepick"><button class="btn small ${S.public ? '' : 'brass'}" data-public="0">Private</button><button class="btn small ${S.public ? 'brass' : ''}" data-public="1">Public</button></div>` : ''}
      </div>
      <div class="row" style="justify-content:space-between">
        <div><div class="panel-title" style="margin:0">Turn timer</div>
          <span style="font-size:18px">${S.turnTimer ? `${Math.round(S.turnLimitMs / 1000)} seconds` : 'Off'}</span> <span class="hint">${S.turnTimer ? `— run out of time and a bot plays that turn; ${S.maxStrikes} times and a bot takes your seat` : '— take as long as you like'}${S.public ? ' · always on at public tables' : ''}</span></div>
        ${S.isHost && !S.public ? `<div class="modepick"><button class="btn small ${S.turnTimer ? 'brass' : ''}" data-timer="1">On</button><button class="btn small ${S.turnTimer ? '' : 'brass'}" data-timer="0">Off</button></div>` : ''}
      </div>
      <div class="row" style="justify-content:space-between">
        <div><div class="panel-title" style="margin:0">Bot speed</div>
          <span style="font-size:18px">${SPEED_LABEL[S.speed] || 'Normal'}</span> <span class="hint">${({ slow: '— relaxed, plenty of time to read', normal: '— steady pace', fast: '— quick games' })[S.speed] || ''}</span></div>
        ${S.isHost ? `<div class="modepick">${SPEED_ORDER.map(sp =>
          `<button class="btn small ${S.speed === sp ? 'brass' : ''}" data-speed="${sp}">${SPEED_LABEL[sp]}</button>`).join('')}</div>` : ''}
      </div>
      <div class="buyin">
        <div class="row" style="justify-content:space-between">
          <div><div class="panel-title" style="margin:0">Buy-in</div>
            ${S.buyIn === 0 ? '<span style="font-size:18px"><b>Free table</b></span> <span class="hint">· just for fun: no risk, no reward</span>'
              : `<span style="font-size:18px">${fmtEB(S.buyIn)} per player</span> <span class="hint">· pot ${fmtEB(S.buyIn * tableSize)} with ${tableSize} seats</span>`}</div>
          ${S.isHost ? `<div class="modepick">${S.buyIns.map(b => `<button class="btn small ${S.buyIn === b ? 'brass' : ''}" data-buyin="${b}" ${b === 0 ? 'title="Play just for fun: no Eco-bucks are bet or won"' : ''}>${b === 0 ? 'Free' : b + ' EB'}</button>`).join('')}</div>` : ''}
        </div>
        ${S.buyIn === 0 ? '<p class="hint" style="margin:2px 0 0">Nobody pays in and nobody gets paid out. Your Eco-bucks stay exactly where they are.</p>' : `<p class="hint" style="margin:2px 0 0">${S.mode === 'coop'
          ? 'Co-op: beat the Anaconda and everyone gets double their bet back. Lose, and everyone loses it.'
          : `1st takes the rest of the pot · 2nd gets their bet back · 3rd gets half back · ${tableSize >= 5 ? 'everyone below loses' : '4th loses'} their bet. The house covers the bots.`}</p>`}
        ${S.myAccount ? `<p class="hint" style="margin:2px 0 0">Your balance: ${fmtEB(S.myAccount.balance)}${S.myAccount.balance < S.buyIn ? ' — <b style="color:var(--red)">not enough for this buy-in</b>' : ''}</p>` : ''}
        ${(() => { const mine = S.lobby.find(x => x.pid === S.yourPid); if (!mine || S.buyIn === 0) return '';
          return mine.confirmed
            ? `<div class="row bidrow"><span class="bidok">✓ You confirmed your ${S.buyIn} EB bid.</span><button class="btn small" data-confirm="0">Cancel</button></div>`
            : `<div class="row bidrow"><button class="btn primary" data-confirm="1" ${S.myAccount && S.myAccount.balance < S.buyIn ? 'disabled' : ''}>Confirm my ${S.buyIn} EB bid</button><span class="hint">Everyone confirms before the game can start. A new bid or game mode needs confirming again.</span></div>`; })()}
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
            <div style="flex:1;min-width:0">${bannerHtml(m.profile || { gamertag: m.name, avatarSrc: botAvatar(m.name) }, { you: m.pid === S.yourPid, size: 'small' })}</div>
            ${teamPicker(m)}
            ${!m.bot && !m.canAfford ? `<span class="tag" style="background:var(--red);color:#fff" title="Can't cover the ${S.buyIn} EB buy-in">SHORT</span>` : ''}
            ${m.bot ? '' : m.confirmed ? `<span class="tag confirmed" title="Confirmed the ${S.buyIn} EB bid">✓ BID</span>` : `<span class="tag unconfirmed" title="Hasn't confirmed the ${S.buyIn} EB bid yet">WAITING</span>`}
            ${m.host ? '<span class="tag host">HOST</span>' : ''}${m.bot ? '<span class="tag bot">BOT</span>' : ''}
            ${S.isHost && m.pid !== S.yourPid ? `<button class="btn small" data-remove="${m.pid}">✕</button>` : ''}
          </div>`).join('')}
      </div>
      ${S.isHost ? `
        <div class="row">
          <button id="addbot" class="btn small" ${S.lobby.length >= 6 ? 'disabled' : ''}>+ Add bot</button>
          <span class="hint">${bots ? `${bots} bot${bots > 1 ? 's' : ''} will join when you start, to make ${tableSize} players.` : 'Ready when you are.'}</span>
        </div>
        ${(() => { const waiting = S.lobby.filter(m => !m.bot && !m.confirmed);
          return waiting.length ? `<button id="start" class="btn primary" disabled>Waiting for ${waiting.length === 1 ? esc(waiting[0].name) : waiting.length + ' players'} to confirm the bid</button>`
            : `<button id="start" class="btn primary" ${S.lobby.some(m => !m.bot && !m.canAfford) ? 'disabled title="Everyone needs enough Eco-bucks for the buy-in"' : ''}>Start game · ${S.buyIn === 0 ? 'free table' : S.buyIn + ' EB buy-in'}</button>`; })()}`
      : `<p class="hint">Waiting for the host to start… ${humans} player${humans > 1 ? 's' : ''} here, ${S.lobby.filter(m => !m.bot && m.confirmed).length} confirmed.</p>`}
      <div class="row"><button id="leave" class="btn small">Leave table</button>${acct.me ? '<button class="btn small" data-profile>Profile</button><button class="btn small brass" data-store>Store</button>' : ''}</div>
    </div>
    ${acctModalHtml()}
  </div>`;
  document.getElementById('copy').onclick = () => { navigator.clipboard?.writeText(link); showToast('Link copied — send it to your friends!'); };
  document.getElementById('leave').onclick = async () => { await lobby('leave'); leave(); };
  $app.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => lobby('confirm', { on: b.dataset.confirm === '1' }));
  $app.querySelectorAll('[data-team]').forEach(b => b.onclick = () => {
    const m = S.lobby.find(x => x.pid === b.dataset.pid);
    const t = +b.dataset.team;
    lobby('team', { pid: b.dataset.pid, team: m && m.team === t ? null : t }); // click again to clear
  });
  if (S.isHost) {
    $app.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => lobby('mode', { mode: b.dataset.mode }));
    $app.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => lobby('speed', { speed: b.dataset.speed }));
    $app.querySelectorAll('[data-dis]').forEach(b => b.onclick = () => lobby('disruptions', { on: b.dataset.dis === '1' }));
    $app.querySelectorAll('[data-buyin]').forEach(b => b.onclick = () => lobby('buyin', { amount: +b.dataset.buyin }));
    $app.querySelectorAll('[data-public]').forEach(b => b.onclick = () => lobby('visibility', { public: b.dataset.public === '1' }));
    $app.querySelectorAll('[data-timer]').forEach(b => b.onclick = () => lobby('timer', { on: b.dataset.timer === '1' }));
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
// A Disruption card (portrait, like Ecology cards).
function disEl(id, cls = '', extra = '', who = '') {
  const d = DISRUPTIONS[id];
  return `<div class="card eco dis ${cls}" data-peek="${d.img}" ${extra}><img src="${d.img}" alt="${esc(d.name)}" loading="lazy">${who ? `<div class="who">${esc(who)}</div>` : ''}</div>`;
}
// Card backs (drawn by tools/make_card_backs.js): change BACK_V whenever they are redrawn, so browsers fetch the new ones.
const BACK_V = '20261115';
const disBack = (who = '') => `<div class="card eco dis facedown"><img src="assets/cards/disruption/back.png?v=${BACK_V}" alt="Face-down Disruption">${who ? `<div class="who">${esc(who)}</div>` : ''}</div>`;
// Card treatments (foil, …): shown only to the player who owns them, for cards dealt to them. Which treatment a
// card shows is set per character in its character profile; before a role is chosen, every owned one shows.
function myLoadout(role) {
  const me = (S && S.myAccount) || acct.me;
  return (me && me.chars && role && me.chars[role]) || null;
}
function treatmentCls(id, role = S && S.role) {
  const L = myLoadout(role);
  let t = L ? L.finish[id] : null;
  if (!L) {
    const owned = ((S && S.myAccount) || acct.me || {}).owned || [];
    t = (TREATMENTS.find(x => owned.includes(x.id + ':' + id)) || {}).id;
  }
  const T = TREATMENTS.find(x => x.id === t);
  return T ? T.cls : '';
}
const foil = id => treatmentCls(id);
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
  const disSt = myTurn && step && step.type === 'dis' ? step : null; // a Disruption asking its owner for choices
  for (const [id, g] of Object.entries(GEO)) {
    const t = S.board[id];
    const placeOk = !(S.trick && S.trick.blocked && id === curRegion); // Land Development
    const target = myTurn && step && step.type === 'place' && S.placeTargets.includes(id);
    const dDest = disSt && disSt.mode === 'dest' && id !== disSt.from && placeOk;
    const dScatter = disSt && disSt.mode === 'scatter' && id !== disSt.from && placeOk;
    const attr = target ? `data-place="${id}"` : dDest ? `data-ddest="${id}"` : dScatter ? `data-dscatter="${id}"` : '';
    polys += `<polygon class="rg ${id === curRegion ? 'current' : ''} ${target || dDest || dScatter ? 'target' : ''}" points="${g.poly.map(p => p.join(',')).join(' ')}" ${attr}><title>${esc(REGIONS[id].name)}</title></polygon>`;
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
    const disHere = disSt && disSt.mode === 'remove' && (disSt.quota ? disSt.quota[id] > 0 : disSt.regions.includes(id));
    const pickN = ((preyHere || ui.mode === 'landdev' || (disHere && disSt.kinds.includes('n'))) && t.n > 0);
    const pickI = ((preyHere || ui.mode === 'landdev' || (disHere && disSt.kinds.includes('i'))) && t.i > 0);
    const pickAttr = k => disHere ? `data-dpick="${id}:${k}"` : `data-pick="${id}:${k}"`;
    sums += `<div class="sum" style="left:${(g.sum[0] / BW * 100).toFixed(2)}%;top:${(g.sum[1] / BH * 100).toFixed(2)}%">
      <span class="tok n ${t.n ? '' : 'zero'} ${pickN ? 'pick' : ''}" ${pickN ? pickAttr('n') : ''} title="Native">${t.n}</span>
      <span class="tok i ${t.i ? '' : 'zero'} ${pickI ? 'pick' : ''}" ${pickI ? pickAttr('i') : ''} title="Invasive">${t.i}</span></div>`;
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
    if (p.boss) return `<div class="pl boss ${S.waiting === i ? 'turn' : ''}" data-seat="${i}" data-peek="${BOSS.img}" data-peekrole="Anaconda">${portraitHtml(i, p)}
      <div class="info">
        <div class="nm">${arrow}<span class="name">${esc(p.name)}</span><span class="tag bosstag">BOSS</span></div>
        ${mini ? `<div class="mini-meta">Deck ${p.handCount}</div>` : `<div class="meta"><span>Invasive deck ${p.handCount}</span></div><div class="meta"><span>Tricks ${p.tricks}</span></div>`}
      </div>${mini ? trickBadge(p) : ''}</div>`;
    return `<div class="pl ${S.waiting === i ? 'turn' : ''}" data-seat="${i}" ${role ? peekAttrs(p.role, p.skin) : ''}>${portraitHtml(i, p)}
      <div class="info">
        <div class="nm">${arrow}<span class="name">${esc(p.name)}</span>${i === S.you ? '<span class="you">(you)</span>' : ''}${p.online ? '' : '<span class="dot off" title="offline"></span>'}${mini ? clockFor(i) : ''}${p.strikes ? `<span class="idletag" title="Ran out of time ${p.strikes} of ${S.maxStrikes} times">idle ${p.strikes}/${S.maxStrikes}</span>` : ''}</div>
        ${mini ? `<div class="mini-meta">${role ? esc(role.name) : 'choosing…'}</div>` : `<div class="meta">${role ? `<span class="rolename">${esc(role.name)}</span>` : '<span>choosing role…</span>'}${teamTag(p.team)}</div>
        <div class="meta"><span>Hand ${p.handCount}</span><span>Tricks ${p.tricks}</span>${clockFor(i)}</div>`}
        ${!mini && S.isHost && !p.online && !p.bot && S.phase !== 'ended' ? `<button class="btn small" data-botify="${S.lobby.find(m => m.name === p.name)?.pid || ''}">Give seat to a bot</button>` : ''}
      </div>${mini ? trickBadge(p) : ''}</div>`;
  }).join('');
}
// the compact player tiles (phones, narrow windows): tricks won as a badge on the portrait's corner
const trickBadge = p => `<span class="tkbadge ${p.tricks ? '' : 'zero'}" title="Tricks won: ${p.tricks}">★${p.tricks}</span>`;
// one line about a player, shown above their role card when you tap them (phones)
function seatInfoHtml(i) {
  const p = S && S.players && S.players[i]; if (!p) return '';
  const role = roleInfo(p.role);
  const bits = [`★ ${p.tricks} trick${p.tricks === 1 ? '' : 's'} won`, p.boss ? `${p.handCount} in its deck` : `${p.handCount} card${p.handCount === 1 ? '' : 's'} in hand`];
  if (p.team !== null && p.team !== undefined && TEAMS[p.team]) bits.push(`Team ${TEAMS[p.team].name}`);
  return `<div class="peekinfo"><b>${esc(p.name)}${i === S.you ? ' (you)' : ''}</b>${role ? ` · the ${esc(role.name)}` : ''}<span>${bits.join(' · ')}</span></div>`;
}

function draftHtml() {
  const myTurn = isMine();
  const owner = {};
  S.players.forEach(p => { if (p.role) owner[p.role] = p.name; });
  const cards = Object.keys(ROLES).filter(r => owner[r] || S.availableRoles.includes(r)).map(r => {
    const R = ROLES[r];
    const free = !owner[r];
    const pick = myTurn && free;
    const skin = tableSkin(r); // taken: the holder's skin; still free: yours
    return `<div class="rolepick ${pick ? 'choosable' : ''} ${free ? '' : 'taken'}" ${peekAttrs(r, skin)} ${pick ? `data-role="${r}"` : ''}>
      ${roleCardHtml(r, skin)}
      ${free ? '' : `<div class="takenby">${esc(owner[r])}</div>`}
    </div>`;
  }).join('');
  return `<div class="tabletop draft">${terrainHtml(null)}<div class="players-mini">${playersHtml(true)}</div>
    <h3>${myTurn ? '▶ Choose your role' : `${esc(S.players[S.waiting].name)} is choosing a role…`} <span style="color:var(--blush)">(picking in turn order)</span></h3>
    <div class="rolegrid ${myTurn ? 'choosing' : ''}">${cards}</div>
  </div>`;
}

// The trick that just finished, with the winning card raised and highlighted, shown for a moment.
function trickDoneHtml() {
  const lt = S.lastTrick, b = BIOMES[lt.biome], w = S.players[lt.winner];
  const elapsed = Date.now() - ui.trickHold.start;
  const who = p => S.players[p].boss ? 'Anaconda' : S.players[p].name;
  return `<div class="tabletop play trickdone ${lt.crisis ? 'crisis' : ''}">${terrainHtml(lt.suit || b.suit, lt.biome)}<div class="players-mini">${playersHtml(true)}</div>
    <h3>Round ${lt.round} — trick complete</h3>
    <div class="cur-row">
      ${biomeEl(lt.biome)}
      <div class="tt-info">
        <div class="place">${esc(b.name)}<br><span style="color:var(--blush)">${esc(REGIONS[b.region].name)}</span></div>
        <div class="winline">★ ${esc(w.name)} wins with ${esc(CARDS[lt.card].name)}!</div>
        ${lt.crisis ? '<div class="crisisline">INVASIVE CRISIS!</div>' : ''}
        ${lt.matched === false ? '<span class="lastline" style="color:var(--blush)">No card matched, so the highest off-suit Impact won.</span>' : ''}
        ${(lt.dis || []).length ? `<span class="lastline" style="color:var(--blush)">Disruptions: ${lt.dis.map(d => `${esc(DISRUPTIONS[d.card].name)} (${esc(S.players[d.p].name)})`).join(', ')}</span>` : ''}
      </div>
    </div>
    <div class="played" style="--n:${lt.plays.length};--n2:${Math.ceil(lt.plays.length / 2)}">${lt.plays.map(pl => pl.card === lt.card
      ? captioned(cardEl(pl.card, `winner ${pl.p === S.you ? foil(pl.card) : ''}`, `data-played="${pl.card}"`, '', `<div class="winribbon">${lt.crisis ? 'CRISIS!' : 'WINNER'}</div>`), who(pl.p), 'win')
      : captioned(cardEl(pl.card, `loser ${pl.p === S.you ? foil(pl.card) : ''}`, `data-played="${pl.card}"`), who(pl.p), 'lose')).join('')}</div>
    <div class="holdbar"><span style="animation-duration:${ui.trickHold.ms}ms;animation-delay:-${elapsed}ms"></span></div>
  </div>`;
}

// Disruption draft: pick 1 card from your pack; the rest pass clockwise.
function ddraftHtml() {
  const D = S.ddraft;
  const waitingNames = D.waiting.map(p => S.players[p].name);
  const canPick = S.you >= 0 && !D.picked && D.pack.length;
  return `<div class="tabletop draft">${terrainHtml(null)}<div class="players-mini">${playersHtml(true)}</div>
    <h3>${canPick ? `▶ Disruption draft — pick ${D.round === 0 ? 'your first' : 'your second'} card` : `Waiting for ${esc(waitingNames.join(', ') || '…')}…`}
      <span style="color:var(--blush)">(the rest pass clockwise)</span></h3>
    <div class="rolegrid ${canPick ? 'choosing' : ''}">${D.pack.map(id => disEl(id, `${canPick ? 'choosable' : ''} ${D.picked === id ? 'sel' : ''} ${foil(id)}`, canPick ? `data-ddraft="${id}"` : '')).join('')}</div>
    ${S.dis.length ? `<div class="strip"><h3>Your Disruptions</h3><div class="strip-cards">${S.dis.map(id => disEl(id, foil(id))).join('')}</div></div>` : ''}
  </div>`;
}
// The play area's ground shows the round's suit: dry earth (Land), pools and mud (Wetland) or open sea (Water), all
// one terrain under a rising and falling water level (terrain.js draws it; renderGame hands it the suit). The canvas
// stays put across renders (it is always the board's first child), so the animation carries on between them.
// Between rounds (choosing the next biome) the last suit stays down; before the first (role draft) the ground is dry.
// The suit is the round's own (S.trick.suit), so a Flood or Drought that changes it moves the water too.
// In the open-ocean regions the sea's ripples carry sea foam; inland (Lake Okeechobee, flooded land) they don't.
const MARINE = new Set(['NG', 'SG', 'KW', 'FK', 'KL']);
function terrainHtml(suit, biome) {
  if (suit) ui.lastSuit = suit;
  if (suit && biome) ui.lastMarine = MARINE.has(BIOMES[biome].region); // (between rounds: keeps the last round's)
  ui.terrainSuit = suit || null;
  ui.terrainMarine = suit ? ui.lastMarine : false;
  return `<div class="terrain" data-suit="${suit || ''}" aria-hidden="true"><canvas></canvas></div>`;
}
// A card with its owner's name as a caption underneath (never drawn over the card).
const captioned = (cardHtml, name, cls = '') => `<div class="pcard ${cls}">${cardHtml}<div class="pname">${esc(name)}</div></div>`;
const seatName = p => S.players[p].boss ? 'Anaconda' : S.players[p].name;
// The Disruption panel beside the biome: face-down cards while players decide, then the revealed cards and
// a short list of what they change this round.
function disPanelHtml() {
  const T = S.trick; if (!T || !S.disruptions) return '';
  let cards = '', title = 'Disruptions';
  if (S.phase === 'disrupt' && S.dcommit) {
    title = `Disruptions — ${S.dcommit.waiting.length ? `${S.dcommit.waiting.length} still deciding` : 'revealing'}`;
    cards = S.dcommit.committed.map(i => i === S.you
      ? captioned(disEl(S.dcommit.mine, foil(S.dcommit.mine)), 'You (face down)')
      : captioned(disBack(), S.players[i].name)).join('');
    if (!cards) cards = '<span class="dis-empty">Nothing committed yet.</span>';
  } else if (T.dis.length) {
    cards = T.dis.map(d => captioned(disEl(d.card, d.p === S.you ? foil(d.card) : ''), S.players[d.p].name)).join('');
  } else cards = '<span class="dis-empty">No Disruptions this round.</span>';
  const fx = [];
  if (T.protest) fx.push('Risk is 0');
  if (T.blocked) fx.push('No tokens can be placed here');
  if (T.doubleNative) fx.push('Natives played here are doubled');
  for (const p of T.bribes || []) fx.push(`${esc(S.players[p].name)}: Risk +5`);
  for (const p of T.docu || []) fx.push(`${esc(S.players[p].name)}: Natives +5 Impact`);
  if ((T.dis || []).some(d => d.card === 'ChangingSeasons')) for (const d of T.dis.filter(x => x.card === 'ChangingSeasons')) fx.push(`${esc(S.players[d.p].name)} plays last`);
  if ((T.dis || []).some(d => d.card === 'TravelersGuidebook')) for (const d of T.dis.filter(x => x.card === 'TravelersGuidebook')) fx.push(`${esc(S.players[d.p].name)} leads next round`);
  return `<div class="dispanel"><div class="dis-title">${title}</div><div class="dis-cards">${cards}</div>
    ${fx.length ? `<div class="disfx">${fx.map(f => `<span>${f}</span>`).join('')}</div>` : ''}</div>`;
}

function tableHtml() {
  if (S.phase === 'draft') return draftHtml();
  if (S.phase === 'ddraft' && S.ddraft) return ddraftHtml();
  if (holding()) return trickDoneHtml();
  const myTurn = isMine();
  const choosing = S.phase === 'choose' || !S.trick;
  const pickNow = S.phase === 'choose' && myTurn && !(S.players[S.you] && S.players[S.you].bot); // (a seat a bot took over: the bot picks)
  const n = S.players.length;
  const deck = `<div class="deckpile"><img src="assets/biome-back.png?v=${BACK_V}" alt="">${S.deckCount} left</div>`;
  // a bot's pick lights up for a moment before it travels there (S.botPick, from the server)
  const botPick = !pickNow && S.botPick && S.botPick.seat === S.leader ? S.botPick.biome : null;
  const travelCards = cls => S.travel.map(id => biomeEl(id, `${cls} ${id === botPick ? 'botpick' : ''}`, pickNow ? `data-choose="${id}"` : '')).join('');

  if (choosing) {
    // Picking the next biome: the travel row is the star.
    const lt = S.lastTrick;
    const guide = pickNow && S.guide && S.guide.p === S.you && S.guide.options.length ? S.guide.options : null; // Traveler's Guidebook
    return `<div class="tabletop choose">${terrainHtml(ui.lastSuit)}<div class="players-mini">${playersHtml(true)}</div>
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
        <h3>${pickNow ? '▶ Choose where to travel' : botPick ? `${esc(S.players[S.leader].name)} travels to ${esc(BIOMES[botPick].name)}…` : `${esc(S.players[S.leader].name)} is choosing where to travel…`}</h3>${deck}
      </div>
      <div class="travel ${pickNow ? 'choosing' : ''}">${travelCards(pickNow ? 'choosable' : '')}</div>
      ${guide ? `<div class="strip"><h3>Traveler's Guidebook — or travel to one of the top 5 biome cards</h3>
        <div class="strip-cards guide">${guide.map(id => biomeEl(id, 'choosable', `data-choose="${id}"`)).join('')}</div></div>` : ''}
      ${lt ? `<div class="strip">
        <h3>Last trick — ${esc(S.players[lt.winner].name)} won${lt.crisis ? ' · <span style="color:#ffb3b3">Crisis!</span>' : ''}</h3>
        <div class="strip-cards">${biomeEl(lt.biome)}${lt.plays.map(pl => cardEl(pl.card, pl.card === lt.card ? 'win' : '')).join('')}</div>
      </div>` : ''}
    </div>`;
  }
  // A biome has been chosen: the current biome and the played cards take over.
  const b = BIOMES[S.trick.biome];
  const changed = S.trick.risk !== b.risk;
  const suit = S.trick.suit || b.suit, suitChanged = suit !== b.suit;
  const myRisk = S.myRisk !== null && S.myRisk !== undefined && S.myRisk !== S.trick.risk ? S.myRisk : null;
  const slots = S.trick.seq ? S.trick.seq.length : n;
  return `<div class="tabletop play ${S.disruptions ? 'with-dis' : ''}">${terrainHtml(suit, S.trick.biome)}<div class="players-mini">${playersHtml(true)}</div>
    <h3>Round ${S.round} — ${S.phase === 'disrupt' ? 'Disruption phase' : 'exploring'}</h3>
    <div class="cur-row">
      ${biomeEl(S.trick.biome)}
      <div class="tt-info">
        <div class="place">${esc(b.name)}<br><span style="color:var(--blush)">${esc(REGIONS[b.region].name)}</span></div>
        <div class="tt-badges"><span class="suitbadge suit-${suit}">${suit}</span>${suitChanged ? `<span class="was">was ${b.suit}</span>` : ''}</div>
        <span class="risk">Risk <b>${S.trick.risk}</b>${changed ? `<span class="was">(was ${b.risk})</span>` : ''}</span>
        ${myRisk !== null ? `<span class="was">${myRisk} for your cards</span>` : ''}
        ${S.trick.keystones ? `<span class="keynote">Keystone: each Native here lowers the Risk${S.trick.keystones > 1 ? ` ×${S.trick.keystones}` : ''}</span>` : ''}
      </div>
      ${disPanelHtml()}
    </div>
    <div class="played" style="--n:${slots};--n2:${Math.ceil(slots / 2)}">${S.trick.plays.map(pl => captioned(cardEl(pl.card, pl.p === S.you ? foil(pl.card) : '', `data-played="${pl.card}"`), seatName(pl.p) + (S.trick.shield && S.trick.shield.card === pl.card ? ' · stopped' : ''), S.trick.shield && S.trick.shield.card === pl.card ? 'stopped' : '')).join('')}${
      // an empty slot for each card still to come, labelled with who plays it (the next one is marked)
      (S.trick.seq || S.players.map((_, k) => (S.leader + k) % n)).slice(S.trick.plays.length, slots).map((p, k) =>
        `<div class="pcard slot ${k === 0 && S.phase === 'play' ? 'next' : ''}"><div class="cardslot"></div><div class="pname">${k === 0 && S.phase === 'play' ? '▶ ' : ''}${esc(seatName(p))}</div></div>`).join('')}</div>
    ${S.phase === 'disrupt' ? '<span class="lastline dishint">Cards are played once the Disruptions are resolved.</span>' : ''}
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
    const risk = S.trick ? (S.myRisk ?? S.trick.risk) : 0; // Take Bribes: your own Risk may be higher
    const over = S.trick && c.kind === 'Invasive' && c.impact > risk;
    const badge = over ? `<div class="overrisk" title="Impact ${c.impact} is above the Invasive Risk (${risk}): this card can't win the trick, but it still populates."><span>!</span></div>` : '';
    return `<div class="slot" data-key="slot-${id}" style="--i:${hand.indexOf(id)}">${cardEl(id, `${cls} ${ui.sel === id ? 'sel' : ''} ${foil(id)}`, `data-hand="${id}"`, '', badge)}</div>`;
  }).join('') || '<span class="hint" style="color:var(--blush)">No cards in hand.</span>';
  const role = S.role ? ROLES[S.role] : null;
  // keep sideways scroll positions (hand, players strip) across re-renders
  const keepScroll = {};
  const tip = coachTip();
  for (const sel of ['.hand', '.players-mini']) { const el = [...$app.querySelectorAll(sel)].find(e => e.offsetParent); if (el) keepScroll[sel] = el.scrollLeft; }
  // phones show the play area or the map, one at a time (the Table / Map switch in the top bar); the game flips to
  // the map by itself when you have to click it, and back afterwards (onUpdate sets ui.scrollTo)
  if (ui.scrollTo) ui.stage = ui.scrollTo === 'board' ? 'map' : 'table';
  if (isPhone() && tip && tip.focus === '.boardwrap') ui.stage = 'map';
  if (isPhone() && tip && tip.focus === '.tablecol') ui.stage = 'table';
  const stage = ui.stage === 'map' ? 'map' : 'table';
  if (stage === 'map') ui.mapNew = false;
  const mapTurn = isMine() && ((S.step && ['place', 'predate'].includes(S.step.type)) || (S.step && S.step.type === 'dis' && ['remove', 'dest', 'scatter'].includes(S.step.mode)) || ui.mode === 'landdev');

  view.html = `
  <div class="topbar">
    <span class="logo-sm">EVERGLADES</span>
    <span class="chip dk">${S.tutorial ? 'Tutorial' : 'Room <span class="code">' + S.room + '</span>'}</span>
    ${S.phase === 'draft' ? '<span class="chip">Role draft</span>' : S.phase !== 'ended' ? `<span class="chip">Round ${S.round}</span>` : ''}
    ${S.partners ? '<span class="chip dk">Partners</span>' : ''}${S.coop ? '<span class="chip dk" style="background:#f2d7c9">Co-op vs The Anaconda</span>' : ''}
    <span class="spacer"></span>
    <div class="stageswitch" role="tablist" aria-label="Show">
      <button class="${stage === 'table' ? 'on' : ''}" data-stage="table" role="tab" aria-selected="${stage === 'table'}">Table</button>
      <button class="${stage === 'map' ? 'on' : ''} ${mapTurn && stage !== 'map' ? 'call' : ''}" data-stage="map" role="tab" aria-selected="${stage === 'map'}">Map${ui.mapNew && stage !== 'map' ? '<i class="newdot"></i>' : ''}</button>
    </div>
    ${S.you >= 0 ? `<div class="chat-wrap">
      <button class="btn small dk ${ui.showChat ? 'brass' : ''}" id="chatBtn" title="Send a chat line to the table">💬 Chat ▾</button>
      ${ui.showChat ? chatDropHtml() : ''}
    </div>` : ''}
    ${S.you >= 0 ? `<button class="btn small dk ${ui.showPile ? 'brass' : ''}" data-g="pile" title="The cards you have won in tricks">Scoring pile (${(S.pile || []).length})</button>` : ''}
    <div class="notes-wrap">
      <button class="btn small dk ${ui.showLog ? 'brass' : ''}" id="notesBtn">Field notes ${ui.unread && !ui.showLog ? `<span class="badge">${ui.unread > 9 ? '9+' : ui.unread}</span>` : ''}▾</button>
      ${ui.showLog ? `<div class="paper spiral notes-drop" id="log"><div class="panel-title">Field notes</div>${S.log.map(l => `<p class="${l.startsWith('INVASIVE') ? 'crisis' : ''}">${esc(l)}</p>`).join('')}</div>` : ''}
    </div>
    <span class="dk dkrow">
    <button class="btn small" id="speed" ${S.isHost ? '' : 'disabled'} title="${S.isHost ? 'How fast the bots play. Click to change.' : 'Bot speed (the host can change it)'}">Speed: ${SPEED_LABEL[S.speed] || 'Normal'}</button>
    ${musicBtnHtml('')}
    <button class="btn small" id="mute" title="Sound effects on/off">${muted ? 'Sound: Off' : 'Sound: On'}</button>
    <button class="btn small" id="rules">Rules</button>
    <button class="btn small" id="quit">Leave</button>
    </span>
    ${menuHtml(true)}
  </div>
  <div class="game" data-view="${stage}" data-slide="${ui.slide || ''}">
    <div class="pstrip players-mini" style="--n:${S.players.length}">${playersHtml(true)}</div>
    <aside class="side">
      <div class="paper spiral players" style="--rows:${S.players.length}"><div class="panel-title" title="Hover a player to read their role card">Players <span class="hint">· hover to read roles</span></div>${playersHtml(false)}</div>
    </aside>
    <section class="boardwrap">${boardHtml()}</section>
    <section class="tablecol">${tableHtml()}</section>
    <section class="handarea">
      ${promptHtml()}
      <div class="hand-cap">${role ? `<span class="myrole" ${peekAttrs(S.role, tableSkin(S.role))}>You are the <b>${esc(role.name)}</b> <small>▸</small></span>` : ''}${S.you >= 0 ? `<button class="pilebtn" data-g="pile" title="The cards you have won in tricks">Scoring pile <b>${(S.pile || []).length}</b> ▸</button>` : ''}</div>
      <div class="handrow">
        <div class="hand ${ui.dealing ? 'dealing' : ''} ${Date.now() - (ui.handIntro || 0) < 1400 ? 'intro' : ''}">${handHtml}</div>
        ${S.disruptions && (S.dis || []).length ? `<div class="dishand"><div class="cap">Disruptions</div><div class="dishand-cards">${S.dis.map(id => {
          const canCommit = S.phase === 'disrupt' && S.dcommit && S.dcommit.waiting.includes(S.you);
          return disEl(id, `${canCommit ? 'choosable' : ''} ${foil(id)}`, canCommit ? `data-commit="${id}"` : '');
        }).join('')}</div></div>` : ''}
        ${role ? `<div class="rolebox"><div class="cap">You are the <b>${esc(role.name)}</b></div><div class="card" ${peekAttrs(S.role, tableSkin(S.role))}>${roleCardHtml(S.role, tableSkin(S.role))}</div></div>` : ''}
      </div>
    </section>
  </div>
  ${ui.confirm ? confirmModal() : ''}
  ${ui.mode === 'swap' ? swapModal() : ''}
  ${ui.stealFrom !== null && ui.stealFrom !== undefined && S.stealPiles ? stealModal() : ''}
  ${ui.showRules ? rulesModal() : ''}
  ${ui.showPlayers ? playersModal() : ''}
  ${ui.showPile ? pileModal() : ''}
  ${S.phase === 'ended' && !holding() ? endModal() : ''}
  ${coachHtml(tip)}`;

  if (tip && tip.focus) { const f = [...$app.querySelectorAll(tip.focus)].find(e => e.offsetParent); if (f) f.classList.add('coach-focus'); }
  coachSync();
  if (peekSrc && !document.querySelector(`[data-peek="${CSS.escape(peekSrc)}"]`)) hidePeek();
  const logEl = document.getElementById('log'); if (logEl) logEl.scrollTop = logEl.scrollHeight;
  wire();
  if (window.EG_TERRAIN) EG_TERRAIN.sync($app.querySelector('.tabletop > .terrain > canvas'), ui.terrainSuit, ui.terrainMarine);
  drawPortraits(true); drawArtboxes(); // new canvases get their picture before the page is shown, never a blank frame
  for (const [sel, x] of Object.entries(keepScroll)) { const el = [...$app.querySelectorAll(sel)].find(e => e.offsetParent); if (el) el.scrollLeft = x; }
  if (isPhone()) {
    // the hand bar is pinned to the bottom of the screen: leave room for it under the page
    const ha = $app.querySelector('.handarea');
    if (ha) document.documentElement.style.setProperty('--handH', ha.offsetHeight + 'px');
  }
  ui.scrollTo = null;
  placeBubbles();
  if (ui.fxQueue && ui.fxQueue.length) {
    const q = ui.fxQueue; ui.fxQueue = [];
    requestAnimationFrame(() => { for (const f of q) playSplash(f.type, [...document.querySelectorAll(`[data-played="${f.card}"]`)].find(e => e.offsetParent)); });
  }
}
// phone layout (matches the phone media query in style.css)
const phoneMQ = matchMedia('(max-width: 760px), (max-height: 520px) and (max-width: 1000px)');
const isPhone = () => phoneMQ.matches;
phoneMQ.addEventListener?.('change', () => { if (S && S.phase !== 'lobby') render(); });

// Phones: the middle of the screen shows the table or the map. Besides the Table / Map buttons, a quick sideways
// swipe on that area flips between them (left to the map, right back to the table). It's a flick, not a drag: the
// screen never follows the finger, and the top bar and hand never move.
let swipeAt = null, swipeEnded = 0;
function switchStage(to, dir) {
  if (to === (ui.stage === 'map' ? 'map' : 'table')) return;
  ui.stage = to; ui.slide = dir || (to === 'map' ? 'left' : 'right');
  clearTimeout(switchStage.t); switchStage.t = setTimeout(() => { ui.slide = null; }, 400);
  hidePeek(); render();
}
document.addEventListener('touchstart', e => {
  swipeAt = null;
  if (!isPhone() || !S || e.touches.length !== 1 || !e.target.closest('.game > .tablecol, .game > .boardwrap')) return;
  const t = e.touches[0]; swipeAt = { x: t.clientX, y: t.clientY, at: Date.now() };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!swipeAt) return;
  const t = e.changedTouches[0], dx = t.clientX - swipeAt.x, dy = t.clientY - swipeAt.y, quick = Date.now() - swipeAt.at < 600;
  swipeAt = null;
  if (!quick || Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  swipeEnded = Date.now();
  switchStage(dx < 0 ? 'map' : 'table', dx < 0 ? 'left' : 'right');
}, { passive: true });
document.addEventListener('touchcancel', () => { swipeAt = null; });
// a swipe that ends on a card or region must not also count as a tap on it
addEventListener('click', e => { if (Date.now() - swipeEnded < 400) { e.stopPropagation(); e.preventDefault(); } }, true); // (window: before the page's own handlers)
addEventListener('scroll', () => { if (Object.keys(ui.bubbles).length) placeBubbles(); }, { passive: true });

// ---------- turn timer display ----------
// A countdown for seat i if the server's turn clock is running for it (see TURN_MS in server.js). The numbers are
// updated every second by tickClocks() without redrawing the page.
function clockFor(i, big = false) {
  const d = S && S.deadline;
  if (!d || i < 0 || !d.seats.includes(i) || S.phase === 'ended' || holding()) return '';
  return `<span class="turnclock ${big ? 'big' : ''}" data-at="${d.at}" title="Time left for this turn">${clockText(d.at)}</span>`;
}
function clockText(at) {
  const left = Math.max(0, Math.ceil((at - (Date.now() + (ui.clockSkew || 0))) / 1000));
  return `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}
function tickClocks() {
  for (const el of document.querySelectorAll('.turnclock')) {
    const at = +el.dataset.at, left = (at - (Date.now() + (ui.clockSkew || 0))) / 1000;
    el.textContent = clockText(at);
    el.classList.toggle('low', left <= 10);
  }
}
setInterval(tickClocks, 500);

function promptHtml() {
  const myTurn = isMine();
  const w = S.waiting >= 0 ? S.players[S.waiting] : null;
  if (holding()) {
    const lt = S.lastTrick;
    return `<div class="paper spiral prompt"><div class="msg">${esc(S.players[lt.winner].name)} wins the trick!<small>${S.phase === 'ended' ? 'Final scores coming up…' : 'Next round in a moment…'}</small></div></div>`;
  }
  if (S.phase === 'ended') return `<div class="paper spiral prompt"><div class="msg">Game over!</div></div>`;
  const yours = (msg, buttons = '') => `<div class="paper spiral prompt yours">${clockFor(S.you, true)}<div class="msg">${msg}</div>${buttons}</div>`;
  const names = list => esc(list.map(p => S.players[p].name).join(', '));
  // Disruptions: the simultaneous parts (everyone decides at once)
  if (S.phase === 'ddraft' && S.ddraft) {
    if (S.you >= 0 && !S.ddraft.picked) return yours(`Disruption draft: pick 1 card from your pack.<small>${isPhone() ? 'Tap' : 'Click'} a card in the play area. The rest pass clockwise; you'll keep 2.</small>`);
    return `<div class="paper spiral prompt"><div class="msg">Waiting for ${names(S.ddraft.waiting)} to pick…</div></div>`;
  }
  if (S.phase === 'disrupt' && S.dcommit) {
    if (S.you >= 0 && S.dcommit.waiting.includes(S.you)) return yours('Disruption phase: commit 1 Disruption card face down, or pass.<small>All committed cards are revealed together, then activated in turn order. Hover a card to read it.</small>',
      S.dis.map(id => `<button class="btn brass" data-commit="${id}">${esc(DISRUPTIONS[id].name)}</button>`).join('') + '<button class="btn" data-commit="">Pass</button>');
    return `<div class="paper spiral prompt"><div class="msg">Waiting for ${names(S.dcommit.waiting)} to decide on a Disruption…<small>${S.dcommit.mine && S.dcommit.mine !== 'pass' ? `You committed ${esc(DISRUPTIONS[S.dcommit.mine].name)} face down.` : 'You passed.'}</small></div></div>`;
  }
  if (!myTurn) {
    let what = S.phase === 'draft' ? 'to choose a role' : S.phase === 'choose' ? 'to choose where to travel' : 'to play';
    if (S.step?.type === 'place') what = `to spread ${CARDS[S.step.card].name}`;
    if (S.step?.type === 'predate') what = `to hunt with ${CARDS[S.step.card].name}`;
    if (S.step?.type === 'dis') what = `to resolve ${DISRUPTIONS[S.step.card].name}`;
    if (S.step?.type === 'protect') what = `(Conservationist) to decide whether to stop ${S.players[S.step.by].name}'s ${CARDS[S.step.card].name} from populating`;
    return `<div class="paper spiral prompt"><div class="msg">Waiting for ${esc(w ? w.name : '…')} ${what}…<small>${isPhone() ? 'Tap a player to read their role, or press and hold any card' : 'Hover any card'} for a second to read it.</small></div></div>`;
  }
  const box = (msg, buttons = '') => `<div class="paper spiral prompt yours">${clockFor(S.you, true)}<div class="msg">${msg}</div>${buttons}</div>`;
  if (S.phase === 'draft') return box(`Choose your role! ${isPhone() ? 'Tap' : 'Click'} a role card in the play area.<small>${isPhone() ? 'Press and hold' : 'Hover over'} a card to read its objectives. Your hand is already dealt, so plan around it.</small>`);
  if (S.phase === 'choose') return box('You lead! Pick a biome in the glowing travel row.<small>Its type sets the lead suit, and its region is where everyone populates.</small>');
  const st = S.step;
  if (st?.type === 'dis') {
    const D = esc(DISRUPTIONS[st.card].name);
    const done = st.must ? '' : `<button class="btn" id="dDone">${st.mode === 'remove' ? 'Done' : 'Skip'}</button>`;
    if (st.mode === 'remove') {
      const left = st.quota ? Object.values(st.quota).reduce((a, b) => a + b, 0) : st.left;
      const where = st.quota ? (Object.keys(st.quota).length > 1 ? 'the current region and each neighbour' : 'the current region') : st.regions.length > 1 ? 'any region' : 'the current region';
      const kinds = st.kinds.length > 1 ? 'Native or Invasive' : 'Invasive';
      return box(`${D}: ${st.must ? 'remove' : st.collect ? 'pick up' : 'you may remove'} ${st.quota || left < 100 ? `${left} more` : 'any number of'} ${kinds} token${left === 1 ? '' : 's'} from ${where}.<small>Click a blinking counter on the map.${st.collect ? ' Then you choose one region to move them to.' : ''}</small>`, done);
    }
    if (st.mode === 'dest') return box(`${D}: choose where the ${st.pool.n + st.pool.i} token${st.pool.n + st.pool.i === 1 ? '' : 's'} (${st.pool.n} Native, ${st.pool.i} Invasive) go.<small>Click a glowing region on the map.</small>`, done);
    if (st.mode === 'scatter') {
      const kind = ui.scatterKind === 'i' && st.pool.i ? 'i' : st.pool.n ? 'n' : 'i';
      ui.scatterKind = kind;
      return box(`${D}: ${st.pool.n + st.pool.i} token${st.pool.n + st.pool.i === 1 ? '' : 's'} from Miami left to place.<small>Pick a kind, then click any other region. Done sends the rest back to Miami.</small>`,
        `<button class="btn ${kind === 'n' ? 'brass' : ''}" data-skind="n" ${st.pool.n ? '' : 'disabled'}>Native (${st.pool.n})</button><button class="btn ${kind === 'i' ? 'brass' : ''}" data-skind="i" ${st.pool.i ? '' : 'disabled'}>Invasive (${st.pool.i})</button>${done}`);
    }
    if (st.mode === 'steal') {
      const others = S.players.map((p, i) => ({ p, i })).filter(x => x.i !== S.you && x.p.pileCount);
      return box(`${D}: take a card from another player's scoring pile.<small>Pick a player, then a card.</small>`,
        others.map(x => `<button class="btn brass" data-stealfrom="${x.i}">${esc(x.p.name)} (${x.p.pileCount})</button>`).join('') + done);
    }
  }
  if (st?.type === 'protect') { // the Conservationist's ability, on someone else's Invasive card
    const c = CARDS[st.card];
    return box(`Stop <b>${esc(S.players[st.by].name)}'s ${esc(c.name)}</b> from populating?<small>Once each round you may stop 1 Invasive card from ${c.predatory ? 'hunting or ' : ''}adding its ${c.pop} token${c.pop === 1 ? '' : 's'}. Let it through to save your block for later this round.</small>`,
      `<button class="btn primary" data-protect="1">Stop it</button><button class="btn" data-protect="0">Let it populate</button>`);
  }
  if (st?.type === 'place') return box(`Migratory: place ${st.left} more ${CARDS[st.card].kind} token${st.left > 1 ? 's' : ''}.<small>Click a glowing region on the map. Tokens spread in a continuous line from the current region.</small>`);
  if (st?.type === 'predate') return box(`Predatory: first remove up to ${st.left} token${st.left > 1 ? 's' : ''} — Native or Invasive.<small>Click a blinking green or red counter on the map. ${esc(CARDS[st.card].name)}'s own tokens are added after the hunt.</small>`, `<button class="btn" id="predDone">Done hunting</button>`);
  if (S.tourPeek) {
    const b = BIOMES[S.tourPeek];
    return box(`Top of the location deck: <b>${esc(b.name)}</b><small>${esc(REGIONS[b.region].name)} · ${b.suit} · Risk ${b.risk}</small>`,
      `${biomeEl(S.tourPeek)}<button class="btn" data-tour="0">Leave on top</button><button class="btn brass" data-tour="1">Put on bottom</button>`);
  }
  if (ui.mode === 'landdev') { return box('Land Developer: click any counter on the map to remove 1 token.', `<button class="btn" id="cancelMode">Cancel</button>`); }
  const suit = S.trick.suit || BIOMES[S.trick.biome].suit;
  const follow = S.legal.length < S.hand.length ? (S.coop ? `Follow ${suit} if you can.` : `Follow ${suit} or play an Invasive card.`) : `You can't follow ${suit}, so play anything.`;
  let buttons = '';
  if (S.role && ACTIVE_ABILITY[S.role] && !S.abilityUsed) buttons += `<button class="btn brass" id="ability">${ACTIVE_ABILITY[S.role]}</button>`;
  const sel = ui.sel && S.legal.includes(ui.sel) ? CARDS[ui.sel] : null;
  const shieldUsed = !!(S.trick && S.trick.shield);
  if (sel && S.role === 'Conservationist' && sel.kind === 'Invasive' && !shieldUsed) {
    buttons += `<button class="btn primary" id="play">Play &amp; populate</button><button class="btn" id="playNoPop">Don't populate</button>`;
  } else {
    buttons += `<button class="btn primary" id="play" ${sel ? '' : 'disabled'}>${sel ? 'Play ' + esc(sel.name) : 'Play card'}</button>`;
  }
  return box(`Your turn — pick a card to play.<small>${follow}${S.abilityUsed ? ' Ability used.' : ''}${S.role === 'Conservationist' && shieldUsed ? " You've already stopped an Invasive card this round." : ''}</small>`, buttons);
}

// Your scoring pile: every card you've won in tricks (Natives first, then by habitat and Impact)
function pileModal() {
  const pile = (S.pile || []).slice().sort((a, b) => {
    const A = CARDS[a], B = CARDS[b];
    return (A.kind === B.kind ? 0 : A.kind === 'Invasive' ? 1 : -1) || SUIT_ORDER[A.habitat] - SUIT_ORDER[B.habitat] || B.impact - A.impact;
  });
  const count = (k, v) => pile.filter(id => CARDS[id][k] === v).length;
  const chips = pile.length ? [['kind', 'Native'], ['kind', 'Invasive'], ['habitat', 'Water'], ['habitat', 'Wetland'], ['habitat', 'Land']]
    .map(([k, v]) => `<span>${v} ${count(k, v)}</span>`).join('') : '';
  return `<div class="modal"><div class="paper spiral pilemodal">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Your scoring pile · ${pile.length} card${pile.length === 1 ? '' : 's'}</div><button class="btn small" id="closePile">Close</button></div>
    <p class="hint" style="margin:0">Every card in a trick you win comes here. ${isPhone() ? 'Press and hold' : 'Hover over'} a card to read it.</p>
    ${chips ? `<div class="pilechips">${chips}</div>` : ''}
    <div class="pilegrid">${pile.length ? pile.map(id => cardEl(id, foil(id))).join('') : '<p class="hint">Empty so far. Win a trick to start your pile.</p>'}</div>
  </div></div>`;
}
// Everyone at the table at a glance (Menu > Players & tricks won): role, tricks won, cards left, team
function playersModal() {
  const rows = S.players.map((p, i) => {
    const role = roleInfo(p.role);
    const thumb = p.boss ? `<div class="pthumb boss" style="background-image:url('${BOSS.portrait}')"></div>`
      : p.role ? `<div class="pthumb" style="background-image:url('${CHAR_ANIM.src(p.role, 'idle', p.skin)}')"></div>` : '<div class="pthumb"></div>';
    return `<tr class="${S.waiting === i ? 'winner' : ''}"><td>${thumb}</td>
      <td class="pmname"><b>${esc(p.name)}</b>${i === S.you ? ' <span style="color:var(--red)">(you)</span>' : ''}<div class="lines">${role ? 'the ' + esc(role.name) : 'choosing a role…'} ${teamTag(p.team)}<br>${p.handCount} card${p.handCount === 1 ? '' : 's'} ${p.boss ? 'in its deck' : 'in hand'}</div></td>
      <td class="total">★${p.tricks}</td>
      <td>${role ? `<button class="btn small" data-pinseat="${i}">Role</button>` : ''}</td></tr>`;
  }).join('');
  return `<div class="modal"><div class="paper spiral playersmodal">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Players · round ${S.round || 1}</div><button class="btn small" id="closePlayers">Close</button></div>
    <table class="scores"><tr><th></th><th>Player</th><th title="Tricks won">Tricks</th><th></th></tr>${rows}</table>
    <p class="hint" style="margin:0">Each trick won is worth 5 points. You can also tap a player at the top of the screen to read their role card.</p>
  </div></div>`;
}
// Liberation: pick a card from the chosen player's scoring pile.
function stealModal() {
  const from = ui.stealFrom, pile = S.stealPiles[from] || [];
  return `<div class="modal"><div class="paper spiral">
    <div class="panel-title">Liberation — ${esc(S.players[from].name)}'s scoring pile</div>
    <p class="hint" style="margin:0 0 8px">Click the card to take into your own scoring pile.</p>
    <div class="swapgrid">${pile.map(id => cardEl(id, 'choosable', `data-steal="${id}"`)).join('') || '<span class="hint">Empty.</span>'}</div>
    <div class="row" style="margin-top:10px"><button class="btn" id="stealBack">Back</button></div>
  </div></div>`;
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

// ---------- TUTORIAL COACH ----------
// The tutorial is a real (short) game on the server (startTutorial in game.js). The coach watches the game and
// explains each new idea the first time it comes up. While a tip is open the bots wait (lobby cmd 'hold').
// A tip closes when you press Got it, or by itself once the moment it describes has passed.
const NAT = t => `<b style="color:#2a9a4a">${t}</b>`, INV = t => `<b style="color:#c8323c">${t}</b>`;
const tutSuit = () => S.trick ? (S.trick.suit || BIOMES[S.trick.biome].suit) : '';
const tutMine = () => S.waiting === S.you && S.phase !== 'ended';
const tutPlaying = () => tutMine() && S.phase === 'play' && !S.step && !S.tourPeek;
const COACH = [
  { id: 'welcome', when: () => S.phase !== 'ended', title: 'Welcome to the Everglades!',
    body: () => `This is a short practice game: <b>5 rounds</b> against two friendly bots, with nothing at stake. Each time something new comes up, I'll pause the game and explain it.` },
  { id: 'role', when: () => S.phase !== 'ended', focus: '.rolebox', title: 'You are the Conservationist',
    body: () => `Your role card (${isPhone() ? '"You are the…" above your hand' : 'bottom right'}) shows how you score. ${isPhone() ? 'Tap' : 'Hover'} it to read it${isPhone() ? ', and tap the card to close it' : ''}.<ul>
      <li><b>10 points</b> for each of Fakahatchee, Big Cypress and Everglades National Park that ends with more ${NAT('Native')} than ${INV('Invasive')} tokens</li>
      <li><b>15</b> if ${NAT('Natives')} outnumber ${INV('Invasives')} across the whole map</li>
      <li><b>5</b> if you never win a trick with an Invasive card</li>
      <li><b>5</b> for every trick you win (this is true for every role)</li></ul>` },
  { id: 'map', when: () => S.phase !== 'ended', focus: '.boardwrap', title: 'The map',
    body: () => `Each region shows how many ${NAT('Native')} and ${INV('Invasive')} tokens live there. Every card you play adds its animals to the map, so each card changes who is ahead in a region.` },
  { id: 'hand', when: () => S.phase !== 'ended', focus: '.hand', title: 'Your hand',
    body: () => `Each card has a <b>type</b> (Wetland, Water or Land), an <b>Impact</b> (its strength in a trick) and a <b>population</b> (how many tokens it adds). Each card is either ${NAT('Native')} or ${INV('Invasive')}. ${isPhone() ? 'Press and hold' : 'Hover over'} any card for a second to read it up close.` },
  { id: 'choose', when: () => tutMine() && S.phase === 'choose', focus: '.tablecol', title: 'Choose where to travel',
    body: () => `You lead this round, so you choose a biome from the travel row:<ul>
      <li>Its <b>type</b> is the suit everyone must follow.</li>
      <li>Its <b>region</b> is where this round's cards add their tokens.</li>
      <li>Its <b>Invasive Risk</b> decides whether Invasive cards can win.</li></ul>
      ${S.round === 1 ? 'Tip: <b>Freshwater Slough</b> is a Wetland in Big Cypress, one of your objective regions, and you hold strong Wetland cards.' : ''}` },
  { id: 'play', when: tutPlaying, focus: '.hand', title: 'Play a card',
    body: () => `This round's suit is <b>${tutSuit()}</b>. If you hold a ${tutSuit()} Native card, you must play one (or an Invasive card). The cards you can play glow. The <b>highest-Impact card that matches the suit</b> wins the trick. Click a card, then press <b>Play</b>.` },
  { id: 'invasive', when: () => tutPlaying() && S.legal.some(id => CARDS[id].kind === 'Invasive'), focus: '.hand', title: 'Invasive cards',
    body: () => `Invasive cards can be played at any time. One matches the suit only if its Impact is at or below the round's <b>Invasive Risk</b> (now ${S.myRisk ?? S.trick.risk}). A <b>!</b> badge means the card is above the Risk and can't win. If an Invasive card wins a trick, it sets off an ${INV('Invasive Crisis')}. As the Conservationist, once each round you may stop 1 Invasive card from adding its tokens: yours (choose <b>Don't populate</b>) or anyone else's (you'll be asked when they play it).` },
  { id: 'cantfollow', when: () => tutPlaying() && !S.hand.some(id => CARDS[id].kind === 'Native' && CARDS[id].habitat === tutSuit()), title: "Can't follow suit",
    body: () => `You have no ${tutSuit()} Native card, so you may play anything. An off-suit card wins only when <b>nobody</b> matched the suit; then the highest-Impact off-suit card wins. An Invasive card above the Risk can never win this way. A weak card here saves your strong ones.` },
  { id: 'predate', when: () => tutMine() && S.step && S.step.type === 'predate', focus: '.boardwrap', title: 'Predatory cards',
    body: () => `<b>${esc(CARDS[S.step.card].name)}</b> is a predator. Before its own tokens arrive, it may remove up to ${S.step.left} token${S.step.left > 1 ? 's' : ''} from this region. Hunt the ${INV('red Invasive')} counters to protect your Native majority, then press <b>Done hunting</b>.` },
  { id: 'place', when: () => tutMine() && S.step && S.step.type === 'place', focus: '.boardwrap', title: 'Migratory cards',
    body: () => `This card is Migratory, so its tokens spread out in a line of neighbouring regions, starting here. Click the glowing regions to place them one at a time.` },
  { id: 'keystone', when: () => S.trick && S.trick.keystones > 0 && S.phase === 'play', focus: '.boardwrap', title: 'Keystone species',
    body: () => `A Keystone card is in this trick. Until the trick ends, every ${NAT('Native')} token in ${esc(REGIONS[BIOMES[S.trick.biome].region].name)} lowers the Invasive Risk by 1 (it's now <b>${S.trick.risk}</b>). Invasive cards then find it much harder to match.` },
  { id: 'trick', when: () => !!S.lastTrick, focus: '.tablecol', title: 'Trick over!',
    body: () => {
      const lt = S.lastTrick, w = lt.winner === S.you ? 'You' : esc(S.players[lt.winner].name);
      const why = !lt.matched ? 'Nobody matched the suit, so the highest off-suit card won.'
        : lt.crisis ? `It was an Invasive card at or below the Risk (${lt.risk}), so it matched the suit.` : 'It was the highest-Impact card that matched the suit.';
      return `${w} won ${esc(BIOMES[lt.biome].name)} with <b>${esc(CARDS[lt.card].name)}</b>. ${why} The winner takes every card played into their scoring pile, scores <b>5 points</b>, and leads the next round.`;
    } },
  { id: 'crisis', when: () => S.lastTrick && S.lastTrick.crisis, focus: '.boardwrap', title: 'Invasive Crisis!',
    body: () => `An Invasive card won the trick. Across the whole map, each region loses 1 ${NAT('Native')} token for every ${INV('Invasive')} token there (a region with only Invasives loses 1 of those).${S.lastTrick.winner === S.you ? " Because you won with an Invasive card, you lose the Conservationist's 5-point bonus." : ''}` },
  { id: 'offsuit', when: () => S.lastTrick && S.lastTrick.matched === false, title: 'Nobody matched',
    body: () => 'When no card matches the suit, the highest-Impact <b>off-suit</b> card wins. Invasive cards above the Invasive Risk can never win this way.' },
  { id: 'rivals', when: () => S.lastTrick && S.phase !== 'ended' && !S.trick, focus: '.players', title: 'Your rivals',
    body: () => `Everyone's role is public. ${isPhone() ? 'Tap' : 'Hover'} a player to read their goals. ${S.players.map((p, i) => i === S.you ? '' : `<b>${esc(p.name)}</b> is the ${esc(ROLES[p.role].name)}.`).join(' ')} The Land Developer wants Invasives in Miami, empty regions and the most tricks. Get in their way when you can.` },
  { id: 'end', when: () => S.phase === 'ended' && !holding(), title: 'Final scoring',
    body: () => "The game ends when the cards run out. Each player scores 5 points per trick plus their role's objectives, and the table shows how every score was made. That's the whole game! Real tables have 2 to 6 players, a role draft, character abilities, Partners and Co-op modes, and optional Disruption cards." },
];
function coachTip() {
  if (!S || !S.tutorial || ui.coachOff) return null;
  ui.coachSeen = ui.coachSeen || new Set();
  let t = ui.coach && COACH.find(x => x.id === ui.coach);
  if (t && !t.when()) { ui.coachSeen.add(t.id); t = null; } // its moment has passed
  if (!t) t = COACH.find(x => !ui.coachSeen.has(x.id) && x.when()) || null;
  ui.coach = t ? t.id : null;
  return t;
}
function coachHtml(t) {
  if (!t) return '';
  return `<div class="paper spiral coach ${t.focus === '.players' ? 'right' : ''}" role="dialog" aria-label="Tutorial tip">
    <div class="coach-step">Tutorial tip</div>
    <div class="panel-title">${t.title}</div>
    <div class="coach-body">${t.body()}</div>
    <div class="row"><button class="btn primary" id="coachOk">Got it</button><button class="btn small" id="coachOff">Hide tips</button></div>
  </div>`;
}
// keep the bots waiting while a tip is open (the server only honours this at tutorial tables)
function coachSync() {
  if (!S || !S.tutorial) { ui.coachHold = false; return; } // only tutorial tables take 'hold' (others answered with an error toast)
  const want = !!(ui.coach && S.phase !== 'ended');
  if (want !== ui.coachHold) { ui.coachHold = want; lobby('hold', { on: want }); }
}
function rulesModal() {
  return `<div class="modal"><div class="paper spiral">
    <div class="row" style="justify-content:space-between"><div class="panel-title">How to play</div><button class="btn small" id="closeRules">Close</button></div>
    <div class="row" style="align-items:flex-start;gap:16px;flex-wrap:nowrap">
      <img src="assets/ref-front.png" data-peek="assets/ref-front.png" alt="On your turn" style="width:min(240px,30%);border:3px solid var(--ink)">
      <img src="assets/ref-back.png" data-peek="assets/ref-back.png" alt="Playing tricks" style="width:min(240px,30%);border:3px solid var(--ink)">
      <div class="hint" style="flex:1;min-width:0;color:var(--ink)">
        <p style="margin-top:0"><b>Setup:</b> after the cards are dealt, players choose roles one at a time in turn order.</p>${S.coop ? `<p><b>Co-op vs The Anaconda:</b> you hold only Native cards. After each player's turn the Anaconda flips its top Invasive card. When it wins a trick it travels to the highest-Risk biome. Its Predatory cards eat Native tokens and its Migratory cards move next door to the most Natives. The game ends after the round it plays its last card. Add all players' scores together — you must beat the Anaconda's score (hover its name to read its boss card).</p>` : ''}<p><b>Each round:</b> the lead player picks a biome from the travel row. Everyone plays one card, in order.</p>
        <p><b>Winning:</b> the highest-Impact card that matches the biome's type wins. Invasive cards match too if their Impact is at or below the current Invasive Risk. A <b>Keystone</b> card lowers the Risk by the number of Native tokens in the region. If nothing matches, the highest-Impact off-suit card wins, but an Invasive card whose Impact is above the Invasive Risk can never win this way.</p>
        <p><b>Invasive Crisis:</b> if an Invasive card wins, each region loses 1 Native token per Invasive token there (or 1 Invasive token if it has only Invasives).</p>
        <p><b>Scoring:</b> 5 points per trick, plus the objectives on your role card. Everyone's role is public — hover a name to read it.</p>
      </div>
    </div></div></div>`;
}

// Eco-buck payouts for a finished game (accounts.js settle)
function settlementHtml() {
  const st = S.settlement; if (!st) return '';
  if (!st.bet) return '<div class="ebresult"><div class="panel-title" style="margin:0">Free table</div><p class="hint" style="margin:4px 0">Just for fun: no Eco-bucks were won or lost.</p></div>';
  const rows = st.results.slice().sort((a, b) => a.place - b.place || b.payout - a.payout).map(r => {
    const p = S.players[r.seat];
    return `<tr class="${r.seat === S.you ? 'winner' : ''}"><td class="total" style="font-size:20px">${r.place}</td>
      <td>${p.profile ? `<img class="pavatar tiny" src="${esc(p.profile.avatarSrc)}" alt="">` : ''}<b>${esc(p.name)}</b>${p.bot ? ' <span class="hint">(bot · house)</span>' : ''}</td>
      <td>${fmtEB(r.payout)}</td><td class="${r.net >= 0 ? 'ebup' : 'ebdown'}">${r.net >= 0 ? '+' : '−'}${Math.abs(r.net).toLocaleString()} EB</td></tr>`;
  }).join('');
  const mine = st.results.find(r => r.seat === S.you);
  return `<div class="ebresult">
    <div class="panel-title" style="margin:0">Eco-bucks · ${st.bet} EB buy-in · pot ${Number(st.pot).toLocaleString()} EB</div>
    ${mine && mine.balance !== undefined ? `<p style="margin:4px 0;font-size:18px">You ${mine.net >= 0 ? 'won' : 'lost'} <b class="${mine.net >= 0 ? 'ebup' : 'ebdown'}">${Math.abs(mine.net).toLocaleString()} EB</b>. Your balance is now ${fmtEB(mine.balance)}.</p>` : ''}
    <table class="scores ebtable"><tr><th>Place</th><th>Player</th><th>Paid out</th><th>Net</th></tr>${rows}</table>
  </div>`;
}

// A story ending, as text (the conditions and variants live in endings.js on the server)
function storyHtml(e, who) {
  if (!e) return '';
  return `<div class="story ${e.good ? 'good' : 'grim'}">
    <div class="story-kicker">${esc(who)} · ${e.good ? 'Good ending' : 'Grim ending'}</div>
    <h3 class="story-title">${esc(e.title)}</h3>
    <div class="story-cond">${esc(e.condition || '')}</div>
    <p class="story-text">${esc(e.text)}</p>
  </div>`;
}
// small still portrait of a character (first frame of its idle animation)
const portraitThumb = (role, skin) => `<div class="pthumb" style="background-image:url('${CHAR_ANIM.src(role, 'idle', skin)}')" ${peekAttrs(role, skin)}></div>`;

function coopEndModal() {
  const R = S.results;
  const e = R.scores.find(x => x.p === R.ending.p);
  const role = ROLES[e.role];
  const row = sc => `<tr>
        <td>${portraitThumb(sc.role, (S.players[sc.p] || {}).skin)}</td>
        <td><b>${esc(sc.name)}</b><br><span class="hint">${esc(ROLES[sc.role].name)}</span></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td>
        <td class="total">${sc.total}</td></tr>`;
  return `<div class="modal"><div class="paper spiral">
    <h2 class="logo" style="font-size:38px;${R.playersWin ? '' : 'color:var(--red)'}">${R.playersWin ? 'THE EVERGLADES ARE SAVED!' : 'THE ANACONDA WINS!'}</h2>
    <p style="font-size:22px;margin:6px 0">Players <b>${R.playersTotal}</b> &nbsp;vs&nbsp; The Anaconda <b>${R.anaconda.total}</b>${R.playersTotal === R.anaconda.total ? ' <span class="hint">(the Anaconda wins ties)</span>' : ''}</p>
    <p class="hint" style="margin:0 0 6px">${R.playersWin
      ? `${esc(e.name)}, the highest scorer, tells how the story ends:`
      : `${esc(e.name)}, the lowest scorer, tells how the story ends:`}</p>
    <div class="stories">
      ${storyHtml(R.coopEnding, `${e.name} — the ${role.name}`)}
      ${storyHtml(R.bossEnding, "The Anaconda's epilogue")}
    </div>
    ${settlementHtml()}<table class="scores"><tr><th>Role</th><th>Player</th><th>Breakdown</th><th>Total</th></tr>
      <tr class="teamrow"><td colspan="3">The players, together</td><td class="total">${R.playersTotal}</td></tr>
      ${R.scores.map(row).join('')}
      <tr class="teamrow bossrow"><td colspan="3">The Anaconda</td><td class="total">${R.anaconda.total}</td></tr>
      <tr><td><div class="pthumb boss" style="background-image:url('${BOSS.portrait}')" data-peek="${BOSS.img}"></div></td><td><b>The Anaconda</b><br><span class="hint">Co-op boss</span></td>
        <td class="lines">${R.anaconda.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td><td class="total">${R.anaconda.total}</td></tr>
    </table>
    <div class="row">${S.isHost ? '<button class="btn primary" id="rematch">Back to lobby</button>' : '<span class="hint">The host can start a new game.</span>'}<button class="btn" id="quit2">Leave</button></div>
  </div></div>`;
}

function endModal() {
  const R = S.results;
  if (R.coop) return coopEndModal();
  if (S.tutorial) return tutorialEndModal();
  const sorted = R.scores.slice().sort((a, b) => b.total - a.total);
  const endings = `<div class="stories">${R.winners.map(w => {
    const sc = R.scores.find(x => x.p === w);
    return storyHtml(sc.ending, `${sc.name} — the ${ROLES[sc.role].name}`);
  }).join('')}</div>`;
  const row = sc => `<tr class="${R.winners.includes(sc.p) ? 'winner' : ''}">
        <td>${portraitThumb(sc.role, (S.players[sc.p] || {}).skin)}</td>
        <td><b>${esc(sc.name)}</b><br><span class="hint">${esc(ROLES[sc.role].name)}</span></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td>
        <td class="total">${sc.total}</td></tr>`;
  if (R.teams) {
    // Partner mode: one block per team, with the team total
    const tied = R.teams.filter(t => t.total === R.teams[0].total).length > 1;
    const title = tied ? "IT'S A TIE!" : `TEAM ${TEAMS[R.teams[0].team].name.toUpperCase()} WINS!`;
    return `<div class="modal"><div class="paper spiral">
    <h2 class="logo" style="font-size:38px">${title}</h2>
    <p class="hint" style="margin:4px 0 8px">How the story ends for the winning partners:</p>
    ${endings}
    ${settlementHtml()}<table class="scores"><tr><th>Role</th><th>Player</th><th>Breakdown</th><th>Total</th></tr>
      ${R.teams.map(t => `<tr class="teamrow"><td colspan="3">${teamTag(t.team)} ${t.members.map(m => esc(S.players[m].name)).join(' &amp; ')}</td><td class="total">${t.total}</td></tr>
        ${t.members.map(m => row(R.scores.find(x => x.p === m))).join('')}`).join('')}
    </table>
    <div class="row">${S.isHost ? '<button class="btn primary" id="rematch">Back to lobby</button>' : '<span class="hint">The host can start a new game.</span>'}<button class="btn" id="quit2">Leave</button></div>
  </div></div>`;
  }
  return `<div class="modal"><div class="paper spiral">
    <h2 class="logo" style="font-size:38px">${R.winners.length > 1 ? "IT'S A TIE!" : esc(S.players[R.winners[0]].name).toUpperCase() + ' WINS!'}</h2>
    <p class="hint" style="margin:4px 0 8px">How the story ends for the ${R.winners.length > 1 ? 'winners' : 'winner'}:</p>
    ${endings}
    ${settlementHtml()}<table class="scores"><tr><th>Role</th><th>Player</th><th>Breakdown</th><th>Total</th></tr>
      ${sorted.map(sc => `<tr class="${R.winners.includes(sc.p) ? 'winner' : ''}">
        <td>${portraitThumb(sc.role, (S.players[sc.p] || {}).skin)}</td>
        <td><b>${esc(sc.name)}</b><br><span class="hint">${esc(ROLES[sc.role].name)}</span></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td>
        <td class="total">${sc.total}</td></tr>`).join('')}
    </table>
    <div class="row">${S.isHost ? '<button class="btn primary" id="rematch">Back to lobby</button>' : '<span class="hint">The host can start a new game.</span>'}<button class="btn" id="quit2">Leave</button></div>
  </div></div>`;
}

function tutorialEndModal() {
  const R = S.results, me = R.scores.find(x => x.p === S.you);
  const won = R.winners.includes(S.you);
  return `<div class="modal"><div class="paper spiral">
    <h2 class="logo" style="font-size:34px">TUTORIAL COMPLETE!</h2>
    <p class="hint" style="margin:4px 0 8px">${won ? 'You won your first game. Nice work, Conservationist!' : `You scored ${me ? me.total : 0} points. The bots got you this time, but now you know how it all works.`}</p>
    <table class="scores"><tr><th>Role</th><th>Player</th><th>Breakdown</th><th>Total</th></tr>
      ${R.scores.slice().sort((a, b) => b.total - a.total).map(sc => `<tr class="${R.winners.includes(sc.p) ? 'winner' : ''}">
        <td>${portraitThumb(sc.role, (S.players[sc.p] || {}).skin)}</td>
        <td><b>${esc(sc.name)}</b><br><span class="hint">${esc(ROLES[sc.role].name)}</span></td>
        <td class="lines">${sc.lines.map(l => `${esc(l.label)}: <b style="color:var(--ink)">${l.pts}</b>`).join('<br>')}</td>
        <td class="total">${sc.total}</td></tr>`).join('')}
    </table>
    <div class="row"><button class="btn primary" id="quit2">Back to the home page</button><button class="btn" id="tutAgain">Play the tutorial again</button></div>
  </div></div>`;
}
async function startTutorial() {
  try { const r = await acctApi('tutorial', {}); ui.coach = null; ui.coachSeen = new Set(); ui.coachOff = false; ui.coachHold = undefined; enterRoom(r); }
  catch (e) { ui.err = e.message; render(); }
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

// ---------- role cards with a living portrait ----------
// Every role card on screen gets an animated canvas over its photo ("art box"), drawn in the skin of the player
// it belongs to. All role cards share one layout (1050x750); the photo sits at x 99-419, y 71-347.
const ARTBOX = { left: 99 / 1050, top: 71 / 750, width: 321 / 1050, height: 277 / 750 };
// The skin the person at this screen has on for a role (only owned skins are listed in a profile's skins).
function viewerSkin(role) {
  const me = (S && S.myAccount) || acct.me;
  return (me && me.skins && me.skins[role]) || null;
}
// The skin a role card should show in this game: whoever holds the role, or your own if nobody does yet.
function tableSkin(role) {
  const holder = S && S.players ? S.players.find(p => p.role === role && !p.boss) : null;
  return holder ? holder.skin || null : viewerSkin(role);
}
// A role card image with its animated art box. Boss and unknown roles fall back to the plain card.
function roleCardHtml(role, skin, alt) {
  const R = ROLES[role];
  if (!R) return '';
  return `<div class="rcard"><img src="${R.img}" alt="${esc(alt || R.name)}">${artboxCanvas(role, skin)}</div>`;
}
const artboxCanvas = (role, skin) => `<canvas class="artbox" width="${CHAR_ANIM.w}" height="${CHAR_ANIM.h}" data-role="${role}" data-skin="${skin || ''}"
  style="left:${(ARTBOX.left * 100).toFixed(3)}%;top:${(ARTBOX.top * 100).toFixed(3)}%;width:${(ARTBOX.width * 100).toFixed(3)}%;height:${(ARTBOX.height * 100).toFixed(3)}%"></canvas>`;
// data-peek attributes that make the enlarged hover card show the same living portrait
const peekAttrs = (role, skin) => ROLES[role] ? `data-peek="${ROLES[role].img}" data-peekrole="${role}" data-peekskin="${skin || ''}"` : '';
// Art boxes mostly breathe and blink, with the odd signature move. Each canvas keeps its own rhythm.
function drawArtboxes() {
  const now = performance.now();
  for (const cv of document.querySelectorAll('canvas.artbox')) {
    const role = cv.dataset.role, skin = cv.dataset.skin || null;
    let st = cv._st;
    if (!st || now >= st.until) {
      const anim = !st ? 'idle' : reducedMotion.matches ? 'idle' : (Math.random() < 0.22 ? 'signature' : 'idle');
      const hold = !st ? Math.random() * 2500 : 1200 + Math.random() * 3800; // stand still between clips
      st = cv._st = { anim, start: now + hold, until: now + hold + clipLength(anim) };
    }
    const playingNow = now >= st.start && !reducedMotion.matches;
    let anim = playingNow ? st.anim : 'idle';
    let frame = playingNow ? Math.floor((now - st.start) / 1000 * CHAR_ANIM.anims[anim].fps) % CHAR_ANIM.frames : 0;
    let im = sprite(role, anim, skin);
    if (!im.complete || !im.naturalWidth) { anim = 'idle'; frame = 0; im = sprite(role, 'idle', skin); }
    if (!im.complete || !im.naturalWidth) continue;
    const key = (skin || '') + anim + frame;
    if (cv.dataset.k === key) continue;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, frame * CHAR_ANIM.w, 0, CHAR_ANIM.w, CHAR_ANIM.h, 0, 0, cv.width, cv.height);
    cv.dataset.k = key;
  }
}

// ---------- animated character portraits ----------
// Each portrait plays one animation at a time. Reactions from the server (cheer, upset, shock, signature...)
// interrupt anything weaker; in between, characters idle (breathe and blink), think while it's their turn,
// and now and then do their signature move. Timing lives here, not in the DOM, so re-renders never restart a clip.
const sprites = {};
function sprite(role, anim, skin) { // skin: a SKINS id, or null for the original look
  const k = role + '/' + (skin || '') + '/' + anim;
  if (!sprites[k]) { const im = new Image(); im.src = CHAR_ANIM.src(role, anim, skin); sprites[k] = im; }
  return sprites[k];
}
const preloaded = new Set();
function preloadChar(role, skin) {
  const k = role + '/' + (skin || '');
  if (preloaded.has(k)) return;
  preloaded.add(k);
  for (const a of Object.keys(CHAR_ANIM.anims)) sprite(role, a, skin);
}
const playing = {}; // seat -> { anim, pri, start, until }
const passive = {}; // seat -> time of the next passive animation
const EMOTE = { think: '?', signature: '♪', cheer: '★', upset: '…', shock: '!' };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function clipLength(anim) { const A = CHAR_ANIM.anims[anim]; return CHAR_ANIM.frames / A.fps * 1000 * (A.loops || 1); }
// at: when the clip starts (pass the frame's own clock reading, so a clip never starts "after" the frame drawing it)
function react(seat, anim, pri = 1, at = performance.now()) {
  if (!CHAR_ANIM.anims[anim]) return;
  const now = at, cur = playing[seat];
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
      react(seat, anim, 0, now);
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
    // (never below frame 0: a negative frame would draw nothing at all, a black flash on the dark portrait)
    let frame = cur ? Math.floor(Math.max(0, now - cur.start) / 1000 * CHAR_ANIM.anims[anim].fps) % CHAR_ANIM.frames : 0;
    const skin = p.skin || null;
    preloadChar(p.role, skin);
    let im = sprite(p.role, anim, skin);
    if (!im.complete || !im.naturalWidth) { anim = 'idle'; frame = 0; im = sprite(p.role, 'idle', skin); } // still loading
    if (!im.complete || !im.naturalWidth) continue;
    const key = (skin || '') + anim + frame;
    if (!force && cv.dataset.k === key) continue;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, frame * CHAR_ANIM.w, 0, CHAR_ANIM.w, CHAR_ANIM.h, 0, 0, cv.width, cv.height);
    cv.dataset.k = key;
  }
}
(function loop() { drawPortraits(false); drawSkinPreview(); drawArtboxes(); requestAnimationFrame(loop); })();

// ---------- bot speech bubbles ----------
const $bubbles = document.getElementById('bubbles');
function placeBubbles() {
  if (!$bubbles) return;
  const now = Date.now();
  let html = '';
  // phones have room for one speech bubble at a time: show only the newest
  const newest = Math.max(0, ...Object.values(ui.bubbles).map(b => b.id));
  for (const [seat, b] of Object.entries(ui.bubbles)) {
    if (b.until < now || !S || !S.players || !S.players[seat]) { delete ui.bubbles[seat]; continue; }
    if (isPhone() && b.id !== newest) continue;
    const rows = [...document.querySelectorAll(`.pl[data-seat="${seat}"]`)].filter(el => el.offsetParent);
    if (!rows.length) continue;
    const r = rows[0].getBoundingClientRect();
    const below = r.right + 260 > innerWidth;         // no room on the right: hang it underneath instead
    const x = below ? Math.max(8, Math.min(r.left, innerWidth - Math.min(240, innerWidth * 0.7) - 8)) : r.right + 12;
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
    el.src = 'assets/ecology-back.png?v=' + BACK_V; el.className = 'deal-card';
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
      el.src = 'assets/ecology-back.png?v=' + BACK_V; el.className = 'deal-card';
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
  // The page is patched in place (see view.html), so elements live on across renders: each gets a single click
  // listener once, and this render's handlers are looked up in el.__on (reset here, so stale ones can't fire).
  for (const el of $app.querySelectorAll('*')) if (el.__on) el.__on = null;
  const on = (el, sel, fn) => {
    if (!el.__wired) { el.__wired = true; el.addEventListener('click', e => { for (const h of Object.values(el.__on || {})) h(e); }); }
    (el.__on = el.__on || {})[sel] = fn;
  };
  const q = (sel, fn) => $app.querySelectorAll(sel).forEach(el => on(el, sel, e => { e.stopPropagation(); fn(el, e); }));
  q('#speed', () => lobby('speed', { speed: SPEED_ORDER[(SPEED_ORDER.indexOf(S.speed) + 1) % SPEED_ORDER.length] }));
  q('#mute', () => { muted = !muted; try { localStorage.setItem('eg_mute', muted ? '1' : '0'); } catch {} render(); });
  q('#rules, [data-g="rules"]', () => { ui.showRules = true; ui.showLog = false; render(); });
  q('#notesBtn, [data-g="notes"]', () => { ui.showLog = !ui.showLog; ui.showChat = false; ui.unread = 0; render(); });
  q('#chatBtn, [data-g="chat"]', () => { ui.showChat = !ui.showChat; ui.showLog = false; render(); });
  q('[data-g="speed"]', () => lobby('speed', { speed: SPEED_ORDER[(SPEED_ORDER.indexOf(S.speed) + 1) % SPEED_ORDER.length] }));
  q('[data-g="mute"]', () => { muted = !muted; try { localStorage.setItem('eg_mute', muted ? '1' : '0'); } catch {} render(); });
  q('[data-g="myrole"]', () => { const el = $app.querySelector('.hand-cap .myrole'); if (el) pinPeek(el); });
  q('[data-g="players"]', () => { ui.showPlayers = true; render(); });
  q('[data-g="pile"]', () => { ui.showPile = !ui.showPile; ui.showLog = ui.showChat = false; hidePeek(); render(); });
  q('#closePile', () => { ui.showPile = false; render(); });
  q('#closePlayers', () => { ui.showPlayers = false; render(); });
  q('[data-pinseat]', el => { const t = [...$app.querySelectorAll(`.pl[data-seat="${el.dataset.pinseat}"]`)].find(x => x.dataset.peekrole); ui.showPlayers = false; render(); if (t) pinPeek(t); });
  q('[data-g="quit"]', () => { if (confirm('Leave this game?')) leave(); });
  q('[data-stage]', el => switchStage(el.dataset.stage));
  q('#closeRules', () => { ui.showRules = false; render(); });
  q('#quit', () => { if (confirm('Leave this game?')) leave(); });
  q('#quit2', () => leave());
  q('#rematch', () => lobby('rematch'));
  q('#coachOk', () => { ui.coachSeen.add(ui.coach); ui.coach = null; render(); });
  q('#coachOff', () => { ui.coachOff = true; ui.coach = null; render(); });
  q('#tutAgain', () => { leave(); startTutorial(); });
  q('[data-botify]', el => lobby('botify', { pid: el.dataset.botify }));
  q('[data-role]', el => { hidePeek(); act({ type: 'pickRole', role: el.dataset.role }); });
  q('[data-choose]', el => { hidePeek(); act({ type: 'chooseBiome', biome: el.dataset.choose }); });
  $app.querySelectorAll('[data-place]').forEach(el => on(el, '[data-place]', () => act({ type: 'place', region: el.dataset.place })));
  q('[data-pick]', el => {
    const [region, kind] = el.dataset.pick.split(':');
    if (ui.mode === 'landdev') { ui.mode = null; act({ type: 'ability', region, kind }); }
    else act({ type: 'predate', region, kind });
  });
  q('#predDone', () => act({ type: 'predateDone' }));
  // Disruptions
  q('[data-ddraft]', el => { hidePeek(); act({ type: 'draftDis', card: el.dataset.ddraft }); });
  q('[data-commit]', el => { hidePeek(); act({ type: 'commitDis', card: el.dataset.commit || null }); });
  q('[data-dpick]', el => { const [region, kind] = el.dataset.dpick.split(':'); act({ type: 'dRemove', region, kind }); });
  $app.querySelectorAll('[data-ddest]').forEach(el => on(el, '[data-ddest]', () => act({ type: 'dDest', region: el.dataset.ddest })));
  $app.querySelectorAll('[data-dscatter]').forEach(el => on(el, '[data-dscatter]', () => act({ type: 'dScatter', region: el.dataset.dscatter, kind: ui.scatterKind || 'n' })));
  q('[data-skind]', el => { ui.scatterKind = el.dataset.skind; render(); });
  q('#dDone', () => { ui.stealFrom = null; act({ type: 'dDone' }); });
  q('[data-stealfrom]', el => { ui.stealFrom = +el.dataset.stealfrom; render(); });
  q('#stealBack', () => { ui.stealFrom = null; render(); });
  q('[data-steal]', el => { const from = ui.stealFrom; ui.stealFrom = null; hidePeek(); act({ type: 'dSteal', from, card: el.dataset.steal }); });
  q('[data-tour]', el => act({ type: 'tourDecide', bottom: el.dataset.tour === '1' }));
  q('[data-protect]', el => act({ type: 'protect', block: el.dataset.protect === '1' }));
  q('#cancelMode', () => { ui.mode = null; ui.swapHand = ui.swapPile = null; render(); });
  q('#ability', () => {
    if (S.role === 'Tourist') return act({ type: 'ability' });
    if (S.role === 'LandDeveloper') { ui.mode = 'landdev'; ui.scrollTo = 'board'; return render(); }
    ui.mode = 'swap'; ui.swapHand = ui.swapPile = null; render();
  });
  q('[data-sh]', el => { ui.swapHand = el.dataset.sh; ui.swapPile = null; render(); });
  q('[data-sp]', el => { ui.swapPile = el.dataset.sp; render(); });
  q('#doSwap', () => { const a = { type: 'ability', handCard: ui.swapHand, pileCard: ui.swapPile }; ui.mode = null; ui.swapHand = ui.swapPile = null; act(a); });
  q('[data-hand]', el => {
    const id = el.dataset.hand;
    if (!isMine() || S.phase !== 'play' || S.step || S.tourPeek || ui.mode) return;
    if (!S.legal.includes(id)) { SFX.error(); return showToast(`You must follow ${S.trick.suit || BIOMES[S.trick.biome].suit} or play an Invasive card.`); }
    hidePeek();
    if (ui.sel === id && !(S.role === 'Conservationist' && CARDS[id].kind === 'Invasive' && !(S.trick && S.trick.shield))) return tryPlay(id);
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
    if (S.role === 'LandDeveloper') { ui.mode = 'landdev'; ui.scrollTo = 'board'; return render(); }
    ui.mode = 'swap'; ui.swapHand = ui.swapPile = null; render();
  });
}

connect();
render();
initAccounts();
