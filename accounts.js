// Everglades — player accounts, Eco-bucks (EB), profile pictures and the store.
// Uses only what ships with Node.
//
// Storage: see storage.js. Locally the data is a JSON file; when hosting, set the Upstash variables
// so accounts survive restarts and redeploys (see README).
'use strict';
const path = require('path');
const crypto = require('crypto');
const { CARDS, ROLES, SKINS, CHAT } = require('./public/data.js');

// ---------- economy settings (change freely) ----------
const ECON = {
  startingBalance: 50,         // EB every new account starts with
  dailyBonus: 50,              // EB for the first sign-in or visit of each day (UTC calendar day)
  buyIns: [5, 50, 150, 500],   // lobby buy-in options
  unlockWins: 5,               // tricks won with an animal card to unlock its profile picture
};

// ---------- the store (add items here) ----------
// type 'title': shown under the player's name in their banner.
// type 'skin': an alternate look for one character (defined in SKINS in public/data.js, bought from that
//   character's skin shop on the home page). Everyone at the table sees it when you play that character.
const STORE = [
  { id: 'title_savior', type: 'title', name: 'Savior of the Everglades', price: 10000,
    blurb: 'A legendary title that sparkles under your name.' },
  ...SKINS.map(s => ({ id: 'skin:' + s.id, type: 'skin', role: s.role, skin: s.id, name: s.name, price: s.price, blurb: s.blurb })),
  // type 'chat': a preset line the player can send as a speech bubble during a game (CHAT in public/data.js)
  ...CHAT.map(c => ({ id: 'chat:' + c.id, type: 'chat', group: c.group, name: c.text, price: c.price, blurb: 'Chat line' })),
];
const ownsChat = (a, id) => !!a && a.owned.includes('chat:' + id);

// ---------- profile pictures ----------
const CHARACTER_AVATARS = ['Conservationist', 'Fisherman', 'Hunter', 'LandDeveloper', 'Researcher', 'Tourist', 'Anaconda'];
const ANIMAL_AVATARS = Object.values(CARDS).filter(c => c.taxon !== 'Plant').map(c => c.id);
const avatarSrc = id => {
  const [kind, name] = String(id).split(':');
  return kind === 'animal' ? `assets/avatars/animal_${name}.png` : `assets/avatars/char_${name}.png`;
};

// ---------- storage (see storage.js: Upstash Redis when configured, otherwise a local file) ----------
const TABLES = ['accounts', 'sessions', 'google', 'guests', 'tags', 'escrows'];
const store = require('./storage.js').pickStore();
let db = Object.fromEntries(TABLES.map(t => [t, {}]));
// Load everything before the server lets anyone in (server.js waits for `ready`).
const ready = (async () => {
  let data = await store.load(TABLES);
  if (!data && !store.name.startsWith('file')) {
    // first boot on Upstash: bring over any accounts saved in a local file before the switch
    const local = await require('./storage.js').fileStore(process.env.DATA_DIR || path.join(__dirname, 'data')).load();
    if (local) { data = local; console.log('  Copied existing local accounts to Upstash.'); setTimeout(saveNow, 0); }
  }
  if (data) for (const t of TABLES) db[t] = Object.assign({}, data[t]);
  console.log(`  Accounts: ${Object.keys(db.accounts).length} loaded from ${store.name}`);
})();
let saveTimer = null, saving = null, again = false;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 1500); } // batch quick changes together
function saveNow() { // never two saves at once; a failed save is retried
  clearTimeout(saveTimer); saveTimer = null;
  if (saving) { again = true; return saving; }
  saving = (async () => {
    try { await store.save(db); }
    catch (e) { console.error('Could not save accounts (will retry):', e.message); setTimeout(save, 5000); }
    saving = null;
    if (again) { again = false; return saveNow(); }
  })();
  return saving;
}
// Wait until everything is safely stored (used before the server shuts down).
async function flush() { if (saveTimer) saveNow(); while (saving) await saving; }
const rid = (n = 18) => crypto.randomBytes(n).toString('hex');
const userErr = msg => Object.assign(new Error(msg), { userError: true });

