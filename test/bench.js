// Bot strength check: one logic-engine bot ("smart") against tables of the old quick-policy bots.
// usage: node test/bench.js [games] [--dis] [--partners]
const G = require('../game.js');
const N = +process.argv[2] || 60;
const dis = process.argv.includes('--dis'), partners = process.argv.includes('--partners');
let won = 0, expected = 0, games = 0, decisions = 0, ms = 0, worst = 0;
const bySize = {};
for (let g = 0; g < N; g++) {
  const n = partners ? (g % 2 ? 4 : 6) : 2 + (g % 5);
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, team: partners ? i % (n / 2) : null });
  // smart: seat p0 (and its partner in partner mode)
  for (const pl of s.players) pl.simple = partners ? pl.team !== 0 : pl.id !== 'p0';
  G.startGame(s, { disruptions: dis, partners });
  let guard = 0;
  while (s.phase !== 'ended') {
    if (++guard > 8000) throw new Error('stuck ' + s.phase);
    const p = G.waitingOn(s);
    if (p < 0) { G.autoBots(s); continue; }
    const t0 = Date.now();
    const a = G.botAction(s, p);
    const dt = Date.now() - t0;
    if (!s.players[p].simple) { decisions++; ms += dt; worst = Math.max(worst, dt); }
    G.applyAction(s, p, a);
  }
  games++;
  const smartSeats = s.players.map((pl, k) => pl.simple ? -1 : k).filter(k => k >= 0);
  const w = s.results.winners.some(k => smartSeats.includes(k)) ? 1 / (partners ? 1 : s.results.winners.length) : 0;
  won += w; expected += partners ? 1 / (n / 2) : 1 / n;
  const b = bySize[n] = bySize[n] || { games: 0, won: 0 }; b.games++; b.won += w;
}
console.log(`${games} games${dis ? ' with Disruptions' : ''}${partners ? ' (partners)' : ''}: engine won ${(100 * won / games).toFixed(0)}% (a bot of equal strength: ${(100 * expected / games).toFixed(0)}%)`);
console.log(Object.entries(bySize).map(([n, b]) => `${n}p ${(100 * b.won / b.games).toFixed(0)}% of ${b.games}`).join(' | '));
console.log(`decision time: avg ${(ms / decisions).toFixed(1)} ms, worst ${worst} ms`);
