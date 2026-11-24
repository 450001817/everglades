// Easy bots (new players' first games): they must always play legally, and be clearly easier to beat than the
// standard bots. Seat 0 stands in for the human: a weak player (the quick policy) and a decent one (the standard
// engine), each against 3 standard bots and against 3 easy bots, in 4-player classic games.
// usage: node test/easybots.js [games per matchup]      (BOT_BUDGET=150 speeds it up)
'use strict';
const G = require('../game.js');
const N = +process.argv[2] || 40;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

function play(me, them, opts = {}) {
  const s = G.newGame();
  G.addPlayer(s, { id: 'p0', name: 'You', bot: true, simple: me === 'weak', easy: me === 'easy' });
  for (let i = 1; i < 4; i++) G.addPlayer(s, { id: 'p' + i, name: 'Bot' + i, bot: true, easy: them === 'easy' });
  G.startGame(s, opts);
  for (let guard = 0; s.phase !== 'ended'; guard++) {
    if (guard > 8000) throw new Error('stuck ' + s.phase);
    const p = G.waitingOn(s);
    if (p < 0) G.autoBots(s); else G.applyAction(s, p, G.botAction(s, p));
  }
  return s.results.winners.includes(s.players.findIndex(pl => pl.id === 'p0')); // (seats can be shuffled at the start)
}

console.log('Who is a new player (accounts.js isNewPlayer)');
{
  process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'eg-easy-'));
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const A = require('../accounts.js');
  const acct = (games, firsts) => ({ stats: { games, firsts } });
  ok(A.isNewPlayer(acct(0, 0)) && A.isNewPlayer(acct(2, 0)), 'the first 3 games are always easy');
  ok(!A.isNewPlayer(acct(3, 2)) && !A.isNewPlayer(acct(3, 3)), 'after 3 games with at most 1 loss: standard bots');
  ok(A.isNewPlayer(acct(3, 1)) && A.isNewPlayer(acct(4, 2)), 'lost 2 or more: easy bots stay on...');
  ok(!A.isNewPlayer(acct(5, 0)), '...up to 5 games');
  ok(!A.isNewPlayer(null), 'no account (a bot): not new');
ok(A.NEWBIE.maxMult === 1, 'tables up to a 1x multiplier');
}

console.log('Which bots go easy (game.js easyBotsFor)');
{
  const table = (opts, teams) => {
    const s = G.newGame();
    G.addPlayer(s, { id: 'new', name: 'New', team: teams ? 0 : null });
    G.addPlayer(s, { id: 'b1', name: 'B1', bot: true, team: teams ? 0 : null });
    G.addPlayer(s, { id: 'b2', name: 'B2', bot: true, team: teams ? 1 : null });
    G.addPlayer(s, { id: 'b3', name: 'B3', bot: true, team: teams ? 1 : null });
    G.startGame(s, opts);
    return s;
  };
  const easyIds = s => s.players.filter(p => p.easy).map(p => p.id).sort().join(',');
  let s = table({});
  ok(!G.easyBotsFor(s, []) && easyIds(s) === '', 'no new player: standard bots');
  s = table({}); G.easyBotsFor(s, ['new']);
  ok(easyIds(s) === 'b1,b2,b3' && s.easyBots, 'solo: every bot is easy, never the person');
  s = table({ partners: true }, true); G.easyBotsFor(s, ['new']);
  ok(easyIds(s) === 'b2,b3', "partners: the other team's bots are easy, the new player's partner isn't");
  s = table({ coop: true }); G.easyBotsFor(s, ['new']);
  ok(easyIds(s) === 'anaconda', 'co-op: only the Anaconda eases off; the teammates stay standard');
}

console.log('\nEasy bots always play legal moves (all-easy tables, every mode)');
let games = 0;
for (const opts of [{}, { disruptions: true }, { partners: true }, { coop: true }]) {
  for (let g = 0; g < 25; g++) {
    const s = G.newGame();
    for (let i = 0; i < 4; i++) G.addPlayer(s, { id: 'p' + i, name: 'E' + i, bot: true, team: opts.partners ? i % 2 : null });
    G.startGame(s, opts);
    for (const pl of s.players) pl.easy = true;
    for (let guard = 0; s.phase !== 'ended'; guard++) {
      if (guard > 8000) throw new Error('stuck ' + s.phase);
      const p = G.waitingOn(s);
      if (p < 0) G.autoBots(s); else G.applyAction(s, p, G.botAction(s, p)); // applyAction throws on an illegal move
    }
    games++;
  }
}
ok(true, `${games} games finished without an illegal move`);

console.log(`\nHow often seat 0 wins a 4-player game (${N} games each; a fair share is 25%)`);
const rate = (me, them) => { let w = 0; for (let g = 0; g < N; g++) if (play(me, them)) w++; return w / N; };
const t0 = Date.now();
const weakStd = rate('weak', 'standard'), weakEasy = rate('weak', 'easy');
const goodStd = rate('good', 'standard'), goodEasy = rate('good', 'easy');
const pct = x => (100 * x).toFixed(0).padStart(3) + '%';
console.log(`  weak player   vs standard bots ${pct(weakStd)}   vs easy bots ${pct(weakEasy)}`);
console.log(`  decent player vs standard bots ${pct(goodStd)}   vs easy bots ${pct(goodEasy)}   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
ok(weakEasy > weakStd + 0.1, 'a weak player wins clearly more often against easy bots');
ok(goodEasy > goodStd + 0.1, 'so does a decent one');
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll easy-bot checks passed.');
process.exit(fails ? 1 : 0);