// ---------- accounts ----------
function newAccount(extra) {
  const id = rid(8);
  let tag; do { tag = 'Ranger' + Math.floor(1000 + Math.random() * 9000); } while (db.tags[tag.toLowerCase()]);
  const a = {
    id, gamertag: tag, avatar: 'char:' + CHARACTER_AVATARS[Math.floor(Math.random() * 6)],
    balance: ECON.startingBalance, owned: [], title: null, cardWins: {}, skins: {},
    stats: { games: 0, firsts: 0, ebWon: 0, ebLost: 0 }, created: Date.now(),
    lastBonusDay: today(), // a new account's first day is covered by its starting balance
  };
  Object.assign(a, extra);
  db.accounts[id] = a; db.tags[tag.toLowerCase()] = id;
  return a;
}
function newSession(a) { const t = rid(); db.sessions[t] = a.id; save(); return t; }
function bySession(token) {
  const id = token && db.sessions[token];
  return id ? db.accounts[id] || null : null;
}
function requireAccount(token) {
  const a = bySession(token);
  if (!a) throw Object.assign(userErr('Please sign in first.'), { needAuth: true });
  return a;
}
function signOut(token) { delete db.sessions[token]; save(); }

// Guest accounts: one per browser (the browser keeps a secret device key). Handy for local play;
// set ALLOW_GUEST_ACCOUNTS=0 once Google sign-in is set up if you want Google-only accounts.
const guestsAllowed = () => process.env.ALLOW_GUEST_ACCOUNTS !== '0';
function guestLogin(deviceKey) {
  if (!guestsAllowed()) throw userErr('Guest accounts are turned off. Please sign in with Google.');
  if (!/^[a-f0-9]{32,64}$/.test(String(deviceKey || ''))) throw userErr('Bad device key.');
  const k = crypto.createHash('sha256').update(deviceKey).digest('hex');
  let a = db.accounts[db.guests[k]];
  if (!a) { a = newAccount({ guest: true }); db.guests[k] = a.id; }
  return { account: a, session: newSession(a) };
}

// ---------- Google sign-in (verifies the ID token Google gives the browser; no libraries) ----------
const GOOGLE_CLIENT_ID = () => process.env.GOOGLE_CLIENT_ID || '';
let jwks = { keys: [], until: 0 };
async function googleKeys() {
  if (Date.now() < jwks.until && jwks.keys.length) return jwks.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw userErr('Could not reach Google to check your sign-in. Try again.');
  const body = await r.json();
  const age = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  jwks = { keys: body.keys || [], until: Date.now() + (age ? +age[1] * 1000 : 3600e3) };
  return jwks.keys;
}
const b64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
async function verifyGoogle(credential) {
  const cid = GOOGLE_CLIENT_ID();
  if (!cid) throw userErr('Google sign-in is not set up on this server yet.');
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw userErr('That Google sign-in did not look right.');
  const header = JSON.parse(b64url(parts[0]).toString('utf8'));
  const claims = JSON.parse(b64url(parts[1]).toString('utf8'));
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw userErr('That Google sign-in could not be checked.');
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey({ key: jwk, format: 'jwk' }), b64url(parts[2]));
  if (!ok) throw userErr('That Google sign-in could not be verified.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) throw userErr('That sign-in did not come from Google.');
  if (claims.aud !== cid) throw userErr('That Google sign-in was meant for a different site.');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw userErr('That Google sign-in has expired. Please try again.');
  return claims; // only claims.sub (Google's stable user id) is stored, nothing else
}
async function googleLogin(credential) {
  const claims = await verifyGoogle(credential);
  let a = db.accounts[db.google[claims.sub]];
  if (!a) { a = newAccount({ google: true }); db.google[claims.sub] = a.id; }
  return { account: a, session: newSession(a) };
}

