// Everglades — player accounts, Eco-bucks (EB), profile pictures and the store.
// Uses only what ships with Node.
//
// Storage: see storage.js. Locally the data is a JSON file; when hosting, set the Upstash variables
// so accounts survive restarts and redeploys (see README).
'use strict';
const path = require('path');
const crypto = require('crypto');
const { CARDS, ROLES, SKINS, CHAT, DISRUPTIONS, FOIL_PRICE, SPLASHES, TREATMENTS, CHAT_SLOTS } = require('./public/data.js');

// ---------- economy settings (change freely) ----------
const ECON = {
  startingBalance: 50,         // EB every new account starts with
  dailyBonus: 50,              // EB for the first sign-in or visit of each day (UTC calendar day)
  buyIns: [0, 5, 50, 150, 500], // lobby buy-in options (0 = a free table, just for fun: no bid, no payouts)
  defaultBuyIn: 5,             // a new table's buy-in
  unlockWins: 5,               // tricks won with an animal card to unlock its profile picture
};

// ---------- the store (add items here) ----------
// type 'title': shown under the player's name in their banner.
// type 'skin': an alternate look for one character (defined in SKINS in public/data.js, bought from that
//   character's skin shop on the home page). Everyone at the table sees it when you play that character.
const STORE = [
  { id: 'title_savior', type: 'title', name: 'Savior of the Everglades', price: 10000,
    blurb: 'A legendary title that sparkles under your name.' },
  ...SKINS.map(s => ({ id: 'skin:' + s.id, type: 'skin', role: s.role, skin: s.id, name: s.name, price: s.price, blurb: s.blurb, exclusive: !!s.exclusive })),
  // type 'chat': a preset line the player can send as a speech bubble during a game (CHAT in public/data.js)
  ...CHAT.map(c => ({ id: 'chat:' + c.id, type: 'chat', group: c.group, name: c.text, price: c.price, blurb: 'Chat line' })),
  // type 'foil': a foil version of an Ecology or Disruption card. Whenever that card is dealt to its owner it shows
  // as foil, for that player only.
  ...Object.values(CARDS).map(c => ({ id: 'foil:' + c.id, type: 'foil', card: c.id, deck: c.kind, name: c.name + ' (foil)', price: FOIL_PRICE, blurb: 'Foil Ecology card' })),
  ...Object.values(DISRUPTIONS).map(d => ({ id: 'foil:' + d.id, type: 'foil', card: d.id, deck: 'Disruption', name: d.name + ' (foil)', price: FOIL_PRICE, blurb: 'Foil Disruption card' })),
  // type 'splash': an effect that plays over your card when you play it (SPLASHES in public/data.js); equipped like a title
  ...SPLASHES.map(s => ({ id: 'splash:' + s.id, type: 'splash', splash: s.id, name: s.name, price: s.price, blurb: s.blurb, exclusive: !!s.exclusive })),
  // ----- Goblin Ink staff exclusives (exclusive: true) -----
  // Never listed in the store or sold; unlocked only on staff accounts (STAFF_EMAILS below). Others still see the
  // skins, title and splash effect in games.
  { id: 'title_goblin', type: 'title', style: 'goblin', name: 'Goblin Ink Game Staff', price: 0, exclusive: true,
    blurb: 'Goblin Ink staff exclusive: shimmering green, with a whiff of something awful.' },
  // ----- log-in gifts (promo: true): never sold; mailed once to each player while listed in LOGIN_GIFTS -----
  { id: 'title_alpha', type: 'title', style: 'alpha', name: 'Alpha Tester', price: 0, exclusive: true, promo: true,
    blurb: 'A thank-you for playing during the alpha: a sparkling green title.' },
];
// Gifts every player receives once, as a letter, the next time they log in or visit. Remove an entry to stop
// sending it (players who already got it keep it).
// A gift can hold an item and/or Eco-bucks (amount). To add something to a gift that's already gone out, give the
// gift the new contents and add a top-up entry (topUpFor: the gift's id) holding just the addition: players already
// sent the gift get the top-up as its own letter, and new players get one letter with everything.
const LOGIN_GIFTS = [
  { id: 'alpha2026', item: 'title_alpha', amount: 500, note: 'Thanks for alpha testing Everglades!' },
  { id: 'alpha2026eb', topUpFor: 'alpha2026', amount: 500, note: 'Thanks for alpha testing Everglades! Here are 500 Eco-bucks to go with your title.' },
];
const EXCLUSIVE = STORE.filter(i => i.exclusive);
const ownsChat = (a, id) => !!a && a.owned.includes('chat:' + id);

