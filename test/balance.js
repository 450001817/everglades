// Character balance check: all-bot classic games (logic-engine bots), win rate and average score per character.
// usage: node test/balance.js [games] [--dis]      (BOT_BUDGET=150 speeds it up)
'use strict';
const G = require('../game.js');
const { ROLES } = require('../public/data.js');
const N = +process.argv[2] || 60, dis = process.argv.includes('--dis');
// try other Conservationist numbers without editing data.js: CONS_MAP=12 CONS_MAJ=15 CONS_CRISIS=20 node test/balance.js
const C = ROLES.Conservationist;
if (process.env.CONS_MAP) C.mapPts = +process.env.CONS_MAP;
if (process.env.CONS_MAJ) C.majorityPts = +process.env.CONS_MAJ;
if (process.env.CONS_CRISIS) C.noCrisisPts = +process.env.CONS_CRISIS;
console.log(`Conservationist: ${C.mapPts}/objective, ${C.majorityPts} majority, ${C.noCrisisPts} no crisis`);
const R = {}; let fairSum = 0;
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const n = 3 + (g % 3); // 3, 4 and 5 players
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true });
  G.startGame(s, { disruptions: dis });
  for (let guard = 0; s.phase !== 'ended'; guard++) {
    if (guard > 8000) throw new Error('stuck ' + s.phase);
    const p = G.waitingOn(s);
    if (p < 0) G.autoBots(s); else G.applyAction(s, p, G.botAction(s, p));
  }
  for (const sc of s.results.scores) {
    const r = R[sc.role] = R[sc.role] || { seats: 0, wins: 0, fair: 0, pts: 0, blocks: 0 };
    r.seats++; r.fair += 1 / n; r.pts += sc.total;
    if (s.results.winners.includes(sc.p)) r.wins += 1;
    r.blocks += s.players[sc.p].stats.refused;
  }
}
console.log(`${N} games${dis ? ' with Disruptions' : ''} (3-5 players), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const [role, r] of Object.entries(R).sort((a, b) => b[1].wins / b[1].seats - a[1].wins / a[1].seats)) {
  console.log(`${ROLES[role].name.padEnd(16)} seats ${String(r.seats).padStart(4)}  win ${(100 * r.wins / r.seats).toFixed(0).padStart(3)}% (fair ${(100 * r.fair / r.seats).toFixed(0)}%)  avg ${(r.pts / r.seats).toFixed(1).padStart(5)} pts` +
    (r.blocks ? `  blocks/game ${(r.blocks / r.seats).toFixed(2)}` : ''));
}
