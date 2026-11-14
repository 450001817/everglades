// Checks the Disruptions match modifier and the static Keystone rule.
//  1. Hundreds of bot games with Disruptions on (solo, partners, co-op) must always finish, never go negative,
//     keep every card, and use every Disruption card.
//  2. Targeted checks of Keystone and of individual Disruption cards.
// Run: node test/disruptions.js
const G = require('../game.js');
const { CARDS, BIOMES, ADJ, DISRUPTIONS } = require('../public/data.js');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

// ---------- 1. bot games ----------
const used = {}; let games = 0, reveals = 0;
for (let g = 0; g < 600; g++) {
  const mode = g % 5 === 0 ? 'coop' : g % 5 === 1 ? 'partners' : 'solo';
  const n = mode === 'partners' ? (g % 2 ? 4 : 6) : mode === 'coop' ? 1 + (g % 6) : 2 + (g % 5);
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, team: mode === 'partners' ? i % (n / 2) : null });
  G.startGame(s, { coop: mode === 'coop', partners: mode === 'partners', disruptions: true });
  let guard = 0;
  while (s.phase !== 'ended') {
    if (++guard > 20000) throw new Error(`stuck in ${s.phase} ${JSON.stringify(s.step)}`);
    G.autoBots(s); // the simultaneous parts (bots decide instantly)
    const p = G.waitingOn(s);
    if (p < 0) { if (s.phase === 'ended') break; throw new Error('nobody to act in ' + s.phase); }
    G.applyAction(s, p, G.botAction(s, p));
    for (const r in s.board) if (s.board[r].n < 0 || s.board[r].i < 0) throw new Error('negative tokens');
    if (s.trick && (s.trick.risk < 0 || Number.isNaN(s.trick.risk))) throw new Error('bad risk');
  }
  games++;
  for (const l of s.log) { const m = /reveals (.+)!$/.exec(l); if (m) { used[m[1]] = (used[m[1]] || 0) + 1; reveals++; } }
  if (!s.coop) {
    const total = s.players.reduce((a, p) => a + p.pile.length, 0) + s.discard.length;
    if (total !== Object.keys(CARDS).length) throw new Error('card count ' + total);
  }
}
ok(games === 600, `${games} bot games with Disruptions finished (solo, partners, co-op)`);
const names = Object.values(DISRUPTIONS).map(d => d.name);
ok(names.every(nm => used[nm] > 0), `every Disruption card was revealed in play (${reveals} reveals, least used: ${Math.min(...names.map(nm => used[nm] || 0))})`);

// ---------- helpers for targeted checks ----------
// A 4-bot game paused at the start of a trick in `biomeId`, with optional disruption hands.
function trickAt(biomeId, opts = {}) {
  const s = G.newGame();
  for (let i = 0; i < 4; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: i > 0 });
  G.startGame(s, { disruptions: !!opts.dis }); s.players.forEach((pl, k) => { pl.bot = k > 0; }); // seats are shuffled: make seat 0 the human
  while (s.phase === 'draft') G.applyAction(s, s.draftTurn, G.botAction(s, s.draftTurn));
  if (s.phase === 'ddraft') { G.applyAction(s, 0, { type: 'draftDis', card: s.ddraft.packs[0][0] }); G.applyAction(s, 0, { type: 'draftDis', card: s.ddraft.packs[0][0] }); }
  for (const pl of s.players) pl.dis = [];
  if (opts.dis) s.players[0].dis = [opts.dis];
  s.leader = 0; s.travel[0] = biomeId;
  if (opts.board) Object.assign(s.board, JSON.parse(JSON.stringify(opts.board)));
  G.applyAction(s, 0, { type: 'chooseBiome', biome: biomeId });
  return s;
}
const biomeOf = (suit, region) => Object.keys(BIOMES).find(b => BIOMES[b].suit === suit && (!region || BIOMES[b].region === region));
const commitAll = (s, card) => { G.applyAction(s, 0, { type: 'commitDis', card }); G.autoBots(s); };

const plain = suit => Object.values(CARDS).find(c => c.kind === 'Native' && c.habitat === suit && !c.keystone && !c.predatory && !c.migratory && c.pop > 0);