// ---------- profile ----------
function unlockedAvatars(a) {
  return [...CHARACTER_AVATARS.map(c => 'char:' + c),
    ...ANIMAL_AVATARS.filter(id => (a.cardWins[id] || 0) >= ECON.unlockWins).map(id => 'animal:' + id)];
}
// skin: { role, id } equips skin `id` for that character; id null goes back to the original look.
function setProfile(a, { gamertag, avatar, title, skin }) {
  if (skin !== undefined) {
    const role = skin && skin.role, id = skin && skin.id;
    if (!ROLES[role]) throw userErr('That character does not exist.');
    if (id !== null && id !== undefined) {
      if (!SKINS.some(s => s.id === id && s.role === role)) throw userErr('That skin does not exist.');
      if (!a.owned.includes('skin:' + id)) throw userErr("You don't own that skin yet.");
    }
    a.skins = Object.assign({}, a.skins);
    if (id) a.skins[role] = id; else delete a.skins[role];
  }
  if (gamertag !== undefined) {
    const t = String(gamertag).trim();
    if (!/^[A-Za-z0-9_ .-]{3,16}$/.test(t)) throw userErr('Gamertags are 3–16 letters, numbers, spaces, dots, dashes or underscores.');
    const owner = db.tags[t.toLowerCase()];
    if (owner && owner !== a.id) throw userErr('That gamertag is taken.');
    delete db.tags[a.gamertag.toLowerCase()];
    a.gamertag = t; db.tags[t.toLowerCase()] = a.id;
  }
  if (avatar !== undefined) {
    if (!unlockedAvatars(a).includes(avatar)) throw userErr('That profile picture is still locked.');
    a.avatar = avatar;
  }
  if (title !== undefined) {
    if (title !== null && !a.owned.includes(title)) throw userErr("You don't own that title yet.");
    a.title = title;
  }
  save();
  return a;
}
// Daily log-in bonus: paid once per calendar day (UTC), the first time the player signs in or visits.
function today() { return new Date().toISOString().slice(0, 10); }
function dailyBonus(a) {
  if (a.lastBonusDay === today()) return 0;
  a.lastBonusDay = today();
  a.balance += ECON.dailyBonus; save();
  return ECON.dailyBonus;
}

// ---------- store ----------
function buy(a, itemId) {
  const item = STORE.find(i => i.id === itemId);
  if (!item) throw userErr('That item is not in the store.');
  if (a.owned.includes(item.id)) throw userErr('You already own that.');
  if (a.balance < item.price) throw userErr(`You need ${item.price.toLocaleString()} EB for that.`);
  a.balance -= item.price; a.owned.push(item.id);
  if (item.type === 'title' && !a.title) a.title = item.id; // wear it straight away
  if (item.type === 'skin') a.skins = Object.assign({}, a.skins, { [item.role]: item.skin }); // equip it straight away
  save();
  return item;
}
const titleName = id => (STORE.find(i => i.id === id) || {}).name || null;

// ---------- buy-ins (escrow) and payouts ----------
// The buy-in is taken from every player when the game starts and held in escrow until it is settled.
// If the server restarts mid-game, unsettled escrows are refunded on the next start.
function takeBuyIns(gameId, accountIds, amount) {
  const accts = accountIds.map(id => db.accounts[id]);
  const short = accts.filter(a => !a || a.balance < amount);
  if (short.length) throw userErr(`${short.map(a => a ? a.gamertag : 'A player').join(', ')} can't cover the ${amount} EB buy-in.`);
  for (const a of accts) a.balance -= amount;
  db.escrows[gameId] = { amount, accounts: accountIds.slice(), at: Date.now() };
  saveNow();
}
function refundEscrow(gameId) {
  const e = db.escrows[gameId]; if (!e) return;
  for (const id of e.accounts) if (db.accounts[id]) db.accounts[id].balance += e.amount;
  delete db.escrows[gameId]; save();
}
function refundAllEscrows() {
  const ids = Object.keys(db.escrows);
  for (const g of ids) refundEscrow(g);
  if (ids.length) console.log(`  Refunded ${ids.length} unfinished game buy-in(s).`);
}

