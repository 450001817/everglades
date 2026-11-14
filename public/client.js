// Everglades — browser client. Renders whatever the server says the game looks like.
'use strict';
const { CARDS, REGIONS, BIOMES, ROLES, BOSS, CHAR_ANIM, SKINS, CHAT, CHAT_GROUP_NAMES, DISRUPTIONS, FOIL_PRICE } = window.EG_DATA;
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

// ---------- title theme (music.js): loops on the home page, lobby and loading screen ----------
const theme = window.EG_THEME ? EG_THEME.createTheme(() => audio()) : null;
let musicOn = (() => { try { return localStorage.getItem('eg_music') !== '0'; } catch { return true; } })();
function updateMusic() {
  if (!theme) return;
  const want = musicOn && (!sess || !S || S.phase === 'lobby');
  if (want && !theme.playing) theme.start();
  else if (!want && theme.playing) theme.stop();
}
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
const musicBtnHtml = () => `<button class="btn small musicbtn" id="musicBtn" title="Title music on/off">${musicOn ? '♪ Music: On' : '♪ Music: Off'}</button>`;
document.addEventListener('click', e => {
  if (!e.target.closest('#musicBtn')) return;
  musicOn = !musicOn;
  try { localStorage.setItem('eg_music', musicOn ? '1' : '0'); } catch {}
  e.target.closest('#musicBtn').textContent = musicOn ? '♪ Music: On' : '♪ Music: Off';
  updateMusic();
});
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
  if (n > 0) setTimeout(() => showToast(`Daily log-in bonus: +${n} EB!<small>Come back tomorrow for another ${n}.</small>`, false, 5000), 300);
}
async function signInGuest() {
  try { const r = await acctApi('auth/guest', { deviceKey: deviceKey() }); setSession(r.session); acct.me = r.me; ui.err = ''; announceBonus(r.bonus); }
  catch (e) { ui.err = e.message; }
  render();
}
async function signInGoogle(credential) {
  try { const r = await acctApi('auth/google', { credential }); setSession(r.session); acct.me = r.me; ui.err = ''; announceBonus(r.bonus); }
  catch (e) { ui.err = e.message; }
  render();
}
async function signOut() {
  try { await acctApi('auth/signout', {}); } catch {}
  setSession(null); acct.me = null; acct.modal = null;
  if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  render();
}
// "Sign in with Google" button (only when the server has a Google client id set up)
let gsiReady = false;
function mountGoogleButton() {
  const el = document.getElementById('gbtn');
  const cid = acct.config && acct.config.googleClientId;
  if (!el || !cid) return;
  if (!(window.google && google.accounts && google.accounts.id)) {
    if (!document.getElementById('gsi')) {
      const s = document.createElement('script'); s.id = 'gsi'; s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = mountGoogleButton; document.head.appendChild(s);
    }
    return;
  }
  if (!gsiReady) { google.accounts.id.initialize({ client_id: cid, callback: r => signInGoogle(r.credential) }); gsiReady = true; }
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
      ${p.titleName ? `<div class="pb-title sparkle">${esc(p.titleName)}</div>` : ''}
      ${extra}
    </div></div>`;
}

// Profile: gamertag, profile picture, stats
function profileModal() {
  const me = acct.me, C = acct.config; if (!me || !C) return '';
  const need = C.econ.unlockWins;
  const tile = (a, locked, label, sub) => `<button class="avtile ${me.avatar === a.id ? 'on' : ''} ${locked ? 'locked' : ''}" ${locked ? 'disabled' : `data-avatar="${a.id}"`} title="${esc(label)}">
      <img src="${a.src}" alt="${esc(label)}">${locked ? `<span class="lock">${sub}</span>` : ''}</button>`;
  const chars = C.avatars.characters.map(a => tile(a, false, a.id.split(':')[1].replace('LandDeveloper', 'Land Developer'))).join('');
  const unlockedN = C.avatars.animals.filter(a => me.unlocked.includes(a.id)).length;
  const animals = C.avatars.animals.map(a => {
    const wins = me.cardWins[a.card] || 0, locked = !me.unlocked.includes(a.id);
    return tile(a, locked, `${a.name}${locked ? ` — win ${need} tricks with this card (${wins}/${need})` : ''}`, `${wins}/${need}`);
  }).join('');
  return `<div class="modal"><div class="paper spiral acctmodal">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Your profile</div><button class="btn small" data-close>Close</button></div>
    ${bannerHtml(me, { size: 'big', extra: `<div class="pb-bal">${fmtEB(me.balance)}</div>` })}
    <div class="row" style="flex-wrap:nowrap">
      <input id="tagInput" class="field" maxlength="16" value="${esc(me.gamertag)}" aria-label="Gamertag">
      <button class="btn brass" id="saveTag">Save gamertag</button>
    </div>
    <p class="hint" style="margin:0">Games ${me.stats.games} · First places ${me.stats.firsts} · Won ${Number(me.stats.ebWon).toLocaleString()} EB · Lost ${Number(me.stats.ebLost).toLocaleString()} EB${me.guest ? ' · Guest account (this browser only)' : ''}</p>
    <div class="panel-title" style="margin:6px 0 0">Characters</div>
    <div class="avgrid">${chars}</div>
    <div class="panel-title" style="margin:6px 0 0">Wildlife <span class="hint" style="text-transform:none;letter-spacing:0">— ${unlockedN}/${C.avatars.animals.length} unlocked. Win ${need} tricks with an animal card to unlock its picture.</span></div>
    <div class="avgrid">${animals}</div>
    <div class="error">${esc(acct.msg)}</div>
  </div></div>`;
}
// Store: spend Eco-bucks (items are defined in accounts.js)
function storeModal() {
  const me = acct.me, C = acct.config; if (!me || !C) return '';
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
  const items = C.store.filter(it => it.type !== 'skin' && it.type !== 'chat' && it.type !== 'foil').map(it => {
    const owned = me.owned.includes(it.id), wearing = me.title === it.id;
    const action = owned
      ? (it.type === 'title' ? `<button class="btn ${wearing ? '' : 'brass'}" data-wear="${wearing ? '' : it.id}">${wearing ? 'Take off' : 'Wear title'}</button>` : '<span class="tag">Owned</span>')
      : `<button class="btn primary" data-buy="${it.id}" ${me.balance < it.price ? 'disabled' : ''}>Buy · ${Number(it.price).toLocaleString()} EB</button>`;
    return `<div class="storeitem">
      <div class="storeprev">${it.type === 'title' ? bannerHtml(Object.assign({}, me, { titleName: it.name })) : ''}</div>
      <div class="storeinfo"><b>${esc(it.name)}</b><span class="hint">${esc(it.blurb)}</span>
        <span>${fmtEB(it.price)}${owned ? ' · <span style="color:var(--native)">Owned</span>' : me.balance < it.price ? ` · <span class="hint">you need ${(it.price - me.balance).toLocaleString()} more</span>` : ''}</span></div>
      <div>${action}</div></div>`;
  }).join('');
  return `<div class="modal"><div class="paper spiral acctmodal">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">Eco-buck store</div><div class="row">Balance ${fmtEB(me.balance)}<button class="btn small" data-close>Close</button></div></div>
    <div class="storelist">${items}</div>
    <div class="panel-title" style="margin:6px 0 0">Character skins <span class="hint" style="text-transform:none;letter-spacing:0">— ${fmtEB(SKINS[0].price)} each. New looks for each character. Everyone at the table sees them.</span></div>
    <div class="skintabs">${Object.keys(ROLES).map(r => {
      const n = SKINS.filter(s => s.role === r).length, have = SKINS.filter(s => s.role === r && me.owned.includes('skin:' + s.id)).length;
      return `<button class="skintab" data-skinshop="${r}">${esc(ROLES[r].name)} <small>${have}/${n}</small></button>`;
    }).join('')}</div>
    ${chatStoreHtml(me)}
    ${foilStoreHtml(me)}
    <p class="hint" style="margin:6px 0 0">Earn Eco-bucks by finishing in the top spots at a table. You can also open a character's skins by clicking them on the home page.</p>
    <div class="error">${esc(acct.msg)}</div>
  </div></div>`;
}
// ---------- chat lines (bought in the store, sent during a game) ----------
const chatGroupName = g => CHAT_GROUP_NAMES[g] || (ROLES[g] ? ROLES[g].name : g);
const CHAT_GROUP_ORDER = [...new Set(CHAT.map(c => c.group))];
function chatDropHtml() {
  const owned = new Set(((S.myAccount && S.myAccount.owned) || []).filter(x => x.startsWith('chat:')).map(x => x.slice(5)));
  const mine = CHAT.filter(c => owned.has(c.id));
  if (!mine.length) return `<div class="paper spiral chat-drop"><div class="panel-title">Chat</div>
    <p class="hint" style="margin:0">You don't own any chat lines yet. Buy them in the <b>Store</b> on the home page or in the lobby: every line the bots say, ${CHAT[0].price} EB each.</p></div>`;
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
  return `<div class="panel-title" style="margin:6px 0 0">Chat lines <span class="hint" style="text-transform:none;letter-spacing:0">— ${CHAT[0].price} EB each. Everything the bots say. Send the lines you own from the 💬 Chat button during a game.</span></div>
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
  return `<div class="panel-title" style="margin:6px 0 0">Foil cards <span class="hint" style="text-transform:none;letter-spacing:0">— ${FOIL_PRICE} EB each. Whenever the card is dealt to you, it shines as foil (only you see it). Hover a card to read it.</span></div>
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
function skinShopModal() {
  const role = acct.modal.skins, R = ROLES[role]; if (!R) return '';
  const me = acct.me, C = acct.config;
  const skins = SKINS.filter(s => s.role === role);
  const on = mySkin(role);
  const view = acct.modal.view !== undefined ? acct.modal.view : on; // which look the big preview shows
  const viewing = skins.find(s => s.id === view);
  const owned = s => !!me && me.owned.includes('skin:' + s.id);
  const tabs = Object.keys(ROLES).map(r => `<button class="skintab ${r === role ? 'on' : ''}" data-skinshop="${r}">${esc(ROLES[r].name)}</button>`).join('');
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
  return `<div class="modal"><div class="paper spiral acctmodal skinshop">
    <div class="row" style="justify-content:space-between"><div class="panel-title" style="margin:0">${esc(R.name)} skins</div>
      <div class="row">${me ? `Balance ${fmtEB(me.balance)}` : ''}<button class="btn small" data-close>Close</button></div></div>
    <div class="skintabs">${tabs}</div>
    <div class="skinstage">
      <div class="skinprev"><canvas width="${CHAR_ANIM.w}" height="${CHAR_ANIM.h}" data-role="${role}" data-skin="${view || ''}"></canvas></div>
      <div class="skininfo">
        <h3>${esc(viewing ? viewing.name : 'The original')}</h3>
        <p>${esc(viewing ? viewing.blurb : `The ${R.name} from the role card.`)}</p>
        <p class="hint">Your skin shows in every game where you play the ${esc(R.name)}, for everyone at the table. It's only a new look; the role plays the same.</p>
        <span class="btn small" ${peekAttrs(role, view)}>Hover here to read the role card</span>
      </div>
    </div>
    <div class="skingrid">${tile(null)}${skins.map(tile).join('')}</div>
    <div class="error">${esc(acct.msg)}</div>
  </div></div>`;
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
const acctModalHtml = () => !acct.modal ? '' : acct.modal === 'profile' ? profileModal() : acct.modal.skins ? skinShopModal() : storeModal();
// clicks inside the profile / store / account panel
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-close],[data-store],[data-profile],[data-avatar],[data-buy],[data-wear],[data-skinshop],[data-skinview],[data-equip],#saveTag,#confirmBuy,#signout,#guest');
  if (!t) return;
  const run = async (fn) => { try { acct.msg = ''; await fn(); } catch (err) { acct.msg = err.message; SFX.error(); } render(); };
  if (t.matches('[data-close]')) { acct.modal = null; acct.msg = ''; render(); }
  else if (t.matches('[data-skinshop]')) {
    acct.modal = { skins: t.dataset.skinshop }; acct.msg = '';
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
  else if (t.matches('#saveTag')) run(async () => { acct.me = (await acctApi('profile', { gamertag: document.getElementById('tagInput').value })).me; showToast('Gamertag saved.'); });
  else if (t.matches('[data-buy]')) { acct.modal = { buy: t.dataset.buy }; acct.msg = ''; render(); }
  else if (t.matches('#confirmBuy')) run(async () => {
    const r = await acctApi('store/buy', { item: acct.modal.buy }); acct.me = r.me;
    acct.modal = r.item.type === 'skin' ? { skins: r.item.role, view: r.item.skin } : 'store';
    SFX.end(); showToast(r.item.type === 'skin' ? `You bought <b>${esc(r.item.name)}</b>! Equipped for the ${esc(ROLES[r.item.role].name)}.` : `You bought <b>${esc(r.item.name)}</b>!`);
  });
  else if (t.matches('[data-wear]')) run(async () => { acct.me = (await acctApi('profile', { title: t.dataset.wear || null })).me; });
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
function hidePeek() { clearTimeout(peekTimer); peekTimer = null; peekSrc = null; peekKey = null; $peek.classList.add('hidden'); }
function armPeek(el) {
  const src = el.dataset.peek, role = el.dataset.peekrole || null, skin = el.dataset.peekskin || null;
  const key = src + '|' + (skin || '');
  if (key === peekKey) return;
  hidePeek(); peekSrc = src; peekKey = key;
  peekTimer = setTimeout(() => showPeek(src, role, skin), 1000);
}
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-peek]');
  if (el) armPeek(el); else if (peekSrc) hidePeek();
});
document.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'touch') return;
  const el = e.target.closest('[data-peek]');
  if (el) armPeek(el);
});
document.addEventListener('pointerup', e => { if (e.pointerType === 'touch') hidePeek(); });
document.addEventListener('pointercancel', hidePeek);
document.addEventListener('contextmenu', e => { if (e.target.closest('[data-peek]')) e.preventDefault(); });
document.addEventListener('click', e => {
  if (ui.showLog && S && !e.target.closest('.notes-wrap')) { ui.showLog = false; render(); }
  if (ui.showChat && S && !e.target.closest('.chat-wrap')) { ui.showChat = false; render(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hidePeek(); if (ui.confirm) { ui.confirm = null; render(); } if (ui.showLog) { ui.showLog = false; render(); } if (ui.showChat) { ui.showChat = false; render(); } if (ui.showRules) { ui.showRules = false; render(); } } });

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
  if (!S || S.phase === 'lobby') { ui.lastRound = null; return; }
  if (S.waiting !== S.you || (S.step && ui.mode)) ui.mode = null;
  // phones: scroll to the map when you must click it, or to the play area when you must pick a biome or role
  if (prev && S.waiting === S.you && S.phase !== 'ended') {
    const stepNow = S.step && S.step.type, stepBefore = prev.step && prev.waiting === S.you && prev.step.type;
    const mapStep = stepNow === 'place' || stepNow === 'predate' || (stepNow === 'dis' && ['remove', 'dest', 'scatter'].includes(S.step.mode));
    if (mapStep && (stepNow !== stepBefore || (stepNow === 'dis' && prev.step.mode !== S.step.mode))) ui.scrollTo = 'board';
    else if (prev.waiting !== S.you && (S.phase === 'choose' || S.phase === 'draft')) ui.scrollTo = 'table';
  }
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
  renderScreen();
  updateMusic();
}
function renderScreen() {
  // home page, loading screen and lobby sit on the animated backdrop (scenery.js)
  const scenic = !sess || !S || S.phase === 'lobby';
  document.body.classList.toggle('scenic', scenic);
  if (!scenic) setSceneOnly(false); // a game starting always brings the screen back
  if (!sess) return renderLanding();
  if (!S) { $app.innerHTML = `<div class="landing">${musicBtnHtml()}<div class="paper spiral landing-card"><p class="tagline">Paddling out to the Everglades…</p></div></div>`; return; }
  if (S.phase === 'lobby') return renderLobby();
  renderGame();
}

