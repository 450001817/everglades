// Checks the Eco-buck economy: multiplier bets, payouts, ties, co-op, refunds, store and unlocks.
// Uses a throwaway data folder, so your real accounts are never touched.  Run: node test/economy.js
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-econ-'));
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; // use the throwaway file
const A = require('../accounts.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const throws = (fn, msg) => { try { fn(); ok(false, msg); } catch (e) { ok(!!e.userError, msg + ' (' + e.message + ')'); } };

// what a loser owes: (top score − theirs) × multiplier, whole EB
ok(A.owes(50, 15, 10) === 350, 'the example: a 10x table, 50 vs 15 → 350 EB');
ok(A.owes(50, 15, 0.5) === 17 && A.owes(50, 50, 20) === 0 && A.owes(50, 15, 0) === 0, '0.5x rounds down; ties and free tables owe nothing');
ok(A.ECON.multipliers.join() === '0,0.5,1,5,10,20,50', 'tables offer Free, 0.5x, 1x, 5x, 10x, 20x and 50x');
ok(A.ECON.multipliers.map(A.confirmCost).join() === '0,13,25,125,250,500,1250', 'confirming needs 25 EB × the multiplier (0.5x rounds up to 13)');

const mk = () => A.guestLogin(require('crypto').randomBytes(24).toString('hex')).account;
const [a, b, c] = [mk(), mk(), mk()];
ok(a.balance === 50, `new accounts start with 50 EB (${a.balance})`);
ok(A.dailyBonus(a) === 0 && a.balance === 50, "a new account's first day is covered by its starting balance");
{ // log-in gift: the Alpha Tester title, mailed once
  ok(a.inbox.length === 1 && a.inbox[0].item === 'title_alpha' && A.privateProfile(a).inbox[0].itemName === 'Alpha Tester', 'the Alpha Tester title arrives as a letter at log-in');
  A.dailyBonus(a); a.lastBonusDay = '2000-01-01'; A.dailyBonus(a);
  ok(a.inbox.filter(m => m.item === 'title_alpha').length === 1, 'it is only ever sent once');
  a.inbox = a.inbox.filter(m => m.item); // drop the extra daily letter for the checks below
  const r = A.openMail(a, a.inbox[0].id);
  ok(r.items[0] === 'Alpha Tester' && r.amount === 500 && a.owned.includes('title_alpha') && a.title === 'title_alpha' && a.balance === 550, 'opening it unlocks and wears the title and pays 500 EB');
  ok(!a.inbox.length, 'new players get one letter with both (no separate 500 EB top-up)');
  a.balance = 50; // back to the starting balance for the checks below
  { // a player mailed the title before the 500 EB was added gets the Eco-bucks as their own letter, once
    c.promos = ['alpha2026']; c.owned.push('title_alpha');
    A.dailyBonus(c); const top = c.inbox.filter(m => m.note && /Alpha|alpha/.test(m.note));
    ok(top.length === 1 && top[0].amount === 500 && !top[0].item, 'earlier alpha testers get a 500 EB top-up letter');
    A.dailyBonus(c); ok(c.inbox.filter(m => m.amount === 500).length === 1, 'only once');
    c.inbox = []; c.owned = c.owned.filter(x => x !== 'title_alpha');
  }
  ok(A.publicProfile(a).titleStyle === 'alpha' && A.privateProfile(a).exclusiveStore.some(i => i.id === 'title_alpha'), 'others see the green sparkle; it shows in its owner\'s Titles tab');
  ok(!A.privateProfile(b).exclusiveStore.length && !A.config().store.some(i => i.id === 'title_alpha'), 'it is never in the store for anyone else');
  let err = ''; try { A.buy(b, 'title_alpha'); } catch (x) { err = x.message; } ok(/not in the store/.test(err), "it can't be bought");
  A.dailyBonus(b); const sent = b.inbox.length; b.inbox = []; A.dailyBonus(b); ok(sent === 1 && !b.inbox.length, 'a player who already got it (even unopened) is not sent another');
  a.title = null;
}
a.lastBonusDay = '2000-01-01'; ok(A.dailyBonus(a) === 50 && a.balance === 50 && a.inbox.length === 1 && a.inbox[0].amount === 50, 'the next day the 50 EB log-in bonus arrives as a letter (not paid yet)');
ok(A.dailyBonus(a) === 0 && a.inbox.length === 1, 'only once per day');
ok(A.privateProfile(a).inbox.length === 1, 'the letter shows in the player\'s own profile');
{ const r = A.openMail(a, a.inbox[0].id); ok(r.amount === 50 && a.balance === 100 && a.inbox.length === 0, 'opening the letter pays the 50 EB'); }
{ let err = ''; try { A.openMail(a, 'nope'); } catch (x) { err = x.message; } ok(/already opened/.test(err), 'a letter can only be opened once'); }
a.lastBonusDay = '2000-01-01'; A.dailyBonus(a); a.lastBonusDay = '2000-01-02'; A.dailyBonus(a);
{ const r = A.openMail(a, 'all'); ok(r.opened === 2 && r.amount === 100 && a.balance === 200, 'Open all collects every letter'); a.balance = 100; }
for (const x of [a, b, c]) x.balance = 500; // give the test players some money to bet

// 3 people + 1 bot at a 1x table: every seat below the top pays (top − its score) × 1 to the top score
A.takeStakes('g1', [a.id, b.id, c.id], 1);
ok(a.balance === 475 && b.balance === 475, 'the 25 EB confirm deposit is held when the game starts');
let r = A.settle('g1', [
  { seat: 0, accountId: a.id, score: 80 }, { seat: 1, accountId: b.id, score: 60 },
  { seat: 2, accountId: c.id, score: 40 }, { seat: 3, accountId: null, score: 20 }]);
ok(b.balance === 500 - 20 && c.balance === 500 - 40, `2nd pays 20 (${b.balance}), 3rd pays 40 (${c.balance})`);
ok(a.balance === 500 + 20 + 40 + 60 && r.results[0].received === 120 && r.results[0].net === 120, `the winner takes everyone's gap, the house paying the bot's 60 (${a.balance})`);
ok(r.results[3].paid === 60 && r.pot === 120 && r.mult === 1 && r.top === 80, 'the pot is the sum of what the losers paid');
ok(r.results.map(x => x.place).join() === '1,2,3,4', 'places follow the scores');
ok(A.settle('g1', []) === null, 'a game can only be paid out once');

// the example from the rules: a 10x table, winner 50, loser 15 → 350 EB
for (const x of [a, b]) x.balance = 1000;
A.takeStakes('gx', [a.id, b.id], 10);
ok(a.balance === 750, 'a 10x table holds 250 EB from each player');
A.settle('gx', [{ seat: 0, accountId: a.id, score: 50 }, { seat: 1, accountId: b.id, score: 15 }]);
ok(a.balance === 1350 && b.balance === 650, `the loser pays 350 EB (${b.balance}), the winner gets it (${a.balance})`);

// ties at the top split the pot; the losers pay the same gap as for a single winner
for (const x of [a, b, c]) x.balance = 1000;
A.takeStakes('g2', [a.id, b.id, c.id], 5);
r = A.settle('g2', [{ seat: 0, accountId: a.id, score: 70 }, { seat: 1, accountId: b.id, score: 70 }, { seat: 2, accountId: c.id, score: 61 }, { seat: 3, accountId: null, score: 60 }]);
ok(c.balance === 1000 - 45 && r.results[3].paid === 50, 'each loser pays (70 − their score) × 5');
ok(a.balance === 1000 + 48 && b.balance === 1000 + 47 && r.results[0].place === 1 && r.results[1].place === 1, `tied winners split the 95 EB pot (${a.balance - 1000} / ${b.balance - 1000}, the odd EB to the first seat)`);

// a winning bot: the house keeps its share
for (const x of [a, b]) x.balance = 1000;
A.takeStakes('gb', [a.id, b.id], 1);
r = A.settle('gb', [{ seat: 0, accountId: null, score: 90 }, { seat: 1, accountId: a.id, score: 80 }, { seat: 2, accountId: b.id, score: 90 }]);
ok(a.balance === 990 && b.balance === 1005 && r.results[0].received === 5, 'a bot tied for the top takes its half of the pot for the house');

// can't cover the payout: pay everything you have and go to 0
a.balance = 600; b.balance = 1000;
A.takeStakes('g3', [a.id, b.id], 20); // (500 EB held from each)
r = A.settle('g3', [{ seat: 0, accountId: b.id, score: 90 }, { seat: 1, accountId: a.id, score: 40 }]);
ok(a.balance === 0 && r.results[1].owed === 1000 && r.results[1].paid === 600 && r.results[1].short, 'owing 1,000 EB with only 600: pays all 600 and goes to 0');
ok(b.balance === 1600, 'the winner gets what the loser could pay');

// co-op tables are always free
const cb = c.balance;
A.takeStakes('g4', [c.id], 0); A.settle('g4', [{ seat: 0, accountId: c.id, score: 1 }], { coop: true, playersWin: true });
ok(c.balance === cb, 'co-op win: no Eco-bucks change hands');
c.balance = 1000; A.takeStakes('g4b', [c.id], 20);
r = A.settle('g4b', [{ seat: 0, accountId: c.id, score: 1 }, { seat: 1, accountId: null, score: 99 }], { coop: true, playersWin: false });
ok(c.balance === 1000 && r.mult === 0, 'co-op loss: nothing paid, even if a multiplier was set (the deposit comes back)');

// can't confirm what you can't cover; unfinished games are refunded
a.balance = 100;
throws(() => A.takeStakes('g5', [a.id], 5), 'a 5x table (125 EB) is refused with 100 EB');
const ab = a.balance; A.takeStakes('g6', [a.id], 1); ok(a.balance === ab - 25, 'held'); A.refundAllEscrows();
ok(a.balance === ab, 'deposits held for unfinished games are refunded on restart');


// store
throws(() => A.buy(a, 'title_savior'), 'cannot buy the 10,000 EB title without the Eco-bucks');
a.balance = 12000; A.buy(a, 'title_savior');
ok(a.balance === 2000 && a.owned.includes('title_savior') && a.title === 'title_savior', 'buying the title spends 10,000 EB and wears it');
ok(A.publicProfile(a).titleName === 'Savior of the Everglades', 'the title shows on the public banner');
throws(() => A.buy(a, 'title_savior'), 'cannot buy it twice');

// character skins: 500 EB, equipped on purchase, only owned skins can be worn, only for their own character
const { SKINS } = require('../public/data.js');
const forSale = SKINS.filter(s => !s.exclusive); // staff skins are never sold (see test/staff.js)
ok(forSale.length >= 6 && forSale.every(s => s.price === 500), `${forSale.length} skins for sale, all 500 EB`);
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
