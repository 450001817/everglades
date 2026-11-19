// Role rule changes (Nov 2026): Land Developer (2 empty regions; the most Invasive Crises) and Tourist (top 2
// Travel cards, 1 to the bottom; 1+ population in each objective region; no tricks won outside them).
// Run: node test/roles.js
'use strict';
const G = require('../game.js');
const { BIOMES, ROLES } = require('../public/data.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const throws = (fn, msg) => { try { fn(); ok(false, msg); } catch (e) { ok(!!e.userError, `${msg} (${e.message})`); } };

// a 3-player game with set roles, played up to the first card of round 1
function game(roles) {
  const s = G.newGame();
  roles.forEach((r, i) => G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, simple: true }));
  G.startGame(s);
  roles.forEach((r, i) => { s.players[i].role = r; });
  return s;
}
const line = (res, p, re) => res[p].lines.find(l => re.test(l.label));
const empty = s => { for (const r of Object.keys(s.board)) s.board[r] = { n: 1, i: 1 }; };

console.log('Land Developer');
{
  const s = game(['LandDeveloper', 'Fisherman', 'Researcher']);
  empty(s);
  s.board.FSP = { n: 0, i: 0 };
  let res = G.computeResults(s);
  ok(line(res, 0, /No population/).pts === 0, '1 empty region: no points');
  s.board.LO = { n: 0, i: 0 };
  res = G.computeResults(s);
  ok(line(res, 0, /No population/).pts === ROLES.LandDeveloper.emptyPts, '2 empty regions: 15 points');
  ok(line(res, 0, /Invasive Crises/).pts === 0, 'no Crises yet: no Crisis points');
  s.players[0].stats.crises = 2; s.players[1].stats.crises = 1;
  res = G.computeResults(s);
  ok(line(res, 0, /Invasive Crises/).pts === 10, 'the most Crises: 10 points');
  s.players[1].stats.crises = 2;
  ok(line(G.computeResults(s), 0, /Invasive Crises/).pts === 10, 'tied for the most: still 10');
  s.players[2].stats.crises = 3;
  ok(line(G.computeResults(s), 0, /Invasive Crises/).pts === 0, 'someone triggered more: no points');
  ok(!G.computeResults(s)[0].lines.some(l => /tricks \(/i.test(l.label) && /Most/.test(l.label)), 'no "most tricks" goal any more');
}

console.log('Tourist: scoring');
{
  const s = game(['Tourist', 'Fisherman', 'Researcher']);
  const T = ROLES.Tourist, objs = Object.keys(T.map);
  empty(s);
  let res = G.computeResults(s);
  ok(line(res, 0, /At least 1 population/).pts === 10, 'population in every objective region: 10 points');
  s.board[objs[1]] = { n: 0, i: 0 };
  ok(line(G.computeResults(s), 0, /At least 1 population/).pts === 0, 'one objective region empty: no points');
  ok(line(G.computeResults(s), 0, /No tricks won outside/).pts === 20, 'no tricks won at all: the 20 points count');
  const inObj = Object.keys(BIOMES).find(id => T.map[BIOMES[id].region]), outObj = Object.keys(BIOMES).find(id => !T.map[BIOMES[id].region]);
  s.players[0].biomesWon = [inObj];
  ok(line(G.computeResults(s), 0, /No tricks won outside/).pts === 20, 'only tricks in objective regions: 20 points');
  s.players[0].biomesWon = [inObj, outObj];
  ok(line(G.computeResults(s), 0, /No tricks won outside/).pts === 0, 'a trick outside: no points');
}

console.log('Tourist: the ability (top 2 Travel cards, 1 to the bottom)');
{
  let s;
  for (let tries = 0; tries < 200; tries++) { // play until it's the Tourist's turn to play a card
    s = game(['Tourist', 'Fisherman', 'Researcher']);
    s.phase = 'choose'; s.draftTurn = 99;
    for (let g = 0; g < 50 && !(s.phase === 'play' && s.turn === 0 && !s.step); g++) { const p = G.waitingOn(s); G.applyAction(s, p, G.botAction(s, p)); if (s.phase === 'play' && s.turn === 0) break; }
    if (s.phase === 'play' && s.turn === 0 && !s.step && s.biomeDeck.length > 2) break;
  }
  const [a, b, c] = s.biomeDeck;
  G.applyAction(s, 0, { type: 'ability' });
  ok(Array.isArray(s.tourPeek) && s.tourPeek[0] === a && s.tourPeek[1] === b, 'shows the top 2 cards');
  throws(() => G.applyAction(s, 0, { type: 'tourDecide', bottom: c }), 'a card that was not shown is refused');
  G.applyAction(s, 0, { type: 'tourDecide', bottom: a });
  ok(s.biomeDeck[0] === b && s.biomeDeck[s.biomeDeck.length - 1] === a && !s.tourPeek, 'the chosen card goes to the bottom, the other stays on top');
  throws(() => G.applyAction(s, 0, { type: 'ability' }), 'once per turn');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll role checks passed.');
process.exit(fails ? 1 : 0);