function renderLanding() {
  const qRoom = new URLSearchParams(location.search).get('room') || '';
  // the six characters, gently idling (CSS steps through each one's idle strip), in the skins you have on.
  // Click one to open its skin shop.
  const cast = Object.keys(ROLES).map((r, i) => `<button class="castmember" data-skinshop="${r}" title="${esc(ROLES[r].name)} skins">
      <div class="pthumb idle" style="background-image:url('${CHAR_ANIM.src(r, 'idle', mySkin(r))}');animation-delay:-${(i * 0.83).toFixed(2)}s"></div>
      <span class="castname">${esc(ROLES[r].name)}</span><span class="castshop">Skins</span></button>`).join('');
  $app.innerHTML = `
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
      <div class="divider">— or join friends —</div>
      <div class="row" style="flex-wrap:nowrap">
        <input id="code" class="field" maxlength="4" placeholder="CODE" value="${esc(qRoom)}" style="text-transform:uppercase;letter-spacing:4px;width:150px">
        <button id="join" class="btn brass" style="flex:1" ${acct.me ? '' : 'disabled'}>Join table</button>
      </div>
      <div class="error">${esc(ui.err)}</div>
      <p class="hint" style="margin:0">Every table has an Eco-buck buy-in. Start a table and share its 4-letter code or link. Bots fill empty seats, so every game has at least 4 players.</p>
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
      ${C.googleClientId ? '<div id="gbtn" class="gbtn"></div>' : ''}
      ${C.guestsAllowed !== false ? `<button id="guest" class="btn">${C.googleClientId ? 'Play as a guest instead' : 'Play as guest'}</button>` : ''}
      ${!C.googleClientId ? '<span class="hint" style="margin:0;font-size:16px">(Google sign-in isn’t set up on this server yet. Guest accounts are saved in this browser.)</span>' : ''}
    </div>`;
  const me = acct.me;
  return `<div class="acctbox">
    ${bannerHtml(me, { extra: `<div class="pb-bal">${fmtEB(me.balance)}</div>` })}
    <div class="row" style="gap:6px"><button class="btn small" data-profile>Profile</button><button class="btn small brass" data-store>Store</button><button class="btn small" id="signout">Sign out</button></div>
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
  $app.innerHTML = `
  <div class="landing">
    ${musicBtnHtml()}
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
        <div><div class="panel-title" style="margin:0">Match modifiers</div>
          <span style="font-size:18px">Disruptions: <b>${S.disruptions ? 'On' : 'Off'}</b></span>
          <span class="hint">— each player drafts 2 Disruption cards and may play one face down after the biome is chosen</span></div>
        ${S.isHost ? `<div class="modepick"><button class="btn small ${S.disruptions ? 'brass' : ''}" data-dis="1">On</button><button class="btn small ${S.disruptions ? '' : 'brass'}" data-dis="0">Off</button></div>` : ''}
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
            <span style="font-size:18px">${fmtEB(S.buyIn)} per player</span> <span class="hint">· pot ${fmtEB(S.buyIn * tableSize)} with ${tableSize} seats</span></div>
          ${S.isHost ? `<div class="modepick">${S.buyIns.map(b => `<button class="btn small ${S.buyIn === b ? 'brass' : ''}" data-buyin="${b}">${b} EB</button>`).join('')}</div>` : ''}
        </div>
        <p class="hint" style="margin:2px 0 0">${S.mode === 'coop'
          ? 'Co-op: beat the Anaconda and everyone gets double their bet back. Lose, and everyone loses it.'
          : `1st takes the rest of the pot · 2nd gets their bet back · 3rd gets half back · ${tableSize >= 5 ? 'everyone below loses' : '4th loses'} their bet. The house covers the bots.`}</p>
        ${S.myAccount ? `<p class="hint" style="margin:2px 0 0">Your balance: ${fmtEB(S.myAccount.balance)}${S.myAccount.balance < S.buyIn ? ' — <b style="color:var(--red)">not enough for this buy-in</b>' : ''}</p>` : ''}
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
            ${m.host ? '<span class="tag host">HOST</span>' : ''}${m.bot ? '<span class="tag bot">BOT</span>' : ''}
            ${S.isHost && m.pid !== S.yourPid ? `<button class="btn small" data-remove="${m.pid}">✕</button>` : ''}
          </div>`).join('')}
      </div>
      ${S.isHost ? `
        <div class="row">
          <button id="addbot" class="btn small" ${S.lobby.length >= 6 ? 'disabled' : ''}>+ Add bot</button>
          <span class="hint">${bots ? `${bots} bot${bots > 1 ? 's' : ''} will join when you start, to make ${tableSize} players.` : 'Ready when you are.'}</span>
        </div>
        <button id="start" class="btn primary" ${S.lobby.some(m => !m.bot && !m.canAfford) ? 'disabled title="Everyone needs enough Eco-bucks for the buy-in"' : ''}>Start game · ${S.buyIn} EB buy-in</button>`
      : `<p class="hint">Waiting for the host to start… ${humans} player${humans > 1 ? 's' : ''} here.</p>`}
      <div class="row"><button id="leave" class="btn small">Leave table</button>${acct.me ? '<button class="btn small" data-profile>Profile</button><button class="btn small brass" data-store>Store</button>' : ''}</div>
    </div>
    ${acctModalHtml()}
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
    $app.querySelectorAll('[data-dis]').forEach(b => b.onclick = () => lobby('disruptions', { on: b.dataset.dis === '1' }));
    $app.querySelectorAll('[data-buyin]').forEach(b => b.onclick = () => lobby('buyin', { amount: +b.dataset.buyin }));
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
const disBack = (who = '') => `<div class="card eco dis facedown"><img src="assets/cards/disruption/back.png" alt="Face-down Disruption">${who ? `<div class="who">${esc(who)}</div>` : ''}</div>`;
// Foil cards: shown shiny only to the player who owns the foil, for cards dealt to them.
function ownsFoil(id) {
  const owned = (S && S.myAccount && S.myAccount.owned) || (acct.me && acct.me.owned) || [];
  return owned.includes('foil:' + id);
}
const foil = id => ownsFoil(id) ? 'foil' : '';
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
    if (p.boss) return `<div class="pl boss ${S.waiting === i ? 'turn' : ''}" data-seat="${i}" data-peek="${BOSS.img}">${portraitHtml(i, p)}
      <div class="info">
        <div class="nm">${arrow}<span class="name">${esc(p.name)}</span><span class="tag bosstag">BOSS</span></div>
        ${mini ? `<div class="mini-meta">Deck ${p.handCount} · ${p.tricks} won</div>` : `<div class="meta"><span>Invasive deck ${p.handCount}</span></div><div class="meta"><span>Tricks ${p.tricks}</span></div>`}
      </div></div>`;
    return `<div class="pl ${S.waiting === i ? 'turn' : ''}" data-seat="${i}" ${role ? peekAttrs(p.role, p.skin) : ''}>${portraitHtml(i, p)}
      <div class="info">
        <div class="nm">${arrow}<span class="name">${esc(p.name)}</span>${i === S.you ? '<span class="you">(you)</span>' : ''}${p.online ? '' : '<span class="dot off" title="offline"></span>'}</div>
        ${mini ? `<div class="mini-meta">${role ? esc(role.name) : 'choosing…'} · ${p.tricks} won</div>` : `<div class="meta">${role ? `<span class="rolename">${esc(role.name)}</span>` : '<span>choosing role…</span>'}${teamTag(p.team)}</div>
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
    const skin = tableSkin(r); // taken: the holder's skin; still free: yours
    return `<div class="rolepick ${pick ? 'choosable' : ''} ${free ? '' : 'taken'}" ${peekAttrs(r, skin)} ${pick ? `data-role="${r}"` : ''}>
      ${roleCardHtml(r, skin)}
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

// Disruption draft: pick 1 card from your pack; the rest pass clockwise.
function ddraftHtml() {
  const D = S.ddraft;
  const waitingNames = D.waiting.map(p => S.players[p].name);
  const canPick = S.you >= 0 && !D.picked && D.pack.length;
  return `<div class="tabletop draft"><div class="players-mini">${playersHtml(true)}</div>
    <h3>${canPick ? `▶ Disruption draft — pick ${D.round === 0 ? 'your first' : 'your second'} card` : `Waiting for ${esc(waitingNames.join(', ') || '…')}…`}
      <span style="color:var(--blush)">(the rest pass clockwise)</span></h3>
    <div class="rolegrid ${canPick ? 'choosing' : ''}">${D.pack.map(id => disEl(id, `${canPick ? 'choosable' : ''} ${D.picked === id ? 'sel' : ''} ${foil(id)}`, canPick ? `data-ddraft="${id}"` : '')).join('')}</div>
    ${S.dis.length ? `<div class="strip"><h3>Your Disruptions</h3><div class="strip-cards">${S.dis.map(id => disEl(id, foil(id))).join('')}</div></div>` : ''}
  </div>`;
}
// Revealed Disruptions this round (or face-down markers while players are still deciding), plus active effects.
function disRowHtml() {
  const T = S.trick; if (!T || !S.disruptions) return '';
  let cards = '';
  if (S.phase === 'disrupt' && S.dcommit) {
    // still deciding: show who has committed something face down (not what)
    cards = S.dcommit.committed.map(i => i === S.you
      ? disEl(S.dcommit.mine, foil(S.dcommit.mine), '', 'You (face down)') : disBack(S.players[i].name)).join('');
    cards = cards || '<span class="lastline" style="color:var(--blush)">No Disruptions committed yet.</span>';
  } else if (T.dis.length) {
    cards = T.dis.map(d => disEl(d.card, d.p === S.you ? foil(d.card) : '', '', S.players[d.p].name)).join('');
  } else return '';
  const fx = [];
  if (T.protest) fx.push('Risk 0 (Ecological Protest)');
  if (T.blocked) fx.push('No tokens can be placed here (Land Development)');
  if (T.doubleNative) fx.push('Native tokens played here are doubled');
  for (const p of T.bribes || []) fx.push(`${esc(S.players[p].name)}: Risk +5 (Take Bribes)`);
  for (const p of T.docu || []) fx.push(`${esc(S.players[p].name)}: Natives +5 Impact`);
  if (T.seq && S.phase === 'play') { const last = T.seq[T.seq.length - 1]; if ((T.dis || []).some(d => d.card === 'ChangingSeasons' && d.p === last)) fx.push(`${esc(S.players[last].name)} plays last`); }
  return `<div class="strip disrow"><h3>Disruptions this round</h3><div class="strip-cards">${cards}</div>${fx.length ? `<div class="disfx">${fx.map(f => `<span>${f}</span>`).join('')}</div>` : ''}</div>`;
}

function tableHtml() {
  if (S.phase === 'draft') return draftHtml();
  if (S.phase === 'ddraft' && S.ddraft) return ddraftHtml();
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
    const guide = pickNow && S.guide && S.guide.p === S.you && S.guide.options.length ? S.guide.options : null; // Traveler's Guidebook
    return `<div class="tabletop choose"><div class="players-mini">${playersHtml(true)}</div>
      <div class="row" style="justify-content:space-between;flex-wrap:nowrap">
        <h3>${pickNow ? '▶ Choose where to travel' : `${esc(S.players[S.leader].name)} is choosing where to travel…`}</h3>${deck}
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
  return `<div class="tabletop play"><div class="players-mini">${playersHtml(true)}</div>
    <h3>Round ${S.round} — ${S.phase === 'disrupt' ? 'Disruption phase' : 'exploring'}</h3>
    <div class="cur-row">
      ${biomeEl(S.trick.biome)}
      <div class="tt-info">
        <div class="place">${esc(b.name)}<br><span style="color:var(--blush)">${esc(REGIONS[b.region].name)}</span></div>
        <span class="suitbadge suit-${suit}">${suit}</span>${suitChanged ? `<span style="font-size:13px;color:var(--blush)">(was ${b.suit})</span>` : ''}
        <span class="risk">Risk <b>${S.trick.risk}</b>${changed ? `<span style="font-size:13px;color:var(--ink-soft)">(was ${b.risk})</span>` : ''}${myRisk !== null ? `<span style="font-size:13px;color:var(--ink-soft)"> · ${myRisk} for your cards</span>` : ''}</span>
        ${S.trick.keystones ? `<span class="hint" style="color:var(--blush)">Keystone: each Native token here lowers the Risk${S.trick.keystones > 1 ? ` (×${S.trick.keystones})` : ''}</span>` : ''}
      </div>
    </div>
    ${disRowHtml()}
    <div class="played" style="--n:${S.trick.seq ? S.trick.seq.length : n}">${S.trick.plays.length ? S.trick.plays.map(pl => cardEl(pl.card, pl.p === S.you ? foil(pl.card) : '', '', S.players[pl.p].boss ? 'Anaconda' : S.players[pl.p].name)).join('') : '<span class="lastline" style="color:var(--blush)">No cards played yet.</span>'}</div>
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
    return `<div class="slot" style="--i:${hand.indexOf(id)}">${cardEl(id, `${cls} ${ui.sel === id ? 'sel' : ''} ${foil(id)}`, `data-hand="${id}"`, '', badge)}</div>`;
  }).join('') || '<span class="hint" style="color:var(--blush)">No cards in hand.</span>';
  const role = S.role ? ROLES[S.role] : null;
  // keep sideways scroll positions (hand, players strip) across re-renders
  const keepScroll = {};
  for (const sel of ['.hand', '.players-mini']) { const el = [...$app.querySelectorAll(sel)].find(e => e.offsetParent); if (el) keepScroll[sel] = el.scrollLeft; }

  $app.innerHTML = `
  <div class="topbar">
    <span class="logo-sm">EVERGLADES</span>
    <span class="chip">Room ${S.room}</span>
    ${S.phase === 'draft' ? '<span class="chip">Role draft</span>' : S.phase !== 'ended' ? `<span class="chip">Round ${S.round}</span>` : ''}
    ${S.partners ? '<span class="chip">Partners</span>' : ''}${S.coop ? '<span class="chip" style="background:#f2d7c9">Co-op vs The Anaconda</span>' : ''}
    <span class="spacer"></span>
    ${S.you >= 0 ? `<div class="chat-wrap">
      <button class="btn small ${ui.showChat ? 'brass' : ''}" id="chatBtn" title="Send a chat line to the table">💬 Chat ▾</button>
      ${ui.showChat ? chatDropHtml() : ''}
    </div>` : ''}
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
      <div class="hand-cap">${role ? `<span class="myrole" ${peekAttrs(S.role, tableSkin(S.role))}>You are the <b>${esc(role.name)}</b> <small>(hold to read)</small></span>` : ''}<span class="swipe">${hand.length} card${hand.length === 1 ? '' : 's'} · swipe ↔ · hold a card to read it</span></div>
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
  ${S.phase === 'ended' && !holding() ? endModal() : ''}`;

  if (peekSrc && !document.querySelector(`[data-peek="${CSS.escape(peekSrc)}"]`)) hidePeek();
  const logEl = document.getElementById('log'); if (logEl) logEl.scrollTop = logEl.scrollHeight;
  wire();
  drawPortraits(true);
  for (const [sel, x] of Object.entries(keepScroll)) { const el = [...$app.querySelectorAll(sel)].find(e => e.offsetParent); if (el) el.scrollLeft = x; }
  if (isPhone()) {
    // the hand bar is pinned to the bottom of the screen: leave room for it under the page
    const ha = $app.querySelector('.handarea');
    if (ha) document.documentElement.style.setProperty('--handH', ha.offsetHeight + 'px');
    // when it's your move, bring the part of the screen you need into view
    if (ui.scrollTo) {
      const el = $app.querySelector(ui.scrollTo === 'board' ? '.boardwrap' : '.tablecol');
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: ui.scrollTo === 'board' ? 'center' : 'start' }), 80);
    }
  }
  ui.scrollTo = null;
  placeBubbles();
}
// phone layout (matches the phone media query in style.css)
const phoneMQ = matchMedia('(max-width: 760px), (max-height: 520px) and (max-width: 1000px)');
const isPhone = () => phoneMQ.matches;
phoneMQ.addEventListener?.('change', () => { if (S && S.phase !== 'lobby') render(); });
addEventListener('scroll', () => { if (Object.keys(ui.bubbles).length) placeBubbles(); }, { passive: true });

