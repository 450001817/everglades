// Co-op balance check: bot players vs the Anaconda at every player count.
const G = require('../game.js');
const N = +process.argv[2] || 400;
for (let n = 1; n <= 6; n++) {
  let pw = 0, sumP = 0, sumA = 0, parts = { unmet: 0, inf: 0, tricks: 0 }, ptricks = 0, rounds = 0, left = 0;
  for (let g = 0; g < N; g++) {
    const s = G.newGame();
    for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true });
    G.startGame(s, { coop: true });
    let guard = 0;
    while (s.phase !== 'ended') {
      if (++guard > 5000) throw new Error('stuck');
      const p = G.waitingOn(s); G.applyAction(s, p, G.botAction(s, p));
    }
    const R = s.results;
    if (R.playersWin) pw++;
    sumP += R.playersTotal; sumA += R.anaconda.total;
    parts.unmet += R.anaconda.lines[0].pts; parts.inf += R.anaconda.lines[1].pts; parts.tricks += R.anaconda.lines[2].pts;
    ptricks += s.players.slice(0, n).reduce((a, p) => a + p.biomesWon.length, 0);
    rounds += s.round; left += s.players.slice(0, n).reduce((a, p) => a + p.hand.length, 0);
    if (s.players.slice(0, n).some(p => p.hand.length === 0)) throw new Error('a player ran out of cards');
  }
  const f = x => (x / N).toFixed(1);
  console.log(`n=${n}  players win ${(100 * pw / N).toFixed(0)}%  | players avg ${f(sumP)}  anaconda avg ${f(sumA)} (unmet ${f(parts.unmet)}, infest ${f(parts.inf)}, tricks ${f(parts.tricks)}) | rounds ${f(rounds)} player tricks ${f(ptricks)} cards left ${f(left)}`);
}