// Pay out a finished game. ranked: [{ seat, accountId|null, score, team }] for every seat (bots included).
// Rule: last place(s) lose their bet, 3rd gets half back, 2nd gets it all back, 1st takes the rest of the pot.
// Every seat antes (the house covers bots, and keeps whatever a bot would win). Tied players share their places.
function payouts(n, bet) {
  const half = Math.floor(bet / 2);
  const p = new Array(n).fill(0);
  p[1] = bet; if (n >= 4) p[2] = half; // with 3 or fewer seats there is no "half back" place
  p[0] = bet * n - p.slice(1).reduce((x, y) => x + y, 0);
  return p;
}
function settle(gameId, ranked, opts = {}) {
  const e = db.escrows[gameId];
  if (!e) return null;
  const bet = e.amount, n = ranked.length;
  const out = ranked.map(r => ({ seat: r.seat, accountId: r.accountId, place: 0, payout: 0 }));
  if (opts.coop) {
    // co-op: everyone wins or loses together. A win pays each player double their bet.
    for (const o of out) { o.place = opts.playersWin ? 1 : 2; o.payout = opts.playersWin ? bet * 2 : 0; }
  } else {
    const P = payouts(n, bet);
    const order = ranked.map((r, i) => i).sort((x, y) => ranked[y].score - ranked[x].score);
    for (let k = 0; k < n;) { // groups of tied scores share the payouts of the places they occupy
      let m = k; while (m + 1 < n && ranked[order[m + 1]].score === ranked[order[k]].score) m++;
      const share = P.slice(k, m + 1).reduce((x, y) => x + y, 0) / (m - k + 1);
      for (let j = k; j <= m; j++) { out[order[j]].place = k + 1; out[order[j]].payout = Math.floor(share); }
      k = m + 1;
    }
  }
  for (const o of out) {
    const a = o.accountId && db.accounts[o.accountId];
    o.net = o.payout - bet;
    if (!a || !e.accounts.includes(a.id)) continue; // bots: the house
    a.balance += o.payout;
    a.stats.games++; if (o.place === 1) a.stats.firsts++;
    if (o.net > 0) a.stats.ebWon += o.net; else a.stats.ebLost -= o.net;
    o.balance = a.balance;
  }
  delete db.escrows[gameId]; saveNow();
  return { bet, pot: bet * n, results: out };
}

// Tricks won with an animal card count toward unlocking that animal's profile picture.
function recordCardWin(accountId, cardId) {
  const a = db.accounts[accountId];
  if (!a || !ANIMAL_AVATARS.includes(cardId)) return null;
  a.cardWins[cardId] = (a.cardWins[cardId] || 0) + 1; save();
  return a.cardWins[cardId] === ECON.unlockWins ? cardId : null; // newly unlocked
}

// ---------- what the browser sees ----------
// The skin this account shows for a character (null = the original look). Only owned skins count.
function skinFor(a, role) {
  const id = a && a.skins && a.skins[role];
  return id && a.owned.includes('skin:' + id) ? id : null;
}
function publicProfile(a) { // shown to everyone (lobby banner)
  return { id: a.id, gamertag: a.gamertag, avatar: a.avatar, avatarSrc: avatarSrc(a.avatar), title: a.title, titleName: titleName(a.title),
    skins: Object.fromEntries(Object.keys(ROLES).map(r => [r, skinFor(a, r)]).filter(x => x[1])) };
}
function privateProfile(a) { // shown to the account owner
  return Object.assign(publicProfile(a), {
    balance: a.balance, owned: a.owned, cardWins: a.cardWins, stats: a.stats, guest: !!a.guest,
    unlocked: unlockedAvatars(a),
  });
}
function config() {
  return { googleClientId: GOOGLE_CLIENT_ID(), guestsAllowed: guestsAllowed(), econ: ECON, store: STORE,
    avatars: { characters: CHARACTER_AVATARS.map(c => ({ id: 'char:' + c, src: avatarSrc('char:' + c) })),
      animals: ANIMAL_AVATARS.map(id => ({ id: 'animal:' + id, card: id, name: CARDS[id].name, src: avatarSrc('animal:' + id) })) } };
}
const get = id => db.accounts[id] || null;

module.exports = {
  ECON, STORE, ready, flush, saveNow, storeName: () => store.name, get, bySession, requireAccount, signOut, guestLogin, googleLogin,
  setProfile, dailyBonus, buy, takeBuyIns, refundEscrow, refundAllEscrows, settle, payouts, recordCardWin,
  publicProfile, privateProfile, config, avatarSrc, titleName, skinFor, ownsChat,
};