function promptHtml() {
  const myTurn = isMine();
  const w = S.waiting >= 0 ? S.players[S.waiting] : null;
  if (holding()) {
    const lt = S.lastTrick;
    return `<div class="paper spiral prompt"><div class="msg">${esc(S.players[lt.winner].name)} wins the trick!<small>${S.phase === 'ended' ? 'Final scores coming up…' : 'Next round in a moment…'}</small></div></div>`;
  }
  if (S.phase === 'ended') return `<div class="paper spiral prompt"><div class="msg">Game over!</div></div>`;
  const yours = (msg, buttons = '') => `<div class="paper spiral prompt yours"><div class="msg">${msg}</div>${buttons}</div>`;
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
    return `<div class="paper spiral prompt"><div class="msg">Waiting for ${esc(w ? w.name : '…')} ${what}…<small>${isPhone() ? 'Press and hold any card or player' : 'Hover any card'} for a second to read it.</small></div></div>`;
  }
  const box = (msg, buttons = '') => `<div class="paper spiral prompt yours"><div class="msg">${msg}</div>${buttons}</div>`;
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
  if (sel && S.role === 'Conservationist' && sel.kind === 'Invasive') {
    buttons += `<button class="btn primary" id="play">Play &amp; populate</button><button class="btn" id="playNoPop">Don't populate</button>`;
  } else {
    buttons += `<button class="btn primary" id="play" ${sel ? '' : 'disabled'}>${sel ? 'Play ' + esc(sel.name) : 'Play card'}</button>`;
  }
  return box(`Your turn — pick a card to play.<small>${follow}${S.abilityUsed ? ' Ability used.' : ''}</small>`, buttons);
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

