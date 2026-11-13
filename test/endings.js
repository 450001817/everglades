// Plays many bot games (solo and co-op) and checks that every player gets a complete ending,
// then prints how often each ending variant comes up.  Run: node test/endings.js
const G = require('../game.js');
const { ENDINGS, ANACONDA_ENDINGS } = require('../endings.js');
const seen = {};
const count = (role, side, title) => { const k = `${role} ${side} — ${title}`; seen[k] = (seen[k] || 0) + 1; };
function check(e, where) {
  if (!e || !e.title || !e.text || !e.condition) throw new Error('incomplete ending at ' + where + ': ' + JSON.stringify(e));
  if (/undefined|NaN|\$\{|\[object/.test(e.text)) throw new Error('bad text at ' + where + ': ' + e.text);
}
for (let g = 0; g < 1500; g++) {
  const n = 2 + (g % 5), coop = g % 4 === 0;
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true });
  G.startGame(s, { coop });
  let guard = 0;
  while (s.phase !== 'ended') { if (++guard > 6000) throw new Error('stuck'); const p = G.waitingOn(s); G.applyAction(s, p, G.botAction(s, p)); }
  for (const r of s.results.scores) { check(r.ending, r.role); count(r.role, r.good ? 'good' : 'grim', r.ending.title); }
  if (coop) { check(s.results.coopEnding, 'coop'); check(s.results.bossEnding, 'boss'); count('Anaconda', s.results.bossEnding.good ? 'good' : 'grim', s.results.bossEnding.title); }
}
// every written variant, and whether simulated games ever reached it
const all = [];
for (const [role, sides] of Object.entries(ENDINGS)) for (const side of ['good', 'grim']) for (const v of sides[side]) all.push(`${role} ${side} — ${v.title}`);
for (const side of ['good', 'grim']) for (const v of ANACONDA_ENDINGS[side]) all.push(`Anaconda ${side} — ${v.title}`);
for (const k of all) console.log(String(seen[k] || 0).padStart(5), k);
const never = all.filter(k => !seen[k]);
console.log(never.length ? `\n${never.length} variant(s) never came up in simulated bot games (they may still happen with people).` : '\nEvery variant came up at least once.');