// ---------- profile pictures ----------
const CHARACTER_AVATARS = ['Conservationist', 'Fisherman', 'Hunter', 'LandDeveloper', 'Researcher', 'Tourist', 'Anaconda'];
const ANIMAL_AVATARS = Object.values(CARDS).filter(c => c.taxon !== 'Plant').map(c => c.id);
// every character skin has a picture too ('skin:<id>'), unlocked by owning the skin
const avatarSrc = id => {
  const [kind, name] = String(id).split(':');
  return kind === 'animal' ? `assets/avatars/animal_${name}.png` : kind === 'skin' ? `assets/avatars/skin_${name}.png` : `assets/avatars/char_${name}.png`;
};

// ---------- storage (see storage.js: Upstash Redis when configured, otherwise a local file) ----------
const TABLES = ['accounts', 'sessions', 'google', 'guests', 'tags', 'escrows', 'payments', 'gifts', 'stats'];
const STATS = require('./stats.js');
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
// Goblin Ink staff: Google accounts whose email is listed in the STAFF_EMAILS setting (comma-separated, set on the
// host, never in the code). Checked at every Google sign-in; the email itself is never saved.
const staffEmails = () => String(process.env.STAFF_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
// Admins: Google accounts whose email is listed in ADMIN_EMAILS (comma-separated, set on the host). They can see the
// server-wide stats. Checked (granted or taken away) at every Google sign-in; the email itself is never saved.
const adminEmails = () => String(process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function grantStaff(a) {
  const first = !a.staff;
  a.staff = true;
  for (const it of EXCLUSIVE) if (!it.promo && !a.owned.includes(it.id)) a.owned.push(it.id);
  a.owned = a.owned.filter(id => id !== 'foilall:green'); // the green foil was retired from the staff set
  if (first) { // wear the staff title and stink cloud straight away the first time
    a.title = 'title_goblin'; a.splash = 'stink';
    console.log(`Goblin Ink staff items unlocked for ${a.gamertag}`);
  }
}
// ---------- staff gifts of Eco-bucks ----------
// A staff member gifts EB to a player by gamertag: it arrives as a letter in that player's mailbox straight away.
function giftByTag(staff, tag, amount) {
  if (!staff || !staff.staff) throw userErr('Only Goblin Ink staff can gift Eco-bucks.');
  const a = db.accounts[db.tags[String(tag || '').trim().toLowerCase()]];
  if (!a) throw userErr('No player has that username.');
  amount = Math.floor(Number(amount));
  if (!(amount >= 1 && amount <= 100000)) throw userErr('Gift between 1 and 100,000 EB.');
  sendMail(a, 'gift', amount, 'A gift from Goblin Ink');
  saveNow();
  console.log(`Gift of ${amount} EB sent by ${staff.gamertag} to ${a.gamertag}`);
  return { to: a.gamertag, amount, accountId: a.id };
}
// (Gifts used to be sent to an email address, kept as a salted fingerprint until that Google account signed in.
// Any still waiting are delivered as letters at sign-in.)
const giftKey = email => crypto.createHash('sha256').update('everglades-gift:' + String(email).trim().toLowerCase()).digest('hex');
async function googleLogin(credential) {
  const claims = await verifyGoogle(credential);
  let a = db.accounts[db.google[claims.sub]];
  if (!a) { a = newAccount({ google: true }); db.google[claims.sub] = a.id; }
  const email = String(claims.email || '').toLowerCase();
  if (email && claims.email_verified !== false && staffEmails().includes(email)) { grantStaff(a); save(); }
  const admin = !!email && claims.email_verified !== false && adminEmails().includes(email);
  if (!!a.admin !== admin) { a.admin = admin; save(); if (admin) console.log(`Admin access for ${a.gamertag}`); }
  let gift = 0; // an old-style email gift still waiting: it becomes a letter
  const g = email && claims.email_verified !== false && db.gifts[giftKey(email)];
  if (g) { gift = g.amount; sendMail(a, 'gift', gift, 'A gift from Goblin Ink'); delete db.gifts[giftKey(email)]; saveNow(); }
  return { account: a, session: newSession(a), gift };
}

// ---------- profile ----------
function unlockedAvatars(a) {
  return [...CHARACTER_AVATARS.map(c => 'char:' + c),
    ...SKINS.filter(s => a.owned.includes('skin:' + s.id)).map(s => 'skin:' + s.id),
    ...ANIMAL_AVATARS.filter(id => (a.cardWins[id] || 0) >= ECON.unlockWins).map(id => 'animal:' + id)];
}
// ---------- character profiles (one loadout per character, per account) ----------
// a.chars[role] = { chat?: [chat ids], splash?: splash id | null, finish?: { [card id]: treatment id | 'none' } }
// Anything left unset uses a default: the account-wide splash effect, the first CHAT_SLOTS owned lines (that
// character's own lines first), and every owned treatment switched on. Only owned items ever count, so a loadout
// can't show something its owner no longer has. (The skin lives in a.skins[role], as before.)
const ALL_CARD_IDS = [...Object.keys(CARDS), ...Object.keys(DISRUPTIONS)];
const charCfg = (a, role) => (a && a.chars && a.chars[role]) || {};
function chatFor(a, role) {
  if (!a) return [];
  const owned = CHAT.filter(c => ownsChat(a, c.id));
  const cfg = charCfg(a, role);
  if (Array.isArray(cfg.chat)) return cfg.chat.filter(id => ownsChat(a, id)).slice(0, CHAT_SLOTS);
  const rank = c => c.group === role ? 0 : c.group === 'Table' ? 1 : 2;
  return owned.slice().sort((x, y) => rank(x) - rank(y)).slice(0, CHAT_SLOTS).map(c => c.id);
}
// the lines a seated player may send: their character's lines, or (before roles are chosen) any character's
function chatAllowed(a, role) {
  if (ROLES[role]) return chatFor(a, role);
  return [...new Set(Object.keys(ROLES).flatMap(r => chatFor(a, r)))];
}
const ownsTreatment = (a, t, card) => !!a && a.owned.includes(t + ':' + card);
function treatmentFor(a, role, card) { // the treatment id this card shows as (null = plain)
  const pick = (charCfg(a, role).finish || {})[card];
  if (pick === 'none') return null;
  if (pick && ownsTreatment(a, pick, card)) return pick;
  const t = TREATMENTS.find(t => ownsTreatment(a, t.id, card));
  return t ? t.id : null;
}
// Change one character's loadout. chat: the full list of equipped line ids (max CHAT_SLOTS);
// splash: an effect id, null for none, or 'default' to follow the account-wide effect;
// finish: { [card id]: treatment id | 'none' | 'default' } (only the cards listed change).
function setCharacter(a, { role, chat, splash, finish }) {
  if (!ROLES[role]) throw userErr('That character does not exist.');
  const c = Object.assign({}, charCfg(a, role));
  if (chat !== undefined) {
    if (!Array.isArray(chat)) throw userErr('Bad chat list.');
    const ids = [...new Set(chat.map(String))];
    if (ids.length > CHAT_SLOTS) throw userErr(`Each character can have up to ${CHAT_SLOTS} chat lines equipped.`);
    for (const id of ids) {
      if (!CHAT.some(l => l.id === id)) throw userErr('That chat line does not exist.');
      if (!ownsChat(a, id)) throw userErr("You don't own that chat line yet.");
    }
    c.chat = ids;
  }
  if (splash !== undefined) {
    if (splash === 'default') delete c.splash;
    else if (splash === null) c.splash = null;
    else if (!a.owned.includes('splash:' + splash)) throw userErr("You don't own that splash effect yet.");
    else c.splash = splash;
  }
  if (finish !== undefined) {
    if (!finish || typeof finish !== 'object' || Array.isArray(finish)) throw userErr('Bad card list.');
    const f = Object.assign({}, c.finish);
    for (const [card, t] of Object.entries(finish)) {
      if (!ALL_CARD_IDS.includes(card)) throw userErr('That card does not exist.');
      if (t === 'default') delete f[card];
      else if (t === 'none') f[card] = 'none';
      else if (!TREATMENTS.some(x => x.id === t)) throw userErr('That card treatment does not exist.');
      else if (!ownsTreatment(a, t, card)) throw userErr("You don't own that card treatment yet.");
      else f[card] = t;
    }
    c.finish = f;
  }
  a.chars = Object.assign({}, a.chars, { [role]: c });
}

// skin: { role, id } equips skin `id` for that character; id null goes back to the original look.
// character: a loadout change for one character (see setCharacter).
function setProfile(a, { gamertag, avatar, title, skin, splash, character }) {
  if (character !== undefined) setCharacter(a, character || {});
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
    if (!/^[A-Za-z0-9_ .-]{3,16}$/.test(t)) throw userErr('Usernames are 3–16 letters, numbers, spaces, dots, dashes or underscores.');
    const owner = db.tags[t.toLowerCase()];
    if (owner && owner !== a.id) throw userErr('That username is taken.');
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
  if (splash !== undefined) { // a splash effect id ('sparkle'), or null to turn it off
    if (splash !== null && !a.owned.includes('splash:' + splash)) throw userErr("You don't own that splash effect yet.");
    a.splash = splash;
  }
  save();
  return a;
}
// Daily log-in bonus: paid once per calendar day (UTC), the first time the player signs in or visits.
function today() { return new Date().toISOString().slice(0, 10); }
function dailyBonus(a) {
  loginGifts(a);
  if (a.lastBonusDay === today()) return 0;
  a.lastBonusDay = today();
  sendMail(a, 'daily', ECON.dailyBonus, 'Your daily log-in bonus'); save();
  return ECON.dailyBonus;
}

// ---------- mailbox ----------
// Daily bonuses and staff gifts arrive as letters; the player opens them (the envelope on the home page) to collect
// the Eco-bucks. A mailbox keeps at most 30 letters (the oldest unopened ones are paid out to make room).
const MAIL_MAX = 30;
// a letter holds Eco-bucks (amount) and/or a store item (item: a STORE id, e.g. a title)
function sendMail(a, kind, amount, note, item) {
  a.inbox = a.inbox || [];
  while (a.inbox.length >= MAIL_MAX) deliver(a, a.inbox.shift());
  const m = { id: rid(6), kind, amount, note, at: Date.now() };
  if (item) m.item = item;
  a.inbox.push(m);
  return m;
}
function deliver(a, m) {
  a.balance += m.amount || 0;
  const it = m.item && STORE.find(i => i.id === m.item);
  if (it && !a.owned.includes(it.id)) {
    a.owned.push(it.id);
    if (it.type === 'title' && !a.title) a.title = it.id; // wear a gifted title straight away if none is worn
  }
  return it;
}
// mail each LOGIN_GIFTS entry this player hasn't been sent yet
function loginGifts(a) {
  a.promos = a.promos || [];
  for (const g of LOGIN_GIFTS) {
    if (a.promos.includes(g.id)) continue;
    if (g.topUpFor && !a.promos.includes(g.topUpFor)) continue; // (never happens: sending the gift marks its top-ups done)
    a.promos.push(g.id);
    // the full gift already holds its top-ups' contents
    if (!g.topUpFor) for (const t of LOGIN_GIFTS) if (t.topUpFor === g.id && !a.promos.includes(t.id)) a.promos.push(t.id);
    const item = g.item && !a.owned.includes(g.item) ? g.item : null;
    if (item || g.amount) sendMail(a, item ? 'item' : 'gift', g.amount || 0, g.note, item);
    save();
  }
}
// open one letter (by id) or all of them ('all'); returns how many, the Eco-bucks they held and any items
function openMail(a, id) {
  const inbox = a.inbox || [];
  const list = id === 'all' ? inbox.slice() : inbox.filter(m => m.id === id);
  if (!list.length) throw userErr('That letter was already opened.');
  a.inbox = inbox.filter(m => !list.includes(m));
  const amount = list.reduce((s, m) => s + (m.amount || 0), 0);
  const items = list.map(m => deliver(a, m)).filter(Boolean).map(it => it.name);
  saveNow();
  return { opened: list.length, amount, items };
}

// ---------- friends ----------
// Friend requests go to a username. a.friends: account ids; a.friendIn: ids who asked you; a.friendOut: ids you asked.
const FRIENDS_MAX = 200, REQUESTS_MAX = 50;
function friendLists(a) { a.friends = a.friends || []; a.friendIn = a.friendIn || []; a.friendOut = a.friendOut || []; return a; }
const drop = (list, id) => list.filter(x => x !== id);
function befriend(a, b) {
  friendLists(a); friendLists(b);
  if (!a.friends.includes(b.id)) a.friends.push(b.id);
  if (!b.friends.includes(a.id)) b.friends.push(a.id);
  a.friendIn = drop(a.friendIn, b.id); a.friendOut = drop(a.friendOut, b.id);
  b.friendIn = drop(b.friendIn, a.id); b.friendOut = drop(b.friendOut, a.id);
}
// returns { to, status: 'sent' | 'friends' } ('friends' when they had already asked you: that's an instant yes)
function friendRequest(a, username) {
  friendLists(a);
  const b = db.accounts[db.tags[String(username || '').trim().toLowerCase()]];
  if (!b) throw userErr('No player has that username.');
  if (b.id === a.id) throw userErr("That's you!");
  friendLists(b);
  if (a.friends.includes(b.id)) throw userErr(`You and ${b.gamertag} are already friends.`);
  if (a.friendIn.includes(b.id)) { befriend(a, b); save(); return { to: b.gamertag, status: 'friends', accountId: b.id }; }
  if (a.friendOut.includes(b.id)) throw userErr(`You already sent ${b.gamertag} a request.`);
  if (a.friends.length >= FRIENDS_MAX) throw userErr(`You can have up to ${FRIENDS_MAX} friends.`);
  if (a.friendOut.length >= REQUESTS_MAX || b.friendIn.length >= REQUESTS_MAX) throw userErr('Too many friend requests are waiting. Try again later.');
  a.friendOut.push(b.id); b.friendIn.push(a.id); save();
  return { to: b.gamertag, status: 'sent', accountId: b.id };
}
function friendRespond(a, fromId, accept) {
  friendLists(a);
  const b = db.accounts[fromId];
  if (!b || !a.friendIn.includes(fromId)) throw userErr('That friend request is no longer there.');
  if (accept) {
    if (a.friends.length >= FRIENDS_MAX) throw userErr(`You can have up to ${FRIENDS_MAX} friends.`);
    befriend(a, b);
  } else { a.friendIn = drop(a.friendIn, fromId); friendLists(b).friendOut = drop(b.friendOut, a.id); }
  save();
  return b;
}
// unfriend, or cancel a request you sent
function friendRemove(a, id) {
  friendLists(a); const b = db.accounts[id];
  a.friends = drop(a.friends, id); a.friendOut = drop(a.friendOut, id); a.friendIn = drop(a.friendIn, id);
  if (b) { friendLists(b); b.friends = drop(b.friends, a.id); b.friendIn = drop(b.friendIn, a.id); b.friendOut = drop(b.friendOut, a.id); }
  save();
}
const isFriend = (a, id) => !!a && (a.friends || []).includes(id);
// what the friends list shows about a player
const friendCard = b => ({ id: b.id, username: b.gamertag, avatarSrc: avatarSrc(b.avatar), titleName: titleName(b.title), titleStyle: titleStyle(b.title) });
function friendsOf(a) {
  friendLists(a);
  const cards = ids => ids.map(id => db.accounts[id]).filter(Boolean).map(friendCard);
  return { friends: cards(a.friends), incoming: cards(a.friendIn), outgoing: cards(a.friendOut) };
}

// ---------- store ----------
function buy(a, itemId) {
  const item = STORE.find(i => i.id === itemId);
  if (!item || item.exclusive) throw userErr('That item is not in the store.');
  if (a.owned.includes(item.id)) throw userErr('You already own that.');
  if (a.balance < item.price) throw userErr(`You need ${item.price.toLocaleString()} EB for that.`);
  a.balance -= item.price; a.owned.push(item.id);
  if (item.type === 'title' && !a.title) a.title = item.id; // wear it straight away
  if (item.type === 'skin') a.skins = Object.assign({}, a.skins, { [item.role]: item.skin }); // equip it straight away
  if (item.type === 'splash') a.splash = item.splash; // switch to the new effect straight away
  if (item.type === 'chat' && ROLES[item.group]) { // a character's own line goes into a free slot of that character
    const c = charCfg(a, item.group);
    if (Array.isArray(c.chat) && c.chat.length < CHAT_SLOTS) a.chars[item.group] = Object.assign({}, c, { chat: c.chat.concat(item.id.slice(5)) });
  }
  save();
  return item;
}
const titleName = id => (STORE.find(i => i.id === id) || {}).name || null;
const titleStyle = id => (STORE.find(i => i.id === id) || {}).style || 'sparkle'; // the look of the title under a player's name

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
// The splash effect everyone sees when this account plays a card as `role` (no role: the account-wide effect).
function splashFor(a, role) {
  if (!a) return null;
  const c = charCfg(a, role);
  const id = ROLES[role] && c.splash !== undefined ? c.splash : a.splash;
  return id && a.owned.includes('splash:' + id) ? id : null;
}
// Each character's loadout as the owner sees it in its profile (and as the game uses it).
function charProfiles(a) {
  return Object.fromEntries(Object.keys(ROLES).map(role => {
    const c = charCfg(a, role), finish = {};
    for (const card of ALL_CARD_IDS) { const t = treatmentFor(a, role, card); if (t) finish[card] = t; }
    return [role, { chat: chatFor(a, role), chatCustom: Array.isArray(c.chat), splash: splashFor(a, role), splashCustom: c.splash !== undefined, finish }];
  }));
}
function publicProfile(a) { // shown to everyone (lobby banner)
  return { id: a.id, gamertag: a.gamertag, avatar: a.avatar, avatarSrc: avatarSrc(a.avatar), title: a.title, titleName: titleName(a.title), titleStyle: titleStyle(a.title),
    skins: Object.fromEntries(Object.keys(ROLES).map(r => [r, skinFor(a, r)]).filter(x => x[1])), splash: splashFor(a) };
}
function privateProfile(a) { // shown to the account owner
  return Object.assign(publicProfile(a), {
    balance: a.balance, owned: a.owned, cardWins: a.cardWins, stats: a.stats, guest: !!a.guest,
    staff: !!a.staff, admin: !!a.admin, exclusiveStore: EXCLUSIVE.filter(i => a.owned.includes(i.id) || (a.staff && !i.promo)), // exclusives show only in their owners' stores
    inbox: (a.inbox || []).map(m => ({ id: m.id, kind: m.kind, amount: m.amount, note: m.note, at: m.at, item: m.item || null, itemName: m.item ? titleName(m.item) : null })), // unopened letters
    unlocked: unlockedAvatars(a),
    chars: charProfiles(a), // per-character chat lines, splash effect and card treatments
  });
}
function config() {
  return { googleClientId: GOOGLE_CLIENT_ID(), guestsAllowed: guestsAllowed(), econ: ECON, store: STORE.filter(i => !i.exclusive),
    avatars: { characters: CHARACTER_AVATARS.map(c => ({ id: 'char:' + c, src: avatarSrc('char:' + c) })),
      skins: SKINS.map(s => ({ id: 'skin:' + s.id, role: s.role, name: s.name, src: avatarSrc('skin:' + s.id) })),
      animals: ANIMAL_AVATARS.map(id => ({ id: 'animal:' + id, card: id, name: CARDS[id].name, src: avatarSrc('animal:' + id) })) } };
}
const get = id => db.accounts[id] || null;

// ---------- game records (see stats.js) ----------
function recordGame(summary) { STATS.record(db, summary); save(); }
const playerStats = a => STATS.playerView(a);
function serverStats(a) {
  if (!a || !a.admin) throw userErr('Only admins can see the server stats.');
  return STATS.serverView(db);
}

// ---------- Eco-bucks bought with real money (see payments.js) ----------
// Adds a paid Stripe Checkout session's Eco-bucks once. db.payments keeps a record of every credited session
// (so a session can never be credited twice) and doubles as the purchase history.
function creditPurchase({ sessionId, accountId, packId, amount, currency, packs, livemode, paymentIntent }) {
  if (db.payments[sessionId]) return { credited: false, already: true, eb: db.payments[sessionId].eb, accountId };
  const pack = packs.find(p => p.id === packId);
  if (!pack || amount !== pack.cents || String(currency).toLowerCase() !== 'usd') throw userErr('That payment does not match an Eco-buck pack.');
  const a = db.accounts[accountId];
  if (!a) throw userErr('No account for that purchase.');
  a.balance += pack.eb;
  a.stats.ebBought = (a.stats.ebBought || 0) + pack.eb;
  db.payments[sessionId] = { accountId, pack: pack.id, eb: pack.eb, cents: amount, live: !!livemode, pi: paymentIntent || null, at: Date.now() };
  saveNow(); // money: store it straight away
  return { credited: true, eb: pack.eb, accountId, balance: a.balance };
}
// Refunds and disputes (Stripe webhooks): take back the Eco-bucks a payment bought, in proportion to what was
// refunded, or all of them while it is disputed (given back if the dispute is won). The balance may go below 0.
function adjustPurchase(paymentIntent, change) {
  const rec = paymentIntent && Object.values(db.payments).find(r => r.pi === paymentIntent);
  if (!rec) return { changed: false };
  if (change.refundedFraction !== undefined) rec.refundedEb = Math.round(rec.eb * Math.max(0, Math.min(1, change.refundedFraction)));
  if (change.disputed !== undefined) rec.disputed = !!change.disputed;
  const target = rec.disputed ? rec.eb : (rec.refundedEb || 0);
  const delta = target - (rec.reversed || 0);
  if (!delta) return { changed: false, accountId: rec.accountId };
  const a = db.accounts[rec.accountId];
  if (a) a.balance -= delta;
  rec.reversed = target;
  saveNow();
  return { changed: true, eb: -delta, accountId: rec.accountId, balance: a ? a.balance : null };
}

module.exports = {
  ECON, STORE, ready, flush, saveNow, storeName: () => store.name, get, bySession, requireAccount, signOut, guestLogin, googleLogin,
  setProfile, dailyBonus, buy, takeBuyIns, refundEscrow, refundAllEscrows, settle, payouts, recordCardWin,
  publicProfile, privateProfile, config, recordGame, playerStats, serverStats, avatarSrc, titleName, skinFor, splashFor, ownsChat, chatFor, chatAllowed, treatmentFor, creditPurchase, adjustPurchase, grantStaff, giftByTag, openMail, sendMail,
  friendRequest, friendRespond, friendRemove, friendsOf, isFriend,
};
