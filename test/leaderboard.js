// Leaderboards: Eco-bucks won from games (beyond the buy-in) today, this month and of all time.
// Uses a throwaway data folder, so your real accounts are never touched.  Run: node test/leaderboard.js
'use strict';
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-lb-'));
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN; // use the throwaway file
const A = require('../accounts.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const guest = () => A.guestLogin(crypto.randomBytes(24).toString('hex')).account;
let gameN = 0;
// a 4-seat game at `bet`: scores decide the places (1st takes the pot minus 2nd's refund, and so on)
function play(bet, seats) { // seats: [{ a, score }] (a null = a bot)
  const id = 'g' + (++gameN);
  A.takeBuyIns(id, seats.filter(x => x.a).map(x => x.a.id), bet);
  return A.settle(id, seats.map((x, i) => ({ seat: i, accountId: x.a ? x.a.id : null, score: x.score })));
}

(async () => {
  await A.ready;
  const [ann, bob, cat] = [guest(), guest(), guest()];
  for (const a of [ann, bob, cat]) a.balance = 10000;
  A.setProfile(ann, { gamertag: 'Ann' }); A.setProfile(bob, { gamertag: 'Bob' }); A.setProfile(cat, { gamertag: 'Cat' });

  console.log('Empty boards');
  for (const p of ['day', 'month', 'all']) ok(A.leaderboard(p, ann).top.length === 0 && A.leaderboard(p, ann).me === null, `${p}: nobody yet`);

  console.log('Winning games');
  const r1 = play(50, [{ a: ann, score: 90 }, { a: bob, score: 60 }, { a: cat, score: 40 }, { a: null, score: 10 }]);
  const annNet = r1.results[0].net;
  ok(annNet > 0, `Ann wins ${annNet} EB beyond her buy-in`);
  let d = A.leaderboard('day', bob);
  ok(d.top.length === 1 && d.top[0].username === 'Ann' && d.top[0].eb === annNet && d.top[0].rank === 1, 'today: Ann is #1 with what she won');
  ok(d.me === null, 'Bob broke even (2nd gets the buy-in back): not on the board');
  ok(!d.top.some(x => x.username === 'Cat'), 'Cat lost: not on the board');
  play(50, [{ a: bob, score: 90 }, { a: ann, score: 20 }, { a: cat, score: 10 }, { a: null, score: 50 }]);
  d = A.leaderboard('day', ann);
  ok(d.top.length === 2 && d.top.some(x => x.username === 'Bob'), 'Bob joins the board after his win');
  ok(d.top.every((x, i) => !i || x.eb <= d.top[i - 1].eb), 'highest first');
  ok(d.me && d.me.username === 'Ann', 'your own rank comes back too');

  console.log("What doesn't count");
  const before = A.leaderboard('all', ann).me.eb;
  A.creditPurchase({ sessionId: 'cs_test_1', accountId: ann.id, packId: 'p1', amount: 499, currency: 'usd', packs: [{ id: 'p1', cents: 499, eb: 1000 }], livemode: false });
  A.sendMail(ann, 'gift', 5000, 'A gift'); A.openMail(ann, 'all');
  play(50, [{ a: bob, score: 99 }, { a: cat, score: 1 }, { a: null, score: 0 }, { a: null, score: 0 }]); // someone else wins (rebuilds the boards)
  ok(A.leaderboard('all', ann).me.eb === before && A.leaderboard('day', ann).me.eb === before, 'purchased and gifted Eco-bucks are not counted');
  const free = play(0, [{ a: cat, score: 99 }, { a: bob, score: 1 }, { a: null, score: 0 }, { a: null, score: 0 }]);
  ok(free.results[0].net === 0 && !A.leaderboard('day', cat).me, 'winning a free table earns nothing');

  console.log('Periods');
  ann.earned.day = '2000-01-01'; ann.earned.month = '2000-01'; // as if her earnings were from long ago
  play(50, [{ a: cat, score: 99 }, { a: bob, score: 1 }, { a: null, score: 0 }, { a: null, score: 0 }]); // (clears the cache)
  ok(!A.leaderboard('day', ann).me && !A.leaderboard('month', ann).me, "yesterday's and last month's earnings don't count today");
  ok(A.leaderboard('all', ann).me.eb === before, 'but they still count for all time');
  const lbDay = A.leaderboard('day', cat);
  ok(lbDay.resetsAt > Date.now() && lbDay.resetsAt - Date.now() <= 864e5, 'the daily board says when it starts again (next midnight UTC)');
  ok(A.leaderboard('all', cat).resetsAt === null, 'all time never resets');
  let err = ''; try { A.leaderboard('week', ann); } catch (e) { err = e.message; }
  ok(/Unknown/.test(err), 'an unknown period is refused');

  console.log('Ties share a rank');
  const x = A.leaderboard('all', ann).top;
  ok(x.every((r, i) => !i || (r.eb === x[i - 1].eb ? r.rank === x[i - 1].rank : r.rank === i + 1)), 'equal totals have equal ranks');

  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll leaderboard checks passed.');
  process.exit(fails ? 1 : 0);
})();
