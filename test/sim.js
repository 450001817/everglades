const G = require('../game.js');
const { CARDS } = require('../public/data.js');
let games = 0, crises = 0, unmatched = 0, tricks = 0; const wins = {};
for (let g = 0; g < 500; g++) {
  const n = 2 + (g % 5);
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true });
  G.startGame(s);
  let guard = 0;
  while (s.phase !== 'ended') {
    if (++guard > 5000) throw new Error('stuck ' + JSON.stringify(s.step) + s.phase);
    const p = G.waitingOn(s);
    // sometimes try abilities
    if (s.phase === 'play' && !s.step && !s.abilityUsed && Math.random() < 0.3) {
      const pl = s.players[p];
      try {
        if (pl.role === 'LandDeveloper') { const r = Object.keys(s.board).find(r => s.board[r].i > 0); if (r) G.applyAction(s, p, { type: 'ability', region: r, kind: 'i' }); }
        else if (pl.role === 'Tourist') G.applyAction(s, p, { type: 'ability' });
        else if (pl.role === 'Researcher' && pl.pile.length) G.applyAction(s, p, { type: 'ability', handCard: pl.hand[0], pileCard: pl.pile[0] });
      } catch (e) { if (!e.userError) throw e; }
    }
    const a = G.botAction(s, p);
    G.applyAction(s, p, a);
    if (s.lastTrick && s.lastTrick.round !== undefined && a.type) {}
    for (const r in s.board) if (s.board[r].n < 0 || s.board[r].i < 0) throw new Error('negative');
  }
  games++;
  const total = s.players.reduce((a, p) => a + p.pile.length, 0) + s.discard.length;
  if (total !== 45) throw new Error('card count ' + total);
  s.results.scores.forEach(r => { if (s.results.winners.includes(r.p)) wins[r.role] = (wins[r.role] || 0) + 1; });
  crises += s.log.filter(l => l.startsWith('INVASIVE')).length;
  unmatched += s.log.filter(l => l.includes('no card matched')).length;
  tricks += s.players.reduce((a, p) => a + p.biomesWon.length, 0);
}
console.log({ games, tricks, crises, unmatched, wins });
