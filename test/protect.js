// The Conservationist's ability: once each round she may stop any 1 Invasive card (hers or anyone else's) from
// populating.  Run: node test/protect.js
'use strict';
const G = require('../game.js');
const { CARDS, BIOMES } = require('../public/data.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };
const throws = (fn, msg) => { try { fn(); ok(false, msg); } catch (e) { ok(!!e.userError, `${msg} (${e.message})`); } };
const id = name => Object.values(CARDS).find(c => c.name === name).id;
const PARAKEET = id('Monk Parakeet'), RAT = id('Black Rat'), PYTHON = id('Burmese Python');

// A 4-player game with a Conservationist, played by bots up to the first card of a trick that she does NOT lead
// (so someone plays before her). Every seat is given the test cards.
function setup() {
  for (let tries = 0; tries < 300; tries++) {
    const s = G.newGame();
    for (let i = 0; i < 4; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, simple: true });
    G.startGame(s);
    for (let guard = 0; guard < 500 && !(s.phase === 'play' && !s.step && s.trick && s.trick.plays.length === 0); guard++) {
      const p = G.waitingOn(s); G.applyAction(s, p, G.botAction(s, p));
    }
    const cons = s.players.findIndex(pl => pl.role === 'Conservationist');
    if (cons < 0 || s.turn === cons) continue;
    for (const pl of s.players) pl.hand.push(PARAKEET, RAT, PYTHON);
    const region = BIOMES[s.trick.biome].region;
    s.board[region] = { n: 3, i: 0 };
    return { s, cons, region };
  }
  throw new Error('could not set up');
}
const tokens = (s, r) => s.board[r].n + s.board[r].i;

// someone else's Invasive card: play waits on the Conservationist
{
  const { s, cons, region } = setup();
  const p = s.turn, before = tokens(s, region);
  G.applyAction(s, p, { type: 'play', card: PARAKEET });
  ok(s.step && s.step.type === 'protect' && s.step.p === cons && s.step.by === p, 'an Invasive card asks the Conservationist');
  ok(G.waitingOn(s) === cons, 'the game waits on the Conservationist, not the player whose turn it is');
  ok(tokens(s, region) === before, 'no tokens arrive while she decides');
  throws(() => G.applyAction(s, p, { type: 'protect', block: true }), 'only the Conservationist can answer');
  G.applyAction(s, cons, { type: 'protect', block: true });
  ok(tokens(s, region) === before, 'blocked: the card adds no tokens');
  ok(s.trick.shield && s.trick.shield.card === PARAKEET, 'the block is used up for the round');
  ok(s.turn !== p && !s.step, 'play moves on to the next player');
  ok(s.trick.plays.some(x => x.card === PARAKEET), 'the blocked card still counts in the trick');
  // a second Invasive card this round: no question asked, it populates
  if (s.turn !== cons) {
    const q = s.turn, r0 = s.board[region].i;
    G.applyAction(s, q, { type: 'play', card: RAT });
    ok(!s.step || s.step.type !== 'protect', 'only 1 block per round: the next Invasive card is not asked about');
    ok(s.board[region].i > r0 || (s.step && s.step.type === 'place'), 'and it populates');
  }
}

// letting one through keeps the block for later in the round; a predator still hunts first
{
  const { s, cons, region } = setup();
  const p = s.turn;
  G.applyAction(s, p, { type: 'play', card: PYTHON });
  G.applyAction(s, cons, { type: 'protect', block: false });
  ok(s.step && s.step.type === 'predate' && s.turn === p, 'let through: the python hunts as usual');
  ok(!s.trick.shield, 'the block is still available');
}

// her own Invasive card: decided as she plays it, and only once per round
{
  const { s, cons, region } = setup();
  s.turn = cons; s.trick.pos = 0; s.trick.seq = [cons, ...s.trick.seq.filter(k => k !== cons)]; // she plays first this round
  const before = tokens(s, region);
  G.applyAction(s, cons, { type: 'play', card: PARAKEET, populate: false });
  ok(tokens(s, region) === before && s.trick.shield && s.trick.shield.p === cons, "her own card, Don't populate: blocked and the block is used");
  const q = s.turn;
  G.applyAction(s, q, { type: 'play', card: RAT });
  ok(!s.step || s.step.type !== 'protect', "after that, other players' Invasive cards aren't asked about this round");
}
{
  const { s, cons, region } = setup();
  s.turn = cons; s.trick.pos = 0; s.trick.seq = [cons, ...s.trick.seq.filter(k => k !== cons)];
  const before = tokens(s, region);
  G.applyAction(s, cons, { type: 'play', card: PARAKEET });
  ok(tokens(s, region) > before || (s.step && s.step.type === 'place'), 'her own card played normally populates (no question asked)');
}
{
  const { s, cons } = setup();
  s.trick.shield = { p: cons, card: RAT };
  s.turn = cons; s.trick.pos = s.trick.seq.indexOf(cons);
  throws(() => G.applyAction(s, cons, { type: 'play', card: PARAKEET, populate: false }), 'a second block in the same round is refused');
}

// co-op: the Anaconda's Invasive cards can be stopped too
{
  let asked = false, bossPlays = 0;
  for (let tries = 0; tries < 60 && !asked; tries++) { // until a game where a bot picked the Conservationist
    const s = G.newGame();
    for (let i = 0; i < 3; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, simple: true });
    G.startGame(s, { coop: true });
    for (let guard = 0; guard < 3000 && s.phase !== 'ended'; guard++) {
      if (s.step && s.step.type === 'protect' && s.step.by === s.bossIdx) asked = true;
      if (s.phase === 'play' && s.turn === s.bossIdx) bossPlays++;
      const p = G.waitingOn(s); if (p < 0) G.autoBots(s); else G.applyAction(s, p, G.botAction(s, p));
    }
  }
  ok(bossPlays > 0 && asked, "co-op: the Conservationist is asked about the Anaconda's cards");
}

// whole games still finish, with smart and quick bots, classic / partners / co-op / Disruptions
for (const opts of [{}, { partners: true }, { coop: true }, { disruptions: true }]) {
  const s = G.newGame();
  for (let i = 0; i < 4; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, simple: i % 2 === 1, team: opts.partners ? i % 2 : null });
  G.startGame(s, opts);
  let guard = 0;
  while (s.phase !== 'ended' && guard++ < 8000) { const p = G.waitingOn(s); if (p < 0) G.autoBots(s); else G.applyAction(s, p, G.botAction(s, p)); }
  ok(s.phase === 'ended', `a full ${Object.keys(opts)[0] || 'classic'} game finishes`);
}

console.log(fails ? `${fails} check(s) FAILED` : 'All protect checks passed.');
process.exit(fails ? 1 : 0);
