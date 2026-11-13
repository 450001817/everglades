// Checks the Eco-buck economy: buy-ins, payouts, ties, co-op, refunds, store and unlocks.
// Uses a throwaway data folder, so your real accounts are never touched.  Run: node test/economy.js
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-econ-'));
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; // use the throwaway file
const A = require('../accounts.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const throws = (fn, msg) => { try { fn(); ok(false, msg); } catch (e) { ok(!!e.userError, msg + ' (' + e.message + ')'); } };

// payout table always adds up to the pot
for (const n of [4, 5, 6]) for (const b of A.ECON.buyIns) {
  const p = A.payouts(n, b);
  ok(p.reduce((x, y) => x + y, 0) === n * b && p[1] === b && p[2] === Math.floor(b / 2) && p.slice(3).every(x => x === 0),
    `${n} seats, ${b} EB: payouts ${p.join('/')} add up to the ${n * b} EB pot`);
}

const mk = () => A.guestLogin(require('crypto').randomBytes(24).toString('hex')).account;
const [a, b, c] = [mk(), mk(), mk()];
ok(a.balance === 50, `new accounts start with 50 EB (${a.balance})`);
ok(A.dailyBonus(a) === 0 && a.balance === 50, "a new account's first day is covered by its starting balance");
a.lastBonusDay = '2000-01-01'; ok(A.dailyBonus(a) === 50 && a.balance === 100, 'the next day pays the 50 EB log-in bonus');
ok(A.dailyBonus(a) === 0 && a.balance === 100, 'only once per day');
for (const x of [a, b, c]) x.balance = 500; // give the test players some money to bet

// 3 people + 1 bot at a 50 EB table; scores decide places
A.takeBuyIns('g1', [a.id, b.id, c.id], 50);
ok(a.balance === 450 && b.balance === 450, 'buy-in is taken when the game starts');
let r = A.settle('g1', [
  { seat: 0, accountId: a.id, score: 80 }, { seat: 1, accountId: b.id, score: 60 },
  { seat: 2, accountId: c.id, score: 40 }, { seat: 3, accountId: null, score: 20 }]);
ok(a.balance === 450 + 125 && b.balance === 500 && c.balance === 450 + 25, `1st +75 net (got ${a.balance}), 2nd even (${b.balance}), 3rd half back (${c.balance})`);
ok(r.results[3].payout === 0, 'last place (the bot) loses its bet');
ok(A.settle('g1', []) === null, 'a game can only be paid out once');

// ties share their places: two tied for 1st split 1st+2nd payouts
const before = [a.balance, b.balance];
A.takeBuyIns('g2', [a.id, b.id], 50);
A.settle('g2', [{ seat: 0, accountId: a.id, score: 70 }, { seat: 1, accountId: b.id, score: 70 }, { seat: 2, accountId: null, score: 10 }, { seat: 3, accountId: null, score: 5 }]);
ok(a.balance - before[0] === b.balance - before[1] && a.balance - before[0] === Math.floor((125 + 50) / 2) - 50, `tied 1st places split evenly (+${a.balance - before[0]} each)`);

// co-op: win doubles, loss loses
const cb = c.balance;
A.takeBuyIns('g3', [c.id], 150); A.settle('g3', [{ seat: 0, accountId: c.id, score: 1 }], { coop: true, playersWin: true });
ok(c.balance === cb + 150, 'co-op win: bet back doubled');
A.takeBuyIns('g4', [c.id], 150); A.settle('g4', [{ seat: 0, accountId: c.id, score: 1 }], { coop: true, playersWin: false });
ok(c.balance === cb, 'co-op loss: bet lost');

// can't sit at a table you can't afford; unfinished games are refunded
throws(() => A.takeBuyIns('g5', [a.id], 1e9), 'buy-in larger than the balance is refused');
const ab = a.balance; A.takeBuyIns('g6', [a.id], 500 > ab ? 5 : 500); A.refundAllEscrows();
ok(a.balance === ab, 'buy-ins of unfinished games are refunded on restart');

// store
throws(() => A.buy(a, 'title_savior'), 'cannot buy the 10,000 EB title without the Eco-bucks');
a.balance = 12000; A.buy(a, 'title_savior');
ok(a.balance === 2000 && a.owned.includes('title_savior') && a.title === 'title_savior', 'buying the title spends 10,000 EB and wears it');
ok(A.publicProfile(a).titleName === 'Savior of the Everglades', 'the title shows on the public banner');
throws(() => A.buy(a, 'title_savior'), 'cannot buy it twice');

// character skins: 500 EB, equipped on purchase, only owned skins can be worn, only for their own character
const { SKINS } = require('../public/data.js');
ok(SKINS.length >= 6 && SKINS.every(s => s.price === 500), `${SKINS.length} skins, all 500 EB`);
ok(new Set(SKINS.map(s => s.name)).size === SKINS.length && new Set(SKINS.map(s => s.id)).size === SKINS.length, 'every skin has a unique name and id');
ok(SKINS.some(s => s.id === 'rodney' && s.role === 'Hunter' && s.name === 'Rodney'), 'Rodney is a Hunter skin');
ok(A.skinFor(b, 'Hunter') === null && !A.publicProfile(b).skins.Hunter, 'no skin by default');
throws(() => A.setProfile(b, { skin: { role: 'Hunter', id: 'rodney' } }), 'cannot equip a skin you have not bought');
b.balance = 499; throws(() => A.buy(b, 'skin:rodney'), 'cannot buy a skin with 499 EB');
b.balance = 600; A.buy(b, 'skin:rodney');
ok(b.balance === 100 && A.skinFor(b, 'Hunter') === 'rodney' && A.publicProfile(b).skins.Hunter === 'rodney', 'buying Rodney spends 500 EB and equips him');
throws(() => A.buy(b, 'skin:rodney'), 'cannot buy a skin twice');
throws(() => A.setProfile(b, { skin: { role: 'Tourist', id: 'rodney' } }), 'a Hunter skin cannot go on the Tourist');
A.setProfile(b, { skin: { role: 'Hunter', id: null } }); ok(A.skinFor(b, 'Hunter') === null, 'back to the original look');
A.setProfile(b, { skin: { role: 'Hunter', id: 'rodney' } }); ok(A.skinFor(b, 'Hunter') === 'rodney', 'an owned skin can be equipped again');
ok(A.skinFor(c, 'Hunter') === null, "one player's skin doesn't affect anyone else");
const legacy = mk(); delete legacy.skins; ok(A.skinFor(legacy, 'Hunter') === null && A.publicProfile(legacy).skins, 'accounts made before skins existed still work');

// chat lines: every bot line is for sale at 50 EB, with stable unique ids
const { CHAT } = require('../public/data.js');
ok(CHAT.length > 100 && CHAT.every(x => x.price === 50), `${CHAT.length} chat lines, all 50 EB`);
ok(new Set(CHAT.map(x => x.id)).size === CHAT.length && new Set(CHAT.map(x => x.text)).size === CHAT.length, 'chat line ids and texts are unique');
ok(CHAT.every(x => !/[{}$]/.test(x.text)), 'no chat line has an unfilled {placeholder}');
ok(CHAT.find(x => x.id === 'fsh4').text === 'That’s a keeper!', 'chat ids follow the catalogue order (fsh4 = “That’s a keeper!”)');
ok(!A.ownsChat(c, 'fsh4'), 'chat lines start locked');
c.balance = 120; A.buy(c, 'chat:fsh4');
ok(c.balance === 70 && A.ownsChat(c, 'fsh4'), 'buying a chat line costs 50 EB');
throws(() => A.buy(c, 'chat:fsh4'), 'cannot buy a chat line twice');
throws(() => A.buy(c, 'chat:nope'), 'unknown chat line is refused');

// profile pictures: animals unlock after 5 tricks won with that card; plants never count
throws(() => A.setProfile(a, { avatar: 'animal:Manatee' }), 'locked animal picture is refused');
let unlocked = null; for (let i = 0; i < 5; i++) unlocked = A.recordCardWin(a.id, 'Manatee') || unlocked;
ok(unlocked === 'Manatee', 'the 5th trick won with Manatee unlocks it');
A.setProfile(a, { avatar: 'animal:Manatee' }); ok(a.avatar === 'animal:Manatee', 'unlocked picture can be chosen');
ok(A.recordCardWin(a.id, 'Seagrass') === null && !a.cardWins.Seagrass, 'plant cards do not count');
A.setProfile(a, { gamertag: 'Swamp King' });
throws(() => A.setProfile(b, { gamertag: 'swamp king' }), 'gamertags are unique');
throws(() => A.setProfile(b, { gamertag: 'x' }), 'gamertag too short is refused');

// Google sign-in: the ID-token check, with a stand-in for Google's signing keys
(async () => {
  await A.flush(); await A.saveNow();
  ok(fs.existsSync(path.join(process.env.DATA_DIR, 'accounts.json')), 'accounts are saved to disk');
  const crypto = require('crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'test-key', alg: 'RS256', use: 'sig' });
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }), headers: { get: () => 'max-age=3600' } });
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (claims, key = privateKey) => {
    const head = b64({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }), body = b64(claims);
    return `${head}.${body}.${crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), key).toString('base64url')}`;
  };
  const good = { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, sub: 'g-123', exp: Math.floor(Date.now() / 1000) + 600 };
  const first = await A.googleLogin(token(good));
  const again = await A.googleLogin(token(good));
  ok(first.account.id === again.account.id && first.session !== again.session, 'Google sign-in creates one account per Google user');
  ok(!JSON.stringify(first.account).includes('g-123'), 'the Google user id is not stored on the account itself');
  const refused = async (t, msg) => { try { await A.googleLogin(t); ok(false, msg); } catch (e) { ok(!!e.userError, `${msg} (${e.message})`); } };
  await refused(token(Object.assign({}, good, { aud: 'someone-else' })), 'token for a different site is refused');
  await refused(token(Object.assign({}, good, { exp: 1 })), 'expired token is refused');
  await refused(token(Object.assign({}, good, { iss: 'evil.example' })), 'token not from Google is refused');
  await refused(token(good, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey), 'token with a forged signature is refused');
  const parts = token(good).split('.'); parts[1] = b64(Object.assign({}, good, { sub: 'g-999' }));
  await refused(parts.join('.'), 'tampered token is refused');
  console.log(fails ? `\n${fails} check(s) failed.` : '\nAll economy checks passed.');
  process.exit(fails ? 1 : 0);
})();