// Eco-buck payouts for a finished game (accounts.js settle)
function settlementHtml() {
  const st = S.settlement; if (!st) return '';
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
  q('#notesBtn', () => { ui.showLog = !ui.showLog; ui.showChat = false; ui.unread = 0; render(); });
  q('#chatBtn', () => { ui.showChat = !ui.showChat; ui.showLog = false; render(); });
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
  // Disruptions
  q('[data-ddraft]', el => { hidePeek(); act({ type: 'draftDis', card: el.dataset.ddraft }); });
  q('[data-commit]', el => { hidePeek(); act({ type: 'commitDis', card: el.dataset.commit || null }); });
  q('[data-dpick]', el => { const [region, kind] = el.dataset.dpick.split(':'); act({ type: 'dRemove', region, kind }); });
  $app.querySelectorAll('[data-ddest]').forEach(el => el.addEventListener('click', () => act({ type: 'dDest', region: el.dataset.ddest })));
  $app.querySelectorAll('[data-dscatter]').forEach(el => el.addEventListener('click', () => act({ type: 'dScatter', region: el.dataset.dscatter, kind: ui.scatterKind || 'n' })));
  q('[data-skind]', el => { ui.scatterKind = el.dataset.skind; render(); });
  q('#dDone', () => { ui.stealFrom = null; act({ type: 'dDone' }); });
  q('[data-stealfrom]', el => { ui.stealFrom = +el.dataset.stealfrom; render(); });
  q('#stealBack', () => { ui.stealFrom = null; render(); });
  q('[data-steal]', el => { const from = ui.stealFrom; ui.stealFrom = null; hidePeek(); act({ type: 'dSteal', from, card: el.dataset.steal }); });
  q('[data-tour]', el => act({ type: 'tourDecide', bottom: el.dataset.tour === '1' }));
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
    if (S.role === 'LandDeveloper') { ui.mode = 'landdev'; ui.scrollTo = 'board'; return render(); }
    ui.mode = 'swap'; ui.swapHand = ui.swapPile = null; render();
  });
}

connect();
render();
initAccounts();
