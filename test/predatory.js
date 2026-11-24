// Checks the Predatory order: a predator hunts first (removing tokens from the region it is played in),
// and only after the hunt are its own tokens added.  Run: node test/predatory.js
const G = require('../game.js');
const { CARDS, BIOMES } = require('../public/data.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

// Play bot moves until someone is about to play the first card of a trick, then hand them `cardId`.
// Retries with new games until that card is legal there (Invasive cards always are; Native ones must match the biome).
function setup(cardId, board) {
  for (let tries = 0; tries < 200; tries++) {
    const s = G.newGame();
    for (let i = 0; i < 4; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true });
    G.startGame(s);
    for (let guard = 0; guard < 500; guard++) {
      if (s.phase === 'play' && !s.step && s.trick && s.trick.plays.length === 0) break;
      const p = G.waitingOn(s); G.applyAction(s, p, G.botAction(s, p));
    }
    const p = s.turn, region = BIOMES[s.trick.biome].region;
    s.players[p].hand.push(cardId);
    if (!G.legalCards(s, p).includes(cardId)) continue;
    Object.assign(s.board[region], board);
    return { s, p, region };
  }
  throw new Error('could not set up a legal play for ' + cardId);
}
const id = name => Object.values(CARDS).find(c => c.name === name).id;

// Florida Panther: Native, Predatory 3, 1 token
{
  const c = CARDS[id('Florida Panther')];
  const { s, p, region } = setup(c.id, { n: 3, i: 2 });
  G.applyAction(s, p, { type: 'play', card: c.id });
  ok(s.step && s.step.type === 'predate' && s.step.regions[0] === region, 'playing a predator starts the hunt in the trick region');
  ok(s.board[region].n === 3 && s.board[region].i === 2, "the predator's own token is NOT on the board during the hunt");
  G.applyAction(s, p, { type: 'predate', region, kind: 'i' });
  G.applyAction(s, p, { type: 'predate', region, kind: 'i' });
  ok(s.board[region].i === 0 && s.board[region].n === 3, 'hunting removed the 2 Invasive tokens');
  G.applyAction(s, p, { type: 'predate', region, kind: 'n' });
  ok(!s.step || s.step.type !== 'predate', 'the hunt ends after Predatory 3 removals');
  ok(s.board[region].n === 2 + c.pop, `then the card's own ${c.pop} Native token arrives (2 left + ${c.pop})`);
}

// Stopping early with Done still adds the card's tokens
{
  const c = CARDS[id('Burmese Python')];
  const { s, p, region } = setup(c.id, { n: 4, i: 0 });
  G.applyAction(s, p, { type: 'play', card: c.id });
  // a Conservationist at the table may be asked whether to stop this Invasive card: she lets it through
  if (s.step && s.step.type === 'protect') G.applyAction(s, s.step.p, { type: 'protect', block: false });
  G.applyAction(s, p, { type: 'predate', region, kind: 'n' });
  G.applyAction(s, p, { type: 'predateDone' });
  ok(s.board[region].n === 3 && s.board[region].i === c.pop, `Done after 1 removal: 3 Natives left, then ${c.pop} Invasive tokens added`);
}

// An empty region: nothing to hunt, the tokens go straight down
{
  const c = CARDS[id('Florida Panther')];
  const { s, p, region } = setup(c.id, { n: 0, i: 0 });
  G.applyAction(s, p, { type: 'play', card: c.id });
  ok((!s.step || s.step.type !== 'predate') && s.board[region].n === c.pop, 'empty region: no hunt, the token is placed right away');
}

// Great Barracuda (Predatory + Migratory): hunts in the trick region first, then spreads
{
  const c = CARDS[id('Great Barracuda')];
  const { s, p, region } = setup(c.id, { n: 1, i: 3 });
  G.applyAction(s, p, { type: 'play', card: c.id });
  ok(s.step && s.step.type === 'predate', 'Barracuda hunts first');
  G.applyAction(s, p, { type: 'predateDone' });
  ok(s.step && s.step.type === 'place' && s.step.left === c.pop, 'then it spreads its Migratory tokens');
}

// Keystone is static for the whole trick: when the LAST card's hunt removes Native tokens, the trick is judged with
// the Risk those tokens leave behind (a bug judged it with the Risk from before that hunt).
// The trick from a real game: Tropical Resort (Florida Keys, Land, Risk 18).
{
  const { s } = setup('GreenAnaconda', {});
  const T = s.trick, [a, b, c, d] = T.seq;
  Object.assign(T, { biome: 'FKTropicalResort', suit: 'Land', baseRisk: 18, risk: 18, keystones: 0 });
  s.board.FK = { n: 0, i: 0 };
  s.players.forEach(pl => { pl.role = 'Tourist'; }); // (no Conservationist pausing play)
  const play = (p, card) => { s.players[p].hand.push(card); G.applyAction(s, p, { type: 'play', card }); };
  play(a, 'GreenAnaconda');                                        // nothing to hunt; adds 1 Invasive
  play(b, 'FloridaPanther');                                       // Keystone: hunts the Invasive, adds 1 Native
  G.applyAction(s, b, { type: 'predate', region: 'FK', kind: 'i' });
  ok(s.trick.risk === 17, `with 1 Native token in the Keys the Keystone Risk is 17 (${s.trick.risk})`);
  play(c, 'WildBoar'); G.applyAction(s, c, { type: 'predateDone' });
  const wonBefore = s.players[a].biomesWon.length;
  play(d, 'AsianSwampEel');                                        // last card: eats the only Native token
  G.applyAction(s, d, { type: 'predate', region: 'FK', kind: 'n' });
  ok(s.board.FK.n === 0, 'the last card ate the only Native token');
  ok(s.players[a].biomesWon.length === wonBefore + 1 && s.players[d].biomesWon.slice(-1)[0] !== 'FKTropicalResort',
    'the Risk is back to 18, so Green Anaconda (Impact 18) matches and wins over Asian Swamp Eel (14)');
  ok(s.log.some(l => /Invasive Risk is now 18/.test(l)), 'the log says the Risk changed before the trick was judged');
}

console.log(fails ? `\n${fails} check(s) failed.` : '\nAll predatory checks passed.');
process.exit(fails ? 1 : 0);
