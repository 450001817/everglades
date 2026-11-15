// Character profiles: per-character chat lines (max CHAT_SLOTS), splash effect and card treatments.
// Uses a throwaway data folder, so your real accounts are never touched.  Run: node test/characters.js
const os = require('os'), fs = require('fs'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-chars-'));
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; // use the throwaway file
const A = require('../accounts.js');
const { CHAT, CHAT_SLOTS } = require('../public/data.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const throws = (fn, msg) => { try { fn(); ok(false, msg); } catch (e) { ok(!!e.userError, msg + ' (' + e.message + ')'); } };
const set = (a, character) => A.setProfile(a, { character });

const a = A.guestLogin(require('crypto').randomBytes(24).toString('hex')).account;
a.balance = 100000;
// own 4 Table lines, then 4 Hunter lines
const tbl = CHAT.filter(c => c.group === 'Table').slice(0, 4), hnt = CHAT.filter(c => c.group === 'Hunter').slice(0, 4);
for (const c of [...tbl, ...hnt]) A.buy(a, 'chat:' + c.id);
{
  const L = A.privateProfile(a).chars.Hunter;
  ok(L.chat.length === CHAT_SLOTS && !L.chatCustom, `unset: the first ${CHAT_SLOTS} owned lines are equipped by default`);
  ok(hnt.every(c => L.chat.includes(c.id)) && L.chat.slice(0, 4).every(id => id.startsWith('hnt')), "the character's own lines come first");
  ok(A.privateProfile(a).chars.Tourist.chat.slice(0, 4).every(id => id.startsWith('tbl')), 'another character falls back to Table talk first');
}
throws(() => set(a, { role: 'Hunter', chat: [...tbl, ...hnt].map(c => c.id).slice(0, 6) }), 'no more than 5 lines per character');
throws(() => set(a, { role: 'Hunter', chat: [CHAT.find(c => c.group === 'Tourist').id] }), "can't equip a line you don't own");
throws(() => set(a, { role: 'Nobody', chat: [] }), 'unknown character');
set(a, { role: 'Hunter', chat: [hnt[0].id, tbl[0].id] });
ok(A.chatFor(a, 'Hunter').join() === [hnt[0].id, tbl[0].id].join(), 'a chosen list is kept in order');
ok(A.chatAllowed(a, 'Hunter').length === 2 && !A.chatAllowed(a, 'Hunter').includes(hnt[1].id), 'in a game only the equipped lines can be sent');
set(a, { role: 'Tourist', chat: [hnt[1].id] });
ok(A.chatAllowed(a, null).includes(hnt[1].id) && !A.chatAllowed(a, null).includes(hnt[2].id), "before roles are picked, any character's equipped lines work (and only those)");
A.buy(a, 'chat:' + CHAT.filter(c => c.group === 'Hunter')[5].id);
ok(A.chatFor(a, 'Hunter').length === 3, "buying a character's own line fills a free slot of that character");
set(a, { role: 'Hunter', chat: [] });
ok(A.chatFor(a, 'Hunter').length === 0 && A.privateProfile(a).chars.Hunter.chatCustom, 'a character can have no lines at all');

// splash: account default, per-character override, none
A.buy(a, 'splash:sparkle'); A.buy(a, 'splash:splash'); // the last one bought becomes the account default
ok(A.splashFor(a, 'Tourist') === 'splash' && A.splashFor(a) === 'splash', 'unset characters follow the account-wide splash');
set(a, { role: 'Tourist', splash: 'sparkle' });
ok(A.splashFor(a, 'Tourist') === 'sparkle' && A.splashFor(a, 'Hunter') === 'splash', 'a character can use its own splash');
set(a, { role: 'Hunter', splash: null });
ok(A.splashFor(a, 'Hunter') === null, 'or none');
set(a, { role: 'Hunter', splash: 'default' });
ok(A.splashFor(a, 'Hunter') === 'splash', "'default' goes back to the account-wide effect");
throws(() => set(a, { role: 'Hunter', splash: 'stink' }), "can't use a splash you don't own");

// card treatments
A.buy(a, 'foil:Manatee'); A.buy(a, 'foil:Hurricane');
ok(A.treatmentFor(a, 'Researcher', 'Manatee') === 'foil' && A.treatmentFor(a, 'Researcher', 'Flamingo') === null, 'owned foils are on by default, other cards plain');
set(a, { role: 'Researcher', finish: { Manatee: 'none' } });
ok(A.treatmentFor(a, 'Researcher', 'Manatee') === null && A.treatmentFor(a, 'Tourist', 'Manatee') === 'foil', 'switched off for one character only');
ok(!('Manatee' in A.privateProfile(a).chars.Researcher.finish) && A.privateProfile(a).chars.Researcher.finish.Hurricane === 'foil', 'the profile lists each card\'s treatment');
set(a, { role: 'Researcher', finish: { Manatee: 'foil' } });
ok(A.treatmentFor(a, 'Researcher', 'Manatee') === 'foil', 'and back on');
throws(() => set(a, { role: 'Researcher', finish: { Flamingo: 'foil' } }), "can't turn on a treatment you don't own");
throws(() => set(a, { role: 'Researcher', finish: { Nope: 'foil' } }), 'unknown card');
throws(() => set(a, { role: 'Researcher', finish: { Manatee: 'holo' } }), 'unknown treatment');

// the loadout only ever shows owned things
a.owned = a.owned.filter(id => id !== 'splash:sparkle' && id !== 'foil:Manatee');
ok(A.splashFor(a, 'Tourist') === null && A.treatmentFor(a, 'Researcher', 'Manatee') === null, 'items no longer owned never show');

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll character profile checks passed.');
A.flush().then(() => process.exit(fails ? 1 : 0));
