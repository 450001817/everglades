// Co-op: the Anaconda always chooses the first biome; the first player in seat order still plays first.
// Run: node test/coopstart.js
'use strict';
const G = require('../game.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

for (const dis of [false, true]) for (const n of [1, 3, 6]) {
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, simple: true });
  G.startGame(s, { coop: true, disruptions: dis });
  for (let guard = 0; guard < 200 && s.phase !== 'choose'; guard++) { const p = G.waitingOn(s); G.applyAction(s, p, G.botAction(s, p)); }
  const tag = `${n} player${n > 1 ? 's' : ''}${dis ? ', Disruptions on' : ''}`;
  ok(s.phase === 'choose' && s.leader === s.bossIdx && G.waitingOn(s) === s.bossIdx, `${tag}: the Anaconda chooses the first biome`);
  const p = G.waitingOn(s); G.applyAction(s, p, G.botAction(s, p));
  ok(s.trick && s.trick.seq[0] === 0, `${tag}: player 1 plays first`);
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll co-op start checks passed.');
process.exit(fails ? 1 : 0);