// ---------- 2a. Keystone is static ----------
{
  const key = Object.values(CARDS).find(c => c.keystone && !c.predatory && !c.migratory);
  const s = trickAt(biomeOf(key.habitat));
  const reg = BIOMES[s.trick.biome].region, base = s.trick.baseRisk;
  s.board[reg] = { n: 1, i: 0 };
  s.players[0].hand.push(key.id);
  G.applyAction(s, 0, { type: 'play', card: key.id });
  const afterKey = s.trick.risk;
  ok(afterKey === Math.max(0, base - (1 + key.pop)), `Keystone ${key.name}: Risk ${base} -> ${afterKey} (1 native + its own ${key.pop})`);
  const follow = plain(key.habitat);
  const p1 = s.turn; s.players[p1].hand.push(follow.id);
  G.applyAction(s, p1, { type: 'play', card: follow.id });
  ok(s.trick.risk === Math.max(0, afterKey - follow.pop), `natives added after the Keystone keep lowering the Risk (${afterKey} -> ${s.trick.risk} after ${follow.name})`);
}

// ---------- 2b. Disruption cards ----------
const reveal = (id, suit, board, region) => { const s = trickAt(biomeOf(suit, region), { dis: id, board }); commitAll(s, id); return s; };
{
  const s = reveal('EcologicalProtest', 'Land');
  ok(s.phase === 'play' && s.trick.risk === 0 && s.trick.dis[0].card === 'EcologicalProtest', 'Ecological Protest: revealed, Risk becomes 0, then play begins');
}
{
  const s = reveal('TakeBribes', 'Land');
  ok(G.riskFor(s, 0) === s.trick.risk + 5 && G.riskFor(s, 1) === s.trick.risk, 'Take Bribes: +5 Risk for its owner only');
}
{
  const b = biomeOf('Water'); const reg = BIOMES[b].region;
  const s = reveal('FertilizerLeaching', 'Water', { [reg]: { n: 3, i: 2 } });
  ok(s.board[reg].n === 6 && s.board[reg].i === 4, 'Fertilizer Leaching doubles the tokens in the region');
}
{
  const reg = BIOMES[biomeOf('Land')].region;
  const s = reveal('WildFire', 'Land', { [reg]: { n: 3, i: 2 } });
  ok(s.board[reg].n === 0 && s.board[reg].i === 0 && s.trick.doubleNative, 'Wild Fire clears a Land region and doubles Natives played there');
  const c = plain(G.leadSuit(s)); const p = s.turn; s.players[p].hand.push(c.id);
  G.applyAction(s, p, { type: 'play', card: c.id });
  ok(s.board[reg].n === c.pop * 2, `...a ${c.name} (${c.pop} token) then adds ${c.pop * 2}`);
  const regW = BIOMES[biomeOf('Water')].region;
  const w = reveal('WildFire', 'Water', { [regW]: { n: 3, i: 2 } });
  ok(w.board[regW].n === 3, 'Wild Fire spares a Water region');
}
{
  const reg = BIOMES[biomeOf('Land')].region;
  const s = reveal('Flood', 'Land', { [reg]: { n: 3, i: 3 } });
  ok(G.leadSuit(s) === 'Wetland' && s.phase === 'disrupt' && s.step.must, 'Flood: Land becomes Wetland, then 2 tokens must be removed');
  G.applyAction(s, 0, { type: 'dRemove', region: reg, kind: 'i' });
  let threw = false; try { G.applyAction(s, 0, { type: 'dDone' }); } catch (e) { threw = !!e.userError; }
  ok(threw, '...and cannot be skipped');
  G.applyAction(s, 0, { type: 'dRemove', region: reg, kind: 'i' });
  ok(s.phase === 'play' && s.board[reg].i === 1, '...after 2 removals play begins');
}
{
  const s = reveal('ChangingSeasons', 'Land');
  ok(s.trick.seq[s.trick.seq.length - 1] === 0 && s.turn !== 0, 'Changing Seasons: its owner (the leader) plays last');
}
{
  const reg = BIOMES[biomeOf('Land')].region;
  const s = reveal('LandDevelopment', 'Land', { [reg]: { n: 1, i: 0 } });
  ok(s.phase === 'disrupt' && s.step.must, 'Land Development: its owner must remove tokens');
  G.applyAction(s, 0, { type: 'dRemove', region: reg, kind: 'n' });
  ok(s.trick.blocked && s.board[reg].n === 0 && s.phase === 'play', '...the step ends when the region runs out (only 1 token there), and the region is blocked');
  const c = plain(G.leadSuit(s)); const p = s.turn; s.players[p].hand.push(c.id);
  G.applyAction(s, p, { type: 'play', card: c.id });
  ok(s.board[reg].n === 0, '...cards played there add no tokens');
}
{
  const reg = BIOMES[biomeOf('Land')].region; const board = { [reg]: { n: 2, i: 2 } };
  for (const r of ADJ[reg]) board[r] = { n: 1, i: 1 };
  const s = reveal('Hurricane', 'Land', board);
  let guard = 0;
  while (s.phase === 'disrupt' && guard++ < 50) {
    const r = Object.keys(s.step.quota).find(k => s.step.quota[k] > 0 && s.board[k].n + s.board[k].i > 0);
    G.applyAction(s, 0, { type: 'dRemove', region: r, kind: s.board[r].n ? 'n' : 'i' });
  }
  ok(s.phase === 'play' && s.board[reg].n + s.board[reg].i === 2 && ADJ[reg].every(r => s.board[r].n + s.board[r].i === 0), 'Hurricane removes 2 from the region and from every neighbour');
}
{
  const s = reveal('Liberation', 'Land');
  ok(s.phase === 'play', 'Liberation with no scoring piles anywhere does nothing');
  const t = trickAt(biomeOf('Land'), { dis: 'Liberation' });
  t.players[2].pile.push('Manatee');
  commitAll(t, 'Liberation');
  G.applyAction(t, 0, { type: 'dSteal', from: 2, card: 'Manatee' });
  ok(t.players[0].pile.includes('Manatee') && !t.players[2].pile.includes('Manatee') && t.phase === 'play', 'Liberation moves a card into your scoring pile');
}
{
  const s = reveal('TravelersGuidebook', 'Land');
  ok(s.guidebook === 0, "Traveler's Guidebook marks its owner to lead next round");
  let guard = 0;
  while (s.phase === 'play' && guard++ < 50) { G.applyAction(s, s.turn, G.botAction(s, s.turn)); }
  ok(s.phase === 'choose' && s.leader === 0 && s.guide && s.guide.options.length === 5, '...who then leads, with the top 5 biome cards to choose from');
  const pick = s.guide.options[4], before = s.biomeDeck.length;
  G.applyAction(s, 0, { type: 'chooseBiome', biome: pick });
  ok(s.trick.biome === pick && s.biomeDeck.length === before - 1 && !s.guide, '...and can travel to one of them');
}
{
  const s = trickAt(biomeOf('Land'), { dis: 'NatureDocumentary' });
  commitAll(s, 'NatureDocumentary');
  const c = plain(G.leadSuit(s));
  ok(G.impactOf(s, { card: c.id, p: 0 }) === c.impact + 5 && G.impactOf(s, { card: c.id, p: 1 }) === c.impact, 'Nature Documentary: +5 Impact for its owner\'s Native cards');
}
{
  // the draft: 3 dealt, 2 kept, packs passed clockwise
  const s = G.newGame();
  for (let i = 0; i < 4; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: i > 0 });
  G.startGame(s, { disruptions: true }); s.players.forEach((pl, k) => { pl.bot = k > 0; }); // seats are shuffled: make seat 0 the human
  while (s.phase === 'draft') G.applyAction(s, s.draftTurn, G.botAction(s, s.draftTurn));
  ok(s.phase === 'ddraft' && s.ddraft.packs.every(p => p.length === 3), 'Disruption draft: everyone is dealt 3');
  const mine = s.ddraft.packs[0].slice(), leftNeighbourPack = s.ddraft.packs[3].slice();
  G.applyAction(s, 0, { type: 'draftDis', card: mine[0] });
  ok(s.ddraft.packs[0].length === 2 && s.ddraft.packs[0].every(c => leftNeighbourPack.includes(c)), '...then picks 1 and receives the pack from the seat before (clockwise)');
  G.applyAction(s, 0, { type: 'draftDis', card: s.ddraft.packs[0][0] });
  ok(s.phase === 'choose' && s.players.every(p => p.dis.length === 2), '...until everyone holds 2');
}

console.log(fails ? `\n${fails} check(s) failed.` : '\nAll Disruption checks passed.');
process.exit(fails ? 1 : 0);
