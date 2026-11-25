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

console.log('Conservationist and Researcher (Nov 23, 2026)');
{
  const s = game(['Conservationist', 'Researcher', 'Fisherman']);
  ok(line(G.computeResults(s), 0, /Never triggered/).pts === 5, 'Conservationist: never triggering a Crisis is worth 5');
  s.players[1].stats.crises = 0; s.players[2].stats.crises = 0;
  ok(line(G.computeResults(s), 1, /fewest Invasive Crises/).pts === 10, 'Researcher: tied for the fewest Crises (0): 10 points');
  s.players[1].stats.crises = 1;
  ok(line(G.computeResults(s), 1, /fewest Invasive Crises/).pts === 0, 'Researcher: more Crises than someone: no points');
  ok(!G.computeResults(s)[1].lines.some(l => /Fewest tricks/.test(l.label)), 'Researcher: no "fewest tricks" goal any more');
  // the swap: the pile card must have a lower Impact than the hand card
  const { CARDS } = require('../public/data.js');
  const ids = Object.keys(CARDS).sort((a, b) => CARDS[a].impact - CARDS[b].impact);
  const lo = ids[0], hi = ids[ids.length - 1];
  const pl = s.players[1];
  s.phase = 'play'; s.step = null; s.turn = 1; s.abilityUsed = false;
  pl.hand = [lo]; pl.pile = [hi];
  throws(() => G.applyAction(s, 1, { type: 'ability', handCard: lo, pileCard: hi }), 'Researcher: taking back a higher-Impact card is refused');
  pl.hand = [hi]; pl.pile = [lo];
  G.applyAction(s, 1, { type: 'ability', handCard: hi, pileCard: lo });
  ok(pl.hand[0] === lo && pl.pile[0] === hi, 'Researcher: taking back a lower-Impact card works');
}

console.log('Fisherman (Nov 24, 2026): 15 for 25+ population in objective regions, 10 for the most Water tricks');
{
  const s = game(['Fisherman', 'Hunter', 'Researcher']);
  const objs = Object.keys(ROLES.Fisherman.map);
  for (const r of Object.keys(s.board)) s.board[r] = { n: 0, i: 0 };
  objs.forEach((r, k) => { s.board[r] = { n: k === 0 ? 5 : 4, i: 0 }; }); // 21 in the objective regions
  let res = G.computeResults(s);
  ok(line(res, 0, /25\+ population/).pts === 0, 'under 25 population: no points');
  s.board[objs[0]].i = 4; // 25
  res = G.computeResults(s);
  ok(line(res, 0, /25\+ population/).pts === 15, '25 population (Native or Invasive): 15 points');
  ok(line(res, 1, /25\+ population/).pts === 0 && ROLES.Hunter.popPts === 15, "the Hunter's own goal is unchanged");
  const water = Object.keys(BIOMES).filter(id => BIOMES[id].suit === 'Water'), land = Object.keys(BIOMES).filter(id => BIOMES[id].suit === 'Land');
  ok(line(res, 0, /Most tricks from Water/).pts === 0, 'no Water tricks: no points');
  s.players[0].biomesWon = [water[0], water[1]]; s.players[2].biomesWon = [water[2]];
  ok(line(G.computeResults(s), 0, /Most tricks from Water/).pts === 10, 'the most Water tricks: 10 points');
  s.players[2].biomesWon = [water[2], water[3]];
  ok(line(G.computeResults(s), 0, /Most tricks from Water/).pts === 10, 'tied for the most: still 10');
  s.players[2].biomesWon = [water[2], water[3], water[4]];
  ok(line(G.computeResults(s), 0, /Most tricks from Water/).pts === 0, 'someone won more Water tricks: no points');
  s.players[1].biomesWon = [land[0]];
  ok(line(G.computeResults(s), 1, /Most tricks from Land/).pts === 15, "the Hunter's most-Land-tricks goal is still 15");
}

console.log('Burn modifier: 1 card per player burned before the deal');
{
  const table = (n, opts) => { const s = G.newGame(); for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, simple: true }); G.startGame(s, opts); return s; };
  for (const n of [3, 4, 5, 6]) {
    const std = table(n, {}), burn = table(n, { burn: true });
    const h0 = std.players[0].hand.length, h1 = burn.players[0].hand.length;
    const all = burn.players.flatMap(p => p.hand).concat(burn.discard);
    ok(h1 === h0 - 1 && burn.players.every(p => p.hand.length === h1) && burn.burn && !std.burn,
      `${n} players: hands of ${h1} instead of ${h0}`);
    ok(all.length === new Set(all).size && burn.discard.length >= n, `${n} players: the ${n} burned cards are set aside unseen, no card dealt twice`);
  }
  const co = table(4, { coop: true }), cob = table(4, { coop: true, burn: true });
  ok(cob.players[0].hand.length === co.players[0].hand.length - 1 && cob.players[cob.bossIdx].hand.length === co.players[co.bossIdx].hand.length,
    'co-op: players hold 1 Native card fewer; the Anaconda\'s deck is unchanged');
  // a burned game plays to the end
  const s = table(4, { burn: true }); let guard = 0;
  while (s.phase !== 'ended' && guard++ < 5000) { const p = G.waitingOn(s); if (p < 0) G.autoBots(s); else G.applyAction(s, p, G.botAction(s, p)); }
  ok(s.phase === 'ended', 'a game with burned cards plays through to the end');
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll role checks passed.');
process.exit(fails ? 1 : 0);
