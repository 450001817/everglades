// Everglades — rules engine. Pure game logic, no networking.
// Every change to a game goes through applyAction(state, playerIndex, action).
'use strict';
const { CARDS, REGIONS, ADJ, BIOMES, ROLES, DISRUPTIONS } = require('./public/data.js');
const ENDINGS = require('./endings.js'); // story endings shown on the end screen

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6; // one per competitive role
const TRICK_POINTS = 5;
const REGION_IDS = Object.keys(REGIONS);

// ---------- helpers ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function emptyBoard() {
  const b = {};
  for (const r of REGION_IDS) b[r] = { n: 0, i: 0 };
  return b;
}
function err(msg) { const e = new Error(msg); e.userError = true; throw e; }
function log(s, text) { s.log.push(text); if (s.log.length > 80) s.log.shift(); }
function pname(s, p) { return s.players[p].name; }
// Game events: a short record of what just happened, used to drive character reactions (see reactionsFor).
function emit(s, ev) {
  if (!s.events) s.events = [];
  s.evSeq = (s.evSeq || 0) + 1;
  ev.id = s.evSeq;
  s.events.push(ev);
  if (s.events.length > 60) s.events.shift();
}

function newGame() {
  return {
    phase: 'lobby', players: [], biomeDeck: [], travel: [], board: emptyBoard(),
    leader: 0, turn: 0, trick: null, step: null, abilityUsed: false, tourPeek: null,
    lastTrick: null, log: [], round: 0, discard: [], seq: 0, results: null, events: [], evSeq: 0,
  };
}

// What each player did during the game (drives the ending variants).
function newStats() {
  return { crises: 0, crisisCards: [], abilities: 0, bulldozedN: 0, bulldozedI: 0, huntedN: 0, huntedI: 0, refused: 0, keystones: 0, eaten: 0 };
}

function addPlayer(s, info) {
  if (s.phase !== 'lobby') err('The game has already started.');
  if (s.players.length >= MAX_PLAYERS) err('The table is full (6 players max).');
  s.players.push({ id: info.id, name: info.name, bot: !!info.bot, team: info.team ?? null, role: null, hand: [], pile: [], biomesWon: [], triggeredCrisis: false, stats: newStats() });
}

// Partner mode: teams of 2 score together. Seats alternate teams (A B A B, or A B C A B C),
// so teammates never take turns back to back, even going around the table.
function partnerSeating(players) {
  const teams = {};
  for (const p of players) (teams[p.team] = teams[p.team] || []).push(p);
  const groups = shuffle(Object.values(teams)).map(g => shuffle(g));
  if (groups.length < 2 || groups.some(g => g.length !== 2)) err('Partner mode needs teams of exactly 2 players.');
  const seats = [];
  for (let k = 0; k < 2; k++) for (const g of groups) seats.push(g[k]);
  return seats;
}

function startGame(s, opts = {}) {
  s.disruptions = !!opts.disruptions; // the Disruptions match modifier
  if (opts.coop) return startCoop(s);
  const n = s.players.length;
  if (n < MIN_PLAYERS) err('You need at least 2 players.');
  s.coop = false; s.np = n;
  s.partners = !!opts.partners;
  s.players = s.partners ? partnerSeating(s.players) : shuffle(s.players); // seating = turn order
  if (!s.partners) s.players.forEach(p => { p.team = null; });
  const deck = shuffle(Object.keys(CARDS));
  const per = Math.floor(deck.length / n);
  s.players.forEach((pl, i) => {
    pl.role = null; // chosen in the role draft
    pl.hand = deck.slice(i * per, (i + 1) * per);
    pl.pile = []; pl.biomesWon = []; pl.triggeredCrisis = false; pl.stats = newStats();
  });
  s.discard = deck.slice(n * per); // leftover cards are discarded
  s.biomeDeck = shuffle(Object.keys(BIOMES));
  s.travel = s.biomeDeck.splice(0, 3);
  s.board = emptyBoard();
  s.leader = 0; s.turn = 0; s.round = 1;
  s.phase = 'draft'; s.draftTurn = 0; s.trick = null; s.step = null; s.lastTrick = null;
  s.abilityUsed = false; s.tourPeek = null; s.results = null;
  log(s, `Game started. Each player holds ${per} cards. Choose roles in turn order — ${pname(s, 0)} picks first.`);
}

// ---------- role draft: each player picks a role in turn order ----------
function availableRoles(s) {
  const taken = new Set(s.players.map(p => p.role).filter(Boolean));
  return Object.keys(ROLES).filter(r => !taken.has(r));
}
// ---------- CO-OP: everyone vs The Anaconda ----------
// Native cards are dealt to the players. Invasive cards form the Anaconda's deck: after each player's turn
// it flips the top one and plays it. The game ends after the round in which its last card is played.
// The Anaconda sits at the end of s.players with boss: true (s.np = number of real players).
const BOSS = 'Anaconda';
// Points the Anaconda scores (balanced with simulated games for 1-6 players; see README)
// Bot-vs-Anaconda win rates with these values: 1p 44%, 2p 34%, 3p 37%, 4p 48%, 5p 55%, 6p 45% (humans should do better).
const COOP = { unmetMap: 5, trick: 5, infestedRegion: 3 };

function startCoop(s) {
  const n = s.players.length;
  if (n < 1) err('You need at least 1 player.');
  s.coop = true; s.partners = false; s.np = n;
  s.players = shuffle(s.players);
  const natives = shuffle(Object.keys(CARDS).filter(c => CARDS[c].kind === 'Native'));
  const invasives = shuffle(Object.keys(CARDS).filter(c => CARDS[c].kind === 'Invasive'));
  const per = Math.floor(natives.length / n);
  s.players.forEach((pl, i) => {
    pl.team = null; pl.role = null;
    pl.hand = natives.slice(i * per, (i + 1) * per);
    pl.pile = []; pl.biomesWon = []; pl.triggeredCrisis = false; pl.stats = newStats();
  });
  s.discard = natives.slice(n * per);
  s.players.push({ id: 'anaconda', name: 'The Anaconda', bot: true, boss: true, team: null, role: BOSS,
    hand: invasives, pile: [], biomesWon: [], triggeredCrisis: false, stats: newStats() });
  s.bossIdx = n; s.coopStart = 0;
  s.biomeDeck = shuffle(Object.keys(BIOMES));
  s.travel = s.biomeDeck.splice(0, 3);
  s.board = emptyBoard();
  s.leader = 0; s.turn = 0; s.round = 1;
  s.phase = 'draft'; s.draftTurn = 0; s.trick = null; s.step = null; s.lastTrick = null;
  s.abilityUsed = false; s.tourPeek = null; s.results = null;
  const rounds = Math.ceil(invasives.length / n);
  log(s, `Co-op vs The Anaconda! Each player holds ${per} Native cards. The Anaconda has ${invasives.length} Invasive cards — about ${rounds} rounds. Choose roles in turn order — ${pname(s, 0)} picks first.`);
}
const isBoss = (s, p) => !!(s.players[p] && s.players[p].boss);

// Order of play for a co-op trick: each player, followed by an Anaconda flip (while its deck lasts).
function coopSequence(s, start) {
  const seq = [];
  let flips = s.players[s.bossIdx].hand.length;
  for (let k = 0; k < s.np; k++) {
    seq.push((start + k) % s.np);
    if (flips > 0) { seq.push(s.bossIdx); flips--; }
  }
  return seq;
}

// The Anaconda populates on its own: Migratory moves all its tokens to the adjacent region with the most
// Native tokens (if no neighbour has any, it stays put); Predatory always eats Native tokens there first,
// before its own tokens arrive (the same order as for players).
function bossPopulate(s, c) {
  let region = trickRegion(s);
  if (c.migratory) {
    const opts = ADJ[region].filter(r => s.board[r].n > 0);
    if (opts.length) {
      const most = Math.max(...opts.map(r => s.board[r].n));
      const best = opts.filter(r => s.board[r].n === most);
      region = best[Math.floor(Math.random() * best.length)];
      log(s, `The Anaconda's ${c.name} migrates to ${REGIONS[region].name}.`);
      emit(s, { type: 'spread', p: s.bossIdx, card: c.id, regions: [region] });
    }
  }
  if (c.predatory > 0 && s.board[region].n > 0) {
    const eaten = Math.min(c.predatory, s.board[region].n);
    s.board[region].n -= eaten;
    s.players[s.bossIdx].stats.eaten += eaten;
    log(s, `The Anaconda's ${c.name} devours ${eaten} Native token${eaten > 1 ? 's' : ''} in ${REGIONS[region].name}.`);
    emit(s, { type: 'eat', p: s.bossIdx, card: c.id, region, kind: 'n', count: eaten });
  }
  putTokens(s, region, 'i', c.pop);
}

function pickRole(s, p, role) {
  if (s.phase !== 'draft') err('Roles have already been chosen.');
  if (p !== s.draftTurn) err('It is not your turn to choose a role.');
  if (!availableRoles(s).includes(role)) err('That role is not available.');
  s.players[p].role = role;
  log(s, `${pname(s, p)} becomes the ${ROLES[role].name}.`);
  emit(s, { type: 'role', p, role });
  s.draftTurn += 1;
  if (s.draftTurn >= s.np) {
    s.leader = 0; s.turn = 0;
    if (s.disruptions) return startDisDraft(s);
    s.phase = 'choose';
    log(s, `All roles chosen. ${pname(s, 0)} leads the first round.`);
  }
}

// ---------- rules queries ----------
// The suit to follow: the biome's, unless a Disruption (Flood, Drought) changed it for this round.
function leadSuit(s) { return s.trick ? (s.trick.suit || BIOMES[s.trick.biome].suit) : null; }
function trickRegion(s) { return s.trick ? BIOMES[s.trick.biome].region : null; }

// The trick's Invasive Risk. Keystone is a static effect: while a Keystone card is in the trick, every Native
// token in the trick's region lowers the Risk by 1 (per Keystone played), so natives added later in the trick
// lower it further. Ecological Protest sets it to 0. Recomputed after every action (see applyAction).
function refreshRisk(s) {
  const T = s.trick; if (!T) return;
  const natives = s.board[trickRegion(s)].n;
  T.risk = T.protest ? 0 : Math.max(0, T.baseRisk - (T.keystones || 0) * natives);
}
// The Risk a given player's card is judged against (Take Bribes: +5 for that player's cards only).
function riskFor(s, p) { return s.trick.risk + ((s.trick.bribes || []).includes(p) ? 5 : 0); }
// A played card's Impact (Nature Documentary: +5 for that player's Native cards this round).
function impactOf(s, play) {
  const c = CARDS[play.card];
  return c.impact + (c.kind === 'Native' && (s.trick.docu || []).includes(play.p) ? 5 : 0);
}
const playMatches = (s, play) => cardMatches(play.card, leadSuit(s), riskFor(s, play.p));

// Follow suit if you can (or play any Invasive); otherwise play anything.
function legalCards(s, p) {
  const hand = s.players[p].hand;
  const suit = leadSuit(s);
  const follows = hand.filter(c => CARDS[c].kind === 'Native' && CARDS[c].habitat === suit);
  if (!follows.length) return hand.slice();
  return hand.filter(c => CARDS[c].kind === 'Invasive' || CARDS[c].habitat === suit);
}

// A played card "matches" the lead if it is a Native card of the biome's suit,
// or an Invasive card whose Impact is at or below the current Invasive Risk.
function cardMatches(cardId, suit, risk) {
  const c = CARDS[cardId];
  if (c.kind === 'Invasive') return c.impact <= risk;
  return c.habitat === suit;
}

function trickWinner(s) {
  const plays = s.trick.plays;
  let best = -1;
  const better = (a, b) => { // is play a better than play b (b played earlier)?
    const ia = impactOf(s, a), ib = impactOf(s, b);
    if (ia !== ib) return ia > ib;
    return CARDS[a.card].kind === 'Invasive' && CARDS[b.card].kind === 'Native'; // Invasive wins ties vs Native
  };
  plays.forEach((pl, idx) => {
    if (!playMatches(s, pl)) return;
    if (best < 0 || better(pl, plays[best])) best = idx;
  });
  let matched = true;
  if (best < 0) {
    // Nobody matched the biome. House rule: the highest Impact card played wins.
    matched = false;
    plays.forEach((pl, idx) => { if (best < 0 || impactOf(s, pl) > impactOf(s, plays[best])) best = idx; });
  }
  return { idx: best, matched };
}

// ---------- turn flow ----------
function chooseBiome(s, p, biomeId) {
  if (s.phase !== 'choose') err('Not time to choose a biome.');
  if (p !== s.leader) err('Only the lead player chooses the biome.');
  const i = s.travel.indexOf(biomeId);
  const fromGuide = i < 0 && s.guide && s.guide.p === p && s.guide.options.includes(biomeId); // Traveler's Guidebook
  if (i < 0 && !fromGuide) err('That biome is not in the travel row.');
  if (fromGuide) s.biomeDeck.splice(s.biomeDeck.indexOf(biomeId), 1); else s.travel.splice(i, 1);
  s.guide = null;
  // Trick state. Disruptions can change the suit, the Risk, Impact and the order of play for this round.
  s.trick = { biome: biomeId, plays: [], suit: BIOMES[biomeId].suit, baseRisk: BIOMES[biomeId].risk, risk: BIOMES[biomeId].risk,
    keystones: 0, protest: false, bribes: [], docu: [], doubleNative: false, blocked: false, dis: [], pos: 0 };
  s.phase = 'play'; s.step = null; s.abilityUsed = false; s.tourPeek = null;
  if (s.coop) {
    // A player who leads also plays first; when the Anaconda leads, the next player in rotation starts.
    const start = isBoss(s, s.leader) ? (s.coopStart + 1) % s.np : s.leader;
    s.coopStart = start;
    s.trick.seq = coopSequence(s, start);
  } else {
    s.trick.seq = s.players.map((_, k) => (s.leader + k) % s.players.length); // clockwise from the leader
  }
  s.turn = s.trick.seq[0];
  const b = BIOMES[biomeId];
  log(s, `${pname(s, p)} travels to ${b.name} (${REGIONS[b.region].name}) — ${b.suit}, Invasive Risk ${b.risk}${fromGuide ? ' (from the Traveler\'s Guidebook)' : ''}.`);
  emit(s, { type: 'travel', p, biome: biomeId });
  if (s.disruptions && s.players.slice(0, s.np).some(pl => (pl.dis || []).length)) startDisPhase(s);
}

function playCard(s, p, cardId, populate) {
  if (s.phase !== 'play' || s.step) err('You cannot play a card right now.');
  if (p !== s.turn) err('It is not your turn.');
  const pl = s.players[p];
  if (!pl.hand.includes(cardId)) err('That card is not in your hand.');
  if (!isBoss(s, p) && !legalCards(s, p).includes(cardId)) err(`You must follow ${leadSuit(s)} (or play an Invasive card).`);
  const c = CARDS[cardId];
  pl.hand.splice(pl.hand.indexOf(cardId), 1);
  s.trick.plays.push({ p, card: cardId });
  s.tourPeek = null;
  let msg = `${pname(s, p)} plays ${c.name} (${c.kind === 'Invasive' ? 'Invasive ' : ''}${c.habitat}, Impact ${c.impact}).`;
  log(s, msg);
  const skip = populate === false && pl.role === 'Conservationist' && c.kind === 'Invasive';
  emit(s, { type: 'play', p, card: cardId, region: trickRegion(s), populate: !skip });

  if (isBoss(s, p)) { bossPopulate(s, c); return endTurn(s); }
  const kind = c.kind === 'Invasive' ? 'i' : 'n';
  if (skip) { pl.stats.refused++; log(s, `${pname(s, p)} (Conservationist) chooses not to populate.`); return endTurn(s); }
  // Predators hunt first: remove up to X tokens (Native or Invasive) from the region the card is played in,
  // and only then add the card's own tokens (addTokens() below runs when the hunt is done).
  const region = trickRegion(s);
  if (c.predatory > 0 && s.board[region].n + s.board[region].i > 0) {
    s.step = { type: 'predate', card: cardId, left: c.predatory, regions: [region] };
    return;
  }
  addTokens(s, cardId);
}

// Add a played card's population tokens: all in the trick's region, or spread by the player if Migratory.
function addTokens(s, cardId) {
  const c = CARDS[cardId];
  const kind = c.kind === 'Invasive' ? 'i' : 'n';
  const before = JSON.parse(JSON.stringify(s.board));
  const region = trickRegion(s);
  if (c.migratory && c.pop > 0) {
    s.step = { type: 'place', card: cardId, kind, left: c.pop, line: [], placed: [], before };
    return;
  }
  const added = putTokens(s, region, kind, c.pop);
  if (added === 0 && c.pop > 0 && s.trick.blocked) log(s, `No tokens can be placed on ${REGIONS[region].name} this round (Land Development).`);
  afterPlacement(s, cardId, [region], before);
}

// Adds tokens a played card brings. Disruptions on the trick's region: Land Development blocks them,
// Wild Fire / Red Tide double Native tokens. Returns how many were actually added.
function putTokens(s, region, kind, amount) {
  const T = s.trick;
  if (T && region === trickRegion(s)) {
    if (T.blocked) return 0;
    if (kind === 'n' && T.doubleNative) amount *= 2;
  }
  s.board[region][kind] += amount;
  return amount;
}

function placeToken(s, p, region) {
  const st = s.step;
  if (!st || st.type !== 'place' || p !== s.turn) err('Not placing tokens now.');
  if (!placeTargets(s).includes(region)) err('Migratory tokens must spread in a continuous line from the current region.');
  if (!st.line.includes(region)) st.line.push(region);
  putTokens(s, region, st.kind, 1);
  st.placed.push(region);
  st.left -= 1;
  if (st.left <= 0) {
    const regions = [...new Set(st.placed)];
    log(s, `${CARDS[st.card].name} spreads to ${regions.map(r => REGIONS[r].name).join(' → ')}.`);
    emit(s, { type: 'spread', p, card: st.card, regions });
    s.step = null;
    afterPlacement(s, st.card, regions, st.before);
  }
}

// Valid regions for the next Migratory token.
function placeTargets(s) {
  const st = s.step;
  if (!st || st.type !== 'place') return [];
  const cur = trickRegion(s), blocked = s.trick && s.trick.blocked; // Land Development: the line starts next door
  if (!st.line.length) return blocked ? ADJ[cur].slice() : [cur];
  const last = st.line[st.line.length - 1];
  const t = [...st.line, ...ADJ[last].filter(r => !st.line.includes(r))];
  return blocked ? t.filter(r => r !== cur) : t;
}

// Keystone (static for the rest of the trick): once played, every Native token in the trick's region lowers the
// Invasive Risk by 1, including Native tokens added later in the trick (see refreshRisk). Never below 0.
function applyKeystone(s, c) {
  const was = s.trick.risk;
  s.trick.keystones = (s.trick.keystones || 0) + 1;
  refreshRisk(s);
  if (s.players[s.turn].stats) s.players[s.turn].stats.keystones++;
  emit(s, { type: 'keystone', p: s.turn, card: c.id, from: was, to: s.trick.risk });
  log(s, `Keystone: for the rest of this trick, each Native token in ${REGIONS[trickRegion(s)].name} lowers the Invasive Risk by 1 (now ${s.trick.risk}).`);
}

function afterPlacement(s, cardId, regions, before) {
  const c = CARDS[cardId];
  if (c.keystone) applyKeystone(s, c);
  endTurn(s);
}

function predate(s, p, region, kind) {
  const st = s.step;
  if (!st || st.type !== 'predate' || p !== s.turn) err('Not removing tokens now.');
  if (!st.regions.includes(region) || !['n', 'i'].includes(kind) || s.board[region][kind] <= 0) err('You cannot remove that token.');
  s.board[region][kind] -= 1; st.left -= 1;
  s.players[p].stats[kind === 'n' ? 'huntedN' : 'huntedI']++;
  log(s, `${CARDS[st.card].name} removes 1 ${kind === 'n' ? 'Native' : 'Invasive'} token from ${REGIONS[region].name}.`);
  emit(s, { type: 'eat', p, card: st.card, region, kind, count: 1 });
  const remaining = st.regions.reduce((a, r) => a + s.board[r].n + s.board[r].i, 0);
  if (st.left <= 0 || remaining <= 0) { s.step = null; addTokens(s, st.card); } // hunt over: now the card's own tokens arrive
}

function predateDone(s, p) {
  if (!s.step || s.step.type !== 'predate' || p !== s.turn) err('Not removing tokens now.');
  const card = s.step.card;
  s.step = null; addTokens(s, card);
}

// The order of play is s.trick.seq (clockwise from the leader; in co-op with the Anaconda's flips woven in;
// Changing Seasons moves its owner to the end).
function endTurn(s) {
  s.step = null;
  s.trick.pos += 1;
  if (s.trick.pos >= s.trick.seq.length) return resolveTrick(s);
  s.turn = s.trick.seq[s.trick.pos];
  s.abilityUsed = false; s.tourPeek = null;
}

function resolveTrick(s) {
  const { idx, matched } = trickWinner(s);
  const play = s.trick.plays[idx];
  const w = s.players[play.p];
  const card = CARDS[play.card];
  w.pile.push(...s.trick.plays.map(x => x.card));
  w.biomesWon.push(s.trick.biome);
  const crisis = card.kind === 'Invasive';
  log(s, `${w.name} wins the trick with ${card.name}${matched ? '' : ' (no card matched, so highest Impact wins)'}.`);
  if (crisis) {
    w.triggeredCrisis = true;
    w.stats.crises++; w.stats.crisisCards.push(play.card);
    for (const r of REGION_IDS) {
      const t = s.board[r];
      if (t.i > 0 && t.n > 0) t.n = Math.max(0, t.n - t.i);
      else if (t.i > 0 && t.n === 0) t.i -= 1;
    }
    log(s, 'INVASIVE CRISIS! Native populations fall across the map.');
  }
  emit(s, { type: 'trick', p: play.p, card: play.card, biome: s.trick.biome, crisis });
  s.lastTrick = { biome: s.trick.biome, plays: s.trick.plays, winner: play.p, card: play.card, crisis, risk: s.trick.risk, matched, round: s.round,
    suit: s.trick.suit, dis: s.trick.dis };
  s.trick = null; s.step = null;
  if (s.coop && (s.players[s.bossIdx].hand.length === 0 || s.players.slice(0, s.np).every(pl => pl.hand.length === 0))) return endGame(s);
  if (!s.coop && s.players.every(pl => pl.hand.length === 0)) return endGame(s);
  s.round += 1;
  s.leader = play.p; s.turn = play.p;
  if (s.guidebook !== null && s.guidebook !== undefined) {
    // Traveler's Guidebook: its owner leads the next round and may also travel to any of the top 5 biome cards
    const g = s.guidebook; s.guidebook = null;
    s.leader = g; s.turn = g;
    s.guide = { p: g, options: s.biomeDeck.slice(0, 5) };
    log(s, `${pname(s, g)} opens the Traveler's Guidebook and leads the next round.`);
  }
  if (s.biomeDeck.length) s.travel.push(s.biomeDeck.shift()); // refill the travel row
  s.phase = 'choose'; s.abilityUsed = false; s.tourPeek = null;
}

// ---------- character abilities (start of turn, optional, once per turn) ----------
function useAbility(s, p, a) {
  if (s.phase !== 'play' || s.step || p !== s.turn) err('You can only use your ability at the start of your turn.');
  if (s.abilityUsed) err('You already used your ability this turn.');
  const pl = s.players[p];
  const role = pl.role;
  if (role === 'Fisherman' || role === 'Hunter' || role === 'Researcher') {
    const { handCard, pileCard } = a;
    if (!pl.hand.includes(handCard) || !pl.pile.includes(pileCard)) err('Pick one card from your hand and one from your scoring pile.');
    if (role !== 'Researcher') {
      const need = role === 'Fisherman' ? 'Water' : 'Land';
      if (CARDS[pileCard].habitat !== need) err(`The scoring-pile card must be a ${need} card.`);
    }
    pl.hand[pl.hand.indexOf(handCard)] = pileCard;
    pl.pile[pl.pile.indexOf(pileCard)] = handCard;
    s.abilityUsed = true;
    log(s, `${pl.name} swaps a card between hand and scoring pile.`);
  } else if (role === 'LandDeveloper') {
    const { region, kind } = a;
    if (!s.board[region] || !['n', 'i'].includes(kind) || s.board[region][kind] <= 0) err('There is no such token to remove.');
    s.board[region][kind] -= 1;
    s.abilityUsed = true;
    pl.stats[kind === 'n' ? 'bulldozedN' : 'bulldozedI']++;
    log(s, `${pl.name} removes 1 ${kind === 'n' ? 'Native' : 'Invasive'} token from ${REGIONS[region].name}.`);
  } else if (role === 'Tourist') {
    if (!s.biomeDeck.length) err('The location deck is empty.');
    s.tourPeek = s.biomeDeck[0];
    s.abilityUsed = true;
    log(s, `${pl.name} peeks at the top of the location deck.`);
  } else err('Your role has no start-of-turn action.');
  pl.stats.abilities++;
  emit(s, { type: 'ability', p, role, region: a.region || null, kind: a.kind || null });
}

function tourDecide(s, p, bottom) {
  if (p !== s.turn || !s.tourPeek) err('Nothing to decide.');
  if (bottom) { s.biomeDeck.push(s.biomeDeck.shift()); log(s, `${pname(s, p)} puts it on the bottom.`); }
  else log(s, `${pname(s, p)} leaves it on top.`);
  s.tourPeek = null;
}

// ---------- DISRUPTIONS (optional match modifier) ----------
// Setup: after the role draft each player is dealt 3 Disruption cards and drafts them: everyone picks 1, then
// passes the rest clockwise, until each player holds 2 (the last card is discarded). Bots pick instantly.
// Each round: once the biome is chosen, every player may commit 1 Disruption face down (or pass). When all
// have decided they are revealed and activated in turn order (cards that need choices wait for their owner),
// then normal play proceeds. In co-op only the players take part (not the Anaconda).
const DIS_HAND = 3, DIS_KEEP = 2;

function startDisDraft(s) {
  const ids = shuffle(Object.keys(DISRUPTIONS));
  s.players.forEach(pl => { pl.dis = []; });
  s.ddraft = { packs: [], picks: [], round: 0 };
  for (let p = 0; p < s.np; p++) { s.ddraft.packs.push(ids.slice(p * DIS_HAND, (p + 1) * DIS_HAND)); s.ddraft.picks.push(null); }
  s.phase = 'ddraft';
  log(s, `Disruption draft: everyone picks 1 of ${DIS_HAND} Disruption cards and passes the rest clockwise, until each player holds ${DIS_KEEP}.`);
  autoBots(s);
}
function draftPick(s, p, card) {
  const D = s.ddraft;
  if (s.phase !== 'ddraft' || !D) err('Not drafting Disruptions now.');
  if (p >= s.np) err('You are not in the draft.');
  if (D.picks[p]) err('You already picked this round.');
  if (!D.packs[p].includes(card)) err('That card is not in your pack.');
  D.picks[p] = card;
  advanceDraft(s);
}
function advanceDraft(s) {
  const D = s.ddraft;
  if (D.picks.some(x => !x)) return;
  for (let p = 0; p < s.np; p++) { s.players[p].dis.push(D.picks[p]); D.packs[p] = D.packs[p].filter(c => c !== D.picks[p]); }
  D.round += 1;
  if (D.round >= DIS_KEEP) {
    s.ddraft = null; s.phase = 'choose';
    log(s, `Disruptions drafted. ${pname(s, s.leader)} leads the first round.`);
    return;
  }
  const n = s.np;
  D.packs = D.packs.map((_, p) => D.packs[(p - 1 + n) % n]); // pass clockwise: each pack moves to the next seat
  D.picks = D.picks.map(() => null);
  log(s, 'Packs passed clockwise.');
  autoBots(s);
}

function startDisPhase(s) {
  s.phase = 'disrupt';
  s.dcommit = { picks: {} };
  for (let p = 0; p < s.np; p++) if (!(s.players[p].dis || []).length) s.dcommit.picks[p] = null; // nothing to commit: auto-pass
  log(s, 'Disruption phase: commit a Disruption card face down, or pass.');
  autoBots(s);
}
function commitDis(s, p, card) {
  if (s.phase !== 'disrupt' || !s.dcommit) err('Not the Disruption phase.');
  if (p >= s.np) err('You have no Disruptions.');
  if (s.dcommit.picks[p] !== undefined) err('You already decided this round.');
  if (card !== null && !(s.players[p].dis || []).includes(card)) err('You do not hold that Disruption.');
  s.dcommit.picks[p] = card;
  maybeReveal(s);
}
function maybeReveal(s) {
  const C = s.dcommit;
  for (let p = 0; p < s.np; p++) if (C.picks[p] === undefined) return;
  // reveal in turn order
  const order = [...new Set(s.trick.seq.filter(p => p < s.np))];
  for (const p of order) {
    const card = C.picks[p];
    if (!card) continue;
    const pl = s.players[p];
    pl.dis.splice(pl.dis.indexOf(card), 1);
    s.trick.dis.push({ p, card });
    log(s, `${pl.name} reveals ${DISRUPTIONS[card].name}!`);
    emit(s, { type: 'disrupt', p, card });
  }
  if (!s.trick.dis.length) log(s, 'Everyone passes.');
  s.dcommit = null;
  s.dqueue = s.trick.dis.slice();
  nextDis(s);
}
// Activate revealed Disruptions one by one; stop when one needs its owner's choices.
function nextDis(s) {
  s.step = null;
  while (s.dqueue && s.dqueue.length) {
    const { p, card } = s.dqueue.shift();
    if (activateDis(s, p, card)) { s.turn = p; refreshRisk(s); return; }
    refreshRisk(s);
  }
  s.dqueue = null;
  s.phase = 'play'; s.trick.pos = 0; s.turn = s.trick.seq[0]; s.abilityUsed = false;
  refreshRisk(s);
}
const tokensIn = (s, r, kinds) => kinds.reduce((a, k) => a + s.board[r][k], 0);
// What each card does when activated. Returns true if it set up a choice step for its owner.
function activateDis(s, p, id) {
  const T = s.trick, cur = trickRegion(s), name = pname(s, p), R = REGIONS[cur].name;
  const both = ['n', 'i'];
  const removeStep = o => { s.step = Object.assign({ type: 'dis', card: id, p, mode: 'remove', kinds: both, pool: { n: 0, i: 0 }, must: false }, o); return disStepLive(s); };
  switch (id) {
    case 'Hurricane': {
      const quota = { [cur]: 2 }; for (const r of ADJ[cur]) quota[r] = 2;
      return removeStep({ quota, must: true });
    }
    case 'LandDevelopment':
      T.blocked = true; log(s, `No population tokens can be placed on ${R} this round.`);
      return removeStep({ quota: { [cur]: 2 }, must: true });
    case 'HuntingSeason': return removeStep({ regions: Object.keys(REGIONS), left: 5 });
    case 'BountyHunting': return removeStep({ regions: [cur], kinds: ['i'], left: 999 });
    case 'Drought':
      if (T.suit === 'Wetland') { T.suit = 'Land'; log(s, `Drought: ${R} is a Land biome this round.`); }
      return removeStep({ regions: [cur], left: 5 });
    case 'Flood': {
      const was = T.suit;
      if (T.suit === 'Land') T.suit = 'Wetland';
      else if (BIOMES[T.biome].suit === 'Wetland' && T.suit === 'Wetland') T.suit = 'Water';
      if (T.suit !== was) log(s, `Flood: the biome becomes ${T.suit} for the round.`);
      return removeStep({ quota: { [cur]: 2 }, must: true });
    }
    case 'CatchAndRelease': return removeStep({ regions: Object.keys(REGIONS), left: 5, collect: true });
    case 'MassMigration':
      if (!tokensIn(s, cur, both)) { log(s, `${name}'s Mass Migration finds no tokens to move.`); return false; }
      s.step = { type: 'dis', card: id, p, mode: 'dest', from: cur, pool: { n: s.board[cur].n, i: s.board[cur].i }, must: false };
      return true;
    case 'RunawayPets': {
      const M = s.board.M;
      if (!M.n && !M.i) { log(s, `${name}'s Runaway Pets: Miami is empty.`); return false; }
      s.step = { type: 'dis', card: id, p, mode: 'scatter', from: 'M', pool: { n: M.n, i: M.i }, must: false };
      M.n = 0; M.i = 0; // in hand until placed; anything not placed goes back to Miami
      return true;
    }
    case 'Liberation':
      if (!s.players.some((pl, k) => k !== p && pl.pile.length)) { log(s, `${name}'s Liberation: nobody has a scoring pile yet.`); return false; }
      s.step = { type: 'dis', card: id, p, mode: 'steal', must: false };
      return true;
    case 'EcologicalProtest': T.protest = true; log(s, `Ecological Protest: the Invasive Risk on ${R} becomes 0.`); return false;
    case 'FertilizerLeaching': s.board[cur].n *= 2; s.board[cur].i *= 2; log(s, `Fertilizer Leaching doubles the tokens on ${R}.`); return false;
    case 'WildFire': case 'RedTide': {
      const spared = id === 'WildFire' ? 'Water' : 'Land';
      if (T.suit !== spared) { s.board[cur].n = 0; s.board[cur].i = 0; log(s, `${DISRUPTIONS[id].name} clears every token from ${R}.`); }
      else log(s, `${DISRUPTIONS[id].name} spares ${R} (a ${spared} biome).`);
      T.doubleNative = true; log(s, `Native tokens played onto ${R} are doubled this round.`);
      return false;
    }
    case 'TakeBribes': T.bribes.push(p); log(s, `${name} takes bribes: the Risk counts 5 higher for their cards this round.`); return false;
    case 'NatureDocumentary': T.docu.push(p); log(s, `${name}'s Native cards have +5 Impact this round.`); return false;
    case 'ChangingSeasons':
      T.seq = T.seq.filter(x => x !== p).concat([p]); log(s, `${name} will play last this round.`); return false;
    case 'TravelersGuidebook': s.guidebook = p; log(s, `${name} will lead the next round, guidebook in hand.`); return false;
    default: return false;
  }
}
// A removal step is only worth asking about if something can be removed; otherwise it finishes at once.
function canRemove(s, st) {
  if (st.quota) return Object.entries(st.quota).some(([r, q]) => q > 0 && tokensIn(s, r, st.kinds) > 0);
  return st.left > 0 && st.regions.some(r => tokensIn(s, r, st.kinds) > 0);
}
function disStepLive(s) {
  const st = s.step;
  if (st.mode === 'remove' && !canRemove(s, st)) return finishRemove(s, true);
  return true;
}
// After a removal step: Catch and Release moves its picked tokens on to one region; everything else is done.
function finishRemove(s, inActivate) {
  const st = s.step;
  if (st.collect && st.pool.n + st.pool.i > 0) { st.mode = 'dest'; st.from = null; st.must = true; return true; }
  if (inActivate) { s.step = null; return false; }
  nextDis(s);
  return false;
}
function disAct(s, p, a) {
  const st = s.step;
  if (s.phase !== 'disrupt' || !st || st.type !== 'dis' || p !== st.p) err('No Disruption choice to make right now.');
  const D = DISRUPTIONS[st.card].name;
  if (a.type === 'dRemove') {
    if (st.mode !== 'remove') err('Not removing tokens now.');
    const { region, kind } = a;
    if (!s.board[region] || !st.kinds.includes(kind) || s.board[region][kind] <= 0) err('You cannot remove that token.');
    if (st.quota) { if (!(st.quota[region] > 0)) err(`${D} doesn't remove tokens there.`); st.quota[region]--; }
    else { if (!st.regions.includes(region)) err(`${D} doesn't remove tokens there.`); if (st.left <= 0) err('No removals left.'); st.left--; }
    s.board[region][kind]--;
    if (st.collect) st.pool[kind]++;
    log(s, `${D}: ${pname(s, p)} ${st.collect ? 'picks up' : 'removes'} 1 ${kind === 'n' ? 'Native' : 'Invasive'} token from ${REGIONS[region].name}.`);
    emit(s, { type: 'eat', p, card: null, region, kind, count: 1, dis: st.card });
    if (!canRemove(s, st)) finishRemove(s, false);
    return;
  }
  if (a.type === 'dDest') {
    if (st.mode !== 'dest') err('Not choosing a destination now.');
    const r = a.region;
    if (!s.board[r] || r === st.from) err('Pick another region.');
    if (s.trick.blocked && r === trickRegion(s)) err('No tokens can be placed on the current region this round.');
    if (st.from) { s.board[st.from].n -= st.pool.n; s.board[st.from].i -= st.pool.i; }
    s.board[r].n += st.pool.n; s.board[r].i += st.pool.i;
    log(s, `${D}: ${st.pool.n + st.pool.i} token${st.pool.n + st.pool.i === 1 ? '' : 's'} move to ${REGIONS[r].name}.`);
    emit(s, { type: 'spread', p, card: null, regions: [r], dis: st.card });
    return nextDis(s);
  }
  if (a.type === 'dScatter') {
    if (st.mode !== 'scatter') err('Not placing tokens now.');
    const { region: r, kind } = a;
    if (!s.board[r] || r === st.from) err('Pick a region other than Miami.');
    if (!(st.pool[kind] > 0)) err('No tokens of that kind left to place.');
    if (s.trick.blocked && r === trickRegion(s)) err('No tokens can be placed on the current region this round.');
    st.pool[kind]--; s.board[r][kind]++;
    log(s, `${D}: a ${kind === 'n' ? 'Native' : 'Invasive'} token runs off to ${REGIONS[r].name}.`);
    if (st.pool.n + st.pool.i === 0) return nextDis(s);
    return;
  }
  if (a.type === 'dSteal') {
    if (st.mode !== 'steal') err('Not taking a card now.');
    const from = s.players[a.from];
    if (!from || a.from === p || !from.pile.includes(a.card)) err("Pick a card from another player's scoring pile.");
    from.pile.splice(from.pile.indexOf(a.card), 1);
    s.players[p].pile.push(a.card);
    log(s, `${D}: ${pname(s, p)} takes ${CARDS[a.card].name} from ${from.name}'s scoring pile.`);
    return nextDis(s);
  }
  if (a.type === 'dDone') {
    if (st.must) err(`${D} must be finished.`);
    if (st.mode === 'remove') { finishRemove(s, false); return; }
    if (st.mode === 'scatter') { s.board[st.from].n += st.pool.n; s.board[st.from].i += st.pool.i; }
    return nextDis(s);
  }
  err('Unknown Disruption action.');
}

// Bots decide right away in the simultaneous parts (draft picks and commits). Also called by the server in case
// a seat was handed to a bot mid-phase.
function autoBots(s) {
  if (s.phase === 'ddraft' && s.ddraft) {
    let any = false;
    for (let p = 0; p < s.np; p++) if (s.players[p].bot && !s.ddraft.picks[p]) {
      const pack = s.ddraft.packs[p];
      s.ddraft.picks[p] = pack[Math.floor(Math.random() * pack.length)]; any = true;
    }
    if (any) advanceDraft(s);
  } else if (s.phase === 'disrupt' && s.dcommit) {
    let any = false;
    for (let p = 0; p < s.np; p++) if (s.players[p].bot && s.dcommit.picks[p] === undefined) {
      s.dcommit.picks[p] = botCommit(s, p); any = true;
    }
    if (any) maybeReveal(s);
  }
}
// Bots commit now and then, and only cards that would do something right now.
function botCommit(s, p) {
  const pl = s.players[p], cur = trickRegion(s);
  const useful = (pl.dis || []).filter(id => {
    if (id === 'MassMigration' || id === 'FertilizerLeaching') return tokensIn(s, cur, ['n', 'i']) > 0;
    if (id === 'RunawayPets') return s.board.M.n + s.board.M.i > 0;
    if (id === 'Liberation') return s.players.some((o, k) => k !== p && o.pile.length);
    if (id === 'BountyHunting') return s.board[cur].i > 0;
    return true;
  });
  if (!useful.length) return null;
  // more eager late in the game, when cards left unplayed would be wasted
  const left = pl.hand.length;
  const chance = left <= useful.length + 1 ? 0.9 : 0.25;
  return Math.random() < chance ? useful[Math.floor(Math.random() * useful.length)] : null;
}
function botDis(s, p) {
  const st = s.step, pl = s.players[p], role = ROLES[pl.role] || { map: {} };
  const wantKind = r => role.map[r] === 'I' ? 'i' : 'n';
  if (st.mode === 'remove') {
    const regions = st.quota ? Object.keys(st.quota).filter(r => st.quota[r] > 0) : st.regions;
    // first choice: tokens that work against the bot's map objectives
    for (const r of regions) {
      if (!role.map[r]) continue;
      const bad = wantKind(r) === 'n' ? 'i' : 'n';
      if (st.kinds.includes(bad) && s.board[r][bad] > 0) return { type: 'dRemove', region: r, kind: bad };
    }
    if (st.must) { // mandatory removals: take whatever is there
      for (const r of regions) for (const k of st.kinds) if (s.board[r][k] > 0) return { type: 'dRemove', region: r, kind: k };
    }
    return { type: 'dDone' };
  }
  if (st.mode === 'dest') {
    if (!st.must) return { type: 'dDone' };
    // Catch and Release: drop them where the bot wants that population (or anywhere legal)
    const ok = Object.keys(REGIONS).filter(r => !(s.trick.blocked && r === trickRegion(s)));
    const pref = ok.find(r => role.map[r] && wantKind(r) === (st.pool.n >= st.pool.i ? 'n' : 'i'));
    return { type: 'dDest', region: pref || ok[0] };
  }
  if (st.mode === 'scatter') return { type: 'dDone' };
  if (st.mode === 'steal') {
    let best = null;
    s.players.forEach((o, k) => { if (k === p) return; for (const c of o.pile) if (!best || CARDS[c].impact > CARDS[best.card].impact) best = { from: k, card: c }; });
    return best ? Object.assign({ type: 'dSteal' }, best) : { type: 'dDone' };
  }
  return { type: 'dDone' };
}

// ---------- scoring ----------
function computeResults(s) {
  const b = s.board;
  const people = s.players.filter(pl => !pl.boss); // the Anaconda (co-op) doesn't count in player comparisons
  const tricks = people.map(pl => pl.biomesWon.length);
  const suitTricks = (pl, suit) => pl.biomesWon.filter(id => BIOMES[id].suit === suit).length;
  const maxOf = arr => Math.max(...arr);
  const minOf = arr => Math.min(...arr);
  const totalN = REGION_IDS.reduce((a, r) => a + b[r].n, 0);
  const totalI = REGION_IDS.reduce((a, r) => a + b[r].i, 0);
  const scoredRegions = new Set(people.flatMap(pl => pl.biomesWon.map(id => BIOMES[id].region)));

  return people.map((pl, p) => {
    const R = ROLES[pl.role];
    const lines = [];
    const objRegions = Object.keys(R.map);
    const met = objRegions.filter(r => R.map[r] === 'N' ? b[r].n > b[r].i : b[r].i > b[r].n);
    lines.push({ label: `Map objectives met: ${met.length}/${objRegions.length}`, pts: met.length * R.mapPts });
    const objPop = objRegions.reduce((a, r) => a + b[r].n + b[r].i, 0);
    const role = pl.role;
    if (role === 'Conservationist') {
      lines.push({ label: `Native majority overall (${totalN} vs ${totalI})`, pts: totalN > totalI ? 15 : 0 });
      lines.push({ label: 'Never triggered an Invasive Crisis', pts: pl.triggeredCrisis ? 0 : 5 });
    } else if (role === 'Fisherman' || role === 'Hunter') {
      lines.push({ label: `25+ population in objective regions (${objPop})`, pts: objPop >= 25 ? (role === 'Fisherman' ? 10 : 15) : 0 });
      const suit = role === 'Fisherman' ? 'Water' : 'Land';
      const mine = suitTricks(pl, suit);
      const best = maxOf(people.map(x => suitTricks(x, suit)));
      lines.push({ label: `Most tricks from ${suit} regions (${mine})`, pts: mine > 0 && mine === best ? 15 : 0 });
    } else if (role === 'LandDeveloper') {
      const empty = REGION_IDS.filter(r => b[r].n + b[r].i === 0).length;
      lines.push({ label: `No population in 2+ regions (${empty} empty)`, pts: empty >= 2 ? 15 : 0 });
      lines.push({ label: `Most total tricks (${tricks[p]})`, pts: tricks[p] > 0 && tricks[p] === maxOf(tricks) ? 10 : 0 });
    } else if (role === 'Researcher') {
      const tax = new Set(pl.pile.map(c => CARDS[c].taxon));
      lines.push({ label: `6 unique taxonomies in scoring pile (${tax.size})`, pts: tax.size >= 6 ? 15 : 0 });
      lines.push({ label: `Fewest tricks (${tricks[p]})`, pts: tricks[p] === minOf(tricks) ? 10 : 0 });
    } else if (role === 'Tourist') {
      lines.push({ label: 'All map objectives met', pts: met.length === objRegions.length ? 10 : 0 });
      const only = pl.biomesWon.length > 0 && pl.biomesWon.every(id => R.map[BIOMES[id].region]);
      lines.push({ label: 'Won tricks only from objective regions', pts: only ? 15 : 0 });
    }
    lines.push({ label: `Tricks won: ${tricks[p]} × ${TRICK_POINTS}`, pts: tricks[p] * TRICK_POINTS });
    const total = lines.reduce((a, l) => a + l.pts, 0);

    // Which half of the role card's back applies (green = good ending).
    const pile = pl.pile.map(c => CARDS[c]);
    const nat = h => pile.filter(c => c.kind === 'Native' && (!h || c.habitat === h)).length;
    const inv = h => pile.filter(c => c.kind === 'Invasive' && (!h || c.habitat === h)).length;
    let good;
    if (role === 'Conservationist') good = b.ENP.i === 0;
    else if (role === 'Researcher') good = nat() > inv();
    else if (role === 'Fisherman') good = nat('Water') > inv('Water');
    else if (role === 'Hunter') good = nat('Land') > inv('Land');
    else if (role === 'LandDeveloper') good = ADJ.M.some(r => b[r].n + b[r].i === 0);
    else if (role === 'Tourist') good = objRegions.every(r => scoredRegions.has(r));
    return { p, name: pl.name, role, lines, total, good, metRegions: met };
  });
}

// What the Anaconda scores in co-op. It scales with the number of players.
function anacondaResults(s) {
  const b = s.board;
  const boss = s.players[s.bossIdx];
  let unmet = 0;
  for (const pl of s.players.slice(0, s.np)) {
    const map = ROLES[pl.role].map;
    for (const r of Object.keys(map)) if (!(map[r] === 'N' ? b[r].n > b[r].i : b[r].i > b[r].n)) unmet++;
  }
  const infested = REGION_IDS.filter(r => b[r].i > b[r].n).length;
  const lines = [
    { label: `Players' unmet map objectives: ${unmet} × ${COOP.unmetMap}`, pts: unmet * COOP.unmetMap },
    { label: `Regions with an Invasive majority: ${infested} × ${COOP.infestedRegion}`, pts: infested * COOP.infestedRegion },
    { label: `Tricks won: ${boss.biomesWon.length} × ${COOP.trick}`, pts: boss.biomesWon.length * COOP.trick },
  ];
  return { lines, total: lines.reduce((a, l) => a + l.pts, 0), unmet, infested };
}

function endGame(s) {
  scoreGame(s);
  emit(s, { type: 'end', winners: s.results.winners.slice(), coop: !!s.coop, playersWin: !!s.results.playersWin });
}

function scoreGame(s) {
  s.phase = 'ended';
  const res = computeResults(s);
  // every player's story ending (the end screen shows the winners'; co-op also shows the Anaconda's)
  for (const r of res) {
    r.ending = ENDINGS.endingFor(s, r, res);
    r.ending.condition = ENDINGS.CONDITIONS[r.role][r.good ? 0 : 1];
  }
  if (s.coop) {
    // Players add their scores together and must beat the Anaconda (it wins ties).
    const playersTotal = res.reduce((a, r) => a + r.total, 0);
    const ana = anacondaResults(s);
    const playersWin = playersTotal > ana.total;
    // Ending: players win -> highest scorer's good ending; Anaconda wins -> lowest scorer's grim ending.
    const pick = res.slice().sort((a, b) => playersWin ? b.total - a.total : a.total - b.total)[0];
    // co-op: the team result picks the side (good if the players won), told through the chosen player's role
    const coopEnding = ENDINGS.endingFor(s, Object.assign({}, pick, { good: playersWin }), res);
    coopEnding.condition = playersWin ? 'The players drove back the Anaconda' : 'The Anaconda beat the players';
    const bossEnding = ENDINGS.anacondaEnding(s);
    bossEnding.condition = ENDINGS.CONDITIONS.Anaconda[bossEnding.good ? 0 : 1];
    s.results = { coop: true, scores: res, anaconda: ana, playersTotal, playersWin, bossEnding, coopEnding,
      winners: playersWin ? res.map(r => r.p) : [s.bossIdx], ending: { p: pick.p, good: playersWin } };
    log(s, playersWin ? `The players drive back the Anaconda, ${playersTotal} to ${ana.total}!` : `The Anaconda wins, ${ana.total} to ${playersTotal}.`);
    return;
  }
  const top = Math.max(...res.map(r => r.total));
  if (s.partners) {
    // Teammates add their scores together; the best team wins.
    const teams = {};
    for (const r of res) { const t = s.players[r.p].team; (teams[t] = teams[t] || { team: t, members: [], total: 0 }); teams[t].members.push(r.p); teams[t].total += r.total; }
    const list = Object.values(teams).sort((a, b) => b.total - a.total);
    const best = list[0].total;
    const winTeams = list.filter(t => t.total === best);
    const winners = winTeams.flatMap(t => t.members);
    s.results = { scores: res, winners, teams: list };
    log(s, `Game over! ${winTeams.map(t => t.members.map(m => pname(s, m)).join(' & ')).join(' and ')} ${winTeams.length > 1 ? 'tie' : 'win'} with ${best} team points.`);
    return;
  }
  const winners = res.filter(r => r.total === top).map(r => r.p);
  s.results = { scores: res, winners };
  log(s, `Game over! ${winners.map(w => pname(s, w)).join(' & ')} ${winners.length > 1 ? 'tie' : 'wins'} with ${top} points.`);
}

// ---------- dispatcher ----------
function applyAction(s, p, a) {
  switch (a.type) {
    case 'pickRole': pickRole(s, p, a.role); break;
    case 'chooseBiome': chooseBiome(s, p, a.biome); break;
    case 'play': playCard(s, p, a.card, a.populate); break;
    case 'place': placeToken(s, p, a.region); break;
    case 'predate': predate(s, p, a.region, a.kind); break;
    case 'predateDone': predateDone(s, p); break;
    case 'ability': useAbility(s, p, a); break;
    case 'tourDecide': tourDecide(s, p, !!a.bottom); break;
    case 'draftDis': draftPick(s, p, a.card); break;
    case 'commitDis': commitDis(s, p, a.card || null); break;
    case 'dRemove': case 'dDest': case 'dScatter': case 'dSteal': case 'dDone': disAct(s, p, a); break;
    default: err('Unknown action.');
  }
  refreshRisk(s); // Keystone is static: the Risk follows the Native tokens in the region
  s.seq++;
}

// Whose input is the game waiting on? (-1 in the simultaneous parts: the Disruption draft and commits.)
function waitingOn(s) {
  if (s.phase === 'draft') return s.draftTurn;
  if (s.phase === 'choose') return s.leader;
  if (s.phase === 'play') return s.turn;
  if (s.phase === 'disrupt' && s.step) return s.turn;
  return -1;
}
// Who still has to decide in the simultaneous parts.
function pendingSimultaneous(s) {
  if (s.phase === 'ddraft' && s.ddraft) return s.ddraft.picks.map((x, p) => x ? -1 : p).filter(p => p >= 0);
  if (s.phase === 'disrupt' && s.dcommit) return [...Array(s.np).keys()].filter(p => s.dcommit.picks[p] === undefined);
  return [];
}

// ---------- simple bot ----------
function botAction(s, p) {
  const pl = s.players[p];
  if (pl.boss) {
    // The Anaconda: always travels to the highest Invasive Risk biome (rightmost on a tie), and flips its top card.
    if (s.phase === 'choose') {
      let best = s.travel[0];
      for (const id of s.travel) if (BIOMES[id].risk >= BIOMES[best].risk) best = id;
      return { type: 'chooseBiome', biome: best };
    }
    return { type: 'play', card: pl.hand[0] };
  }
  if (s.phase === 'draft') { const av = availableRoles(s); return { type: 'pickRole', role: av[Math.floor(Math.random() * av.length)] }; }
  if (s.phase === 'disrupt' && s.step && s.step.type === 'dis') return botDis(s, p);
  const role = ROLES[pl.role];
  const wantKind = r => role.map[r] === 'I' ? 'i' : 'n'; // what the bot wants to keep in region r
  if (s.phase === 'choose') {
    // Prefer a biome whose suit the bot holds the most of.
    let best = s.travel[0], bestScore = -1;
    for (const id of s.travel) {
      const suit = BIOMES[id].suit;
      const sc = pl.hand.filter(c => CARDS[c].kind === 'Native' && CARDS[c].habitat === suit).length + (role.map[BIOMES[id].region] ? 1 : 0) + Math.random() * 0.5;
      if (sc > bestScore) { bestScore = sc; best = id; }
    }
    return { type: 'chooseBiome', biome: best };
  }
  if (s.tourPeek) return { type: 'tourDecide', bottom: !role.map[BIOMES[s.tourPeek].region] }; // keep biomes in its objective regions on top
  if (s.step && s.step.type === 'place') {
    // Spread toward regions where the bot's role wants this kind of population.
    const t = placeTargets(s);
    const score = r => (role.map[r] ? (wantKind(r) === s.step.kind ? 2 : -2) : 0) + Math.random();
    return { type: 'place', region: t.slice().sort((a, b) => score(b) - score(a))[0] };
  }
  if (s.step && s.step.type === 'predate') {
    for (const r of s.step.regions) {
      const bad = wantKind(r) === 'n' ? 'i' : 'n';
      if (s.board[r][bad] > 0) return { type: 'predate', region: r, kind: bad };
    }
    return { type: 'predateDone' };
  }
  // Start of turn: use the role ability when it obviously helps.
  if (s.phase === 'play' && !s.step && !s.abilityUsed) {
    const a = botAbility(s, p, role, wantKind);
    if (a) return a;
  }
  // Pick a card: win cheaply if possible, otherwise dump the lowest Impact card.
  const legal = legalCards(s, p);
  const suit = leadSuit(s);
  const risk = riskFor(s, p);
  const currentBest = s.trick.plays.filter(x => playMatches(s, x)).reduce((m, x) => Math.max(m, impactOf(s, x)), -1);
  const natives = s.board[trickRegion(s)].n;
  const winners = legal.filter(c => cardMatches(c, suit, CARDS[c].keystone ? Math.max(0, risk - (s.trick.keystones + 1) * (natives + CARDS[c].pop)) : risk)
      && impactOf(s, { card: c, p }) > currentBest)
    .sort((a, b) => CARDS[a].impact - CARDS[b].impact);
  const wantsFew = pl.role === 'Researcher' || partnerWinning(s, p);
  let card;
  if (winners.length && !wantsFew) card = winners[0];
  else card = legal.slice().sort((a, b) => CARDS[a].impact - CARDS[b].impact)[0];
  const populate = !(pl.role === 'Conservationist' && CARDS[card].kind === 'Invasive') ? undefined : false;
  return { type: 'play', card, populate };
}

// Is this player's partner currently winning the trick?
function partnerWinning(s, p) {
  if ((!s.partners && !s.coop) || !s.trick || !s.trick.plays.length) return false;
  const { idx, matched } = trickWinner(s);
  const w = s.trick.plays[idx].p;
  if (s.coop) return matched && w !== p && !isBoss(s, w); // in co-op every player is on the same side
  return matched && w !== p && s.players[w].team === s.players[p].team;
}

function botAbility(s, p, role, wantKind) {
  const pl = s.players[p];
  const r = pl.role;
  if (r === 'Tourist') return s.biomeDeck.length && Math.random() < 0.6 ? { type: 'ability' } : null;
  if (r === 'LandDeveloper') {
    // Remove a token that works against its map, otherwise thin out a small region (it wants empty regions).
    for (const reg of Object.keys(role.map)) {
      const bad = wantKind(reg) === 'n' ? 'i' : 'n';
      if (s.board[reg][bad] > 0 && s.board[reg][bad] >= s.board[reg][wantKind(reg)]) return { type: 'ability', region: reg, kind: bad };
    }
    const small = Object.keys(s.board).filter(reg => !role.map[reg] && s.board[reg].n + s.board[reg].i > 0)
      .sort((a, b) => (s.board[a].n + s.board[a].i) - (s.board[b].n + s.board[b].i))[0];
    if (small) return { type: 'ability', region: small, kind: s.board[small].i > 0 ? 'i' : 'n' };
    return null;
  }
  if (!pl.pile.length || Math.random() < 0.4) return null;
  const byImpact = (a, b) => CARDS[a].impact - CARDS[b].impact;
  if (r === 'Researcher') {
    // Wants the fewest tricks: bank its strongest hand card, take back the weakest pile card.
    const hi = pl.hand.slice().sort(byImpact).pop(), lo = pl.pile.slice().sort(byImpact)[0];
    return CARDS[hi].impact > CARDS[lo].impact ? { type: 'ability', handCard: hi, pileCard: lo } : null;
  }
  if (r === 'Fisherman' || r === 'Hunter') {
    // Trade its weakest off-suit card for the strongest Native card of its favourite suit in the pile,
    // so it can compete for those tricks.
    const need = r === 'Fisherman' ? 'Water' : 'Land';
    const h = pl.hand.filter(c => CARDS[c].habitat !== need).sort(byImpact)[0];
    const pc = pl.pile.filter(c => CARDS[c].habitat === need && CARDS[c].kind === 'Native').sort(byImpact).pop();
    if (h && pc && CARDS[pc].impact > CARDS[h].impact) return { type: 'ability', handCard: h, pileCard: pc };
  }
  return null;
}

// ---------- what a bot says when it acts (short, in character) ----------
const pickOne = a => a[Math.floor(Math.random() * a.length)];
const VOICE = {
  Conservationist: {
    pick: ['I’ll protect these wetlands as the Conservationist.'],
    travel: b => [`${b.place} needs protecting.`, `Let’s check on ${b.name}.`],
    win: c => [`Tagging a ${c}. This biome needs a champion!`, `A healthy ${c} — just what this place needs.`],
    low: c => [`Letting a ${c} settle in quietly.`, `A small ${c}. Every species counts.`],
    inv: c => [`Releasing ${c}… under protest.`],
  },
  Researcher: {
    pick: ['Field Researcher reporting. Clipboards ready.'],
    travel: b => [`Field study at ${b.name}, ${b.place}.`, `Collecting samples in ${b.name}.`],
    win: c => [`${c} sighting! Strong data.`, `Documenting a fine ${c} specimen.`],
    low: c => [`Logging a modest ${c}. Low profile.`, `Quietly noting a ${c}.`],
    inv: c => [`Introducing ${c}. Purely for science.`, `Observing ${c}… from a distance.`],
  },
  Fisherman: {
    pick: ['Fisherman! Where are the big ones biting?'],
    travel: b => [`Heading out to ${b.name}. Fish are biting!`, `Casting lines at ${b.name}.`],
    win: c => [`Reeling in a ${c}. That’s a keeper!`, `Big ${c} on the line!`],
    low: c => [`Throwing back a ${c}. Not worth it.`, `Just a little ${c}.`],
    inv: c => [`Oops, a ${c} fell off the boat.`, `Bait bucket ${c} — who’ll notice?`],
  },
  Hunter: {
    pick: ['Game Hunter. Let’s go track something.'],
    travel: b => [`Tracking game through ${b.name}.`, `Fresh trail in ${b.name}.`],
    win: c => [`${c} spotted. Taking the shot!`, `A trophy ${c}!`],
    low: c => [`A ${c}… not trophy material.`, `Passing on that ${c}.`],
    inv: c => [`Turn the ${c} loose. More game for me!`],
  },
  LandDeveloper: {
    pick: ['Land Developer. Time to see some property.'],
    travel: b => [`Surveying ${b.name} for new lots.`, `${b.name}? Prime waterfront.`],
    win: c => [`${c} — great for the brochure.`, `Investing in ${c}. Big returns!`],
    low: c => [`${c}? Not my investment.`, `Minimal spend on a ${c}.`],
    inv: c => [`${c} clears space for development.`, `${c}: free land clearing!`],
  },
  Tourist: {
    pick: ['Tourist! I brought three cameras.'],
    travel: b => [`Next stop: ${b.name}! Sunscreen on.`, `Is ${b.name} on the tour?`],
    win: c => [`Ooh, a ${c}! Best photo yet!`, `Look at that ${c}!`],
    low: c => [`Just a ${c}. Saving film.`, `Cute ${c}. Moving on.`],
    inv: c => [`Was I supposed to keep my pet ${c}?`, `Oops… my ${c} got loose.`],
  },
};
const BOSS_VOICE = {
  travel: b => [`Ssslithering into ${b.name}\u2026`, `${b.name}. The risk there is delicious.`, `To ${b.name}. Hide your natives.`],
  play: c => [`Releasing ${c} into the wild!`, `Behold \u2014 ${c}!`, `${c}\u2026 ssspreading nicely.`, `A gift for the Everglades: ${c}.`],
  hunt: c => [`${c} feeds on the natives\u2026`, `${c} is hungry.`],
};
function botSay(s, p, a) {
  const pl = s.players[p];
  if (pl.boss) {
    if (a.type === 'chooseBiome') return pickOne(BOSS_VOICE.travel({ name: BIOMES[a.biome].name }));
    if (a.type === 'play') { const c = CARDS[a.card]; return pickOne(c.predatory ? BOSS_VOICE.hunt(c.name) : BOSS_VOICE.play(c.name)); }
    return null;
  }
  if (a.type === 'pickRole') return VOICE[a.role].pick[0];
  const V = VOICE[pl.role];
  const rn = r => REGIONS[r].name;
  switch (a.type) {
    case 'chooseBiome': { const b = BIOMES[a.biome]; return pickOne(V.travel({ name: b.name, place: rn(b.region) })); }
    case 'play': {
      const c = CARDS[a.card];
      if (c.keystone) return pickOne([`${c.name} anchors the ecosystem. Invasive Risk drops!`, `${c.name} keeps the invaders in check.`]);
      if (c.kind === 'Invasive') return pickOne(V.inv(c.name));
      if (partnerWinning(s, p)) { const mate = s.players[s.trick.plays[trickWinner(s).idx].p].name; return pickOne([`${mate}'s got this one!`, `Backing up ${mate}.`, `Not stepping on ${mate}'s toes.`]); }
      const best = s.trick.plays.filter(x => playMatches(s, x)).reduce((m, x) => Math.max(m, impactOf(s, x)), -1);
      const mine = { card: a.card, p };
      return pickOne(playMatches(s, mine) && impactOf(s, mine) > best ? V.win(c.name) : V.low(c.name));
    }
    case 'ability':
      if (pl.role === 'Tourist') return 'Peeking at the travel brochure…';
      if (pl.role === 'LandDeveloper') return `Bulldozing ${a.kind === 'n' ? 'a Native' : 'an Invasive'} population in ${rn(a.region)}.`;
      if (pl.role === 'Researcher') return `Archiving my ${CARDS[a.handCard].name}. Less glory, more data.`;
      if (pl.role === 'Fisherman') return `Swapping catches — keeping my ${CARDS[a.pileCard].name}.`;
      if (pl.role === 'Hunter') return `Trading trophies — back on the trail of ${CARDS[a.pileCard].name}.`;
      return null;
    case 'tourDecide': return a.bottom ? `Skipping ${BIOMES[s.tourPeek].name}. Too touristy.` : `${BIOMES[s.tourPeek].name} stays on my itinerary!`;
    case 'place': return s.step.left === 1 ? `${CARDS[s.step.card].name} spreads to ${rn(a.region)}!` : null;
    case 'predate': return s.step.left < CARDS[s.step.card].predatory ? null : `${CARDS[s.step.card].name} hunts ${a.kind === 'n' ? 'Natives' : 'Invasives'} in ${rn(a.region)}.`;
    default: return null;
  }
}

// ---------- character reactions ----------
// Every game event (see emit) gives each character a chance to react, in keeping with their role:
// the Conservationist mourns invasives, the Land Developer loves empty land, the Researcher hates winning tricks...
// A reaction is an animation for the character portrait (idle / think / signature / cheer / upset / shock)
// plus an optional line that a BOT may say out loud. Human players get the animation only.
const PRI = { idle: 0, think: 0, signature: 1, cheer: 2, upset: 2, shock: 3 };
// animals the Tourist can't help photographing
const CHARISMATIC = new Set(['Manatee', 'Flamingo', 'FloridaPanther', 'AmericanCrocodile', 'LeatherBackSeaTurtle', 'FloridaBlackbear', 'GreatBlueHeron', 'WoodStork', 'MiamiBlueButterly', 'RiverOtter', 'Coral']);
const SCARY = new Set(['BurmesePython', 'GreenAnaconda', 'NileMonitor', 'Lionfish', 'AsianSwampEel', 'WildBoar']);
const GAME_ANIMALS = new Set(['WildBoar', 'FeralCat', 'BlackRat', 'MuscovyDuck']);

// What each role thinks of each kind of event. Each handler gets a context object and returns
// [animation, [lines...]] or null. Lines may use {c} card, {place} region, {w} trick winner, {to}/{from} risk.
const REACT = {
  Conservationist: {
    travel: x => x.want === 'N' ? ['think', ['{place}. I’ll be watching closely.', 'Tread lightly in {place}, everyone.']] : null,
    play: x => {
      if (x.self) return null;
      if (x.inv && x.c.impact >= 13) return ['shock', ['A {c}?! Not in my wetlands!', 'Someone stop that {c}!']];
      if (x.inv && x.populate && x.want === 'N') return ['upset', ['Invasives in {place}? Unacceptable.', 'Get that {c} out of {place}!']];
      return null;
    },
    keystone: x => x.to < x.from ? ['cheer', ['Keystone species! Risk down to {to}.', 'That {c} holds the whole system together!']] : null,
    spread: x => x.inv ? ['upset', ['It’s spreading to {place}!', 'Contain that {c}!']] : null,
    eat: x => x.kind === 'n' ? [x.boss ? 'shock' : 'upset', ['Our natives…!', 'Not the natives!']] : ['cheer', ['Good riddance!', 'One less invader.']],
    ability: x => x.role === 'LandDeveloper' && !x.self ? (x.kind === 'n' ? ['upset', ['Bulldozing natives? Shameful.']] : ['cheer', ['Huh. Thanks, I suppose.']]) : null,
    win: () => ['cheer', ['For the wetlands!', 'Protected, for now.']],
    crisis: x => x.mine ? ['upset', ['I caused a crisis… I’m so sorry.']] : ['shock', ['INVASIVE CRISIS! No, no, no…', 'The natives are collapsing!']],
  },
  Fisherman: {
    travel: x => x.suit === 'Water' ? ['signature', ['Water trip! Grabbing my rod.', 'Fish should be biting at {place}.']] : null,
    play: x => {
      if (x.self) return x.native && x.c.habitat === 'Water' && x.c.impact >= 7 ? ['signature', null] : null;
      if (x.native && x.c.habitat === 'Water' && x.c.impact >= 7) return ['signature', ['Now THAT’s a {c}!', 'Beauty of a {c}.']];
      if (x.inv && x.c.habitat === 'Water') return [SCARY.has(x.card) ? 'shock' : 'upset', ['{c} in my fishing grounds? Ugh.', 'There goes the catch…']];
      return null;
    },
    lost: x => x.suit === 'Water' ? ['upset', ['Hey, that was my water trick!', 'Lost one off the hook…']] : null,
    win: () => ['cheer', ['Landed it!', 'Hooked another one!']],
    crisis: () => ['shock', ['The fish stocks!', 'What’s happening to the water?!']],
  },
  Hunter: {
    travel: x => x.suit === 'Land' ? ['signature', ['Good hunting ground.', 'Fresh tracks near {place}.']] : null,
    play: x => {
      if (x.self) return x.c.predatory && x.c.habitat === 'Land' ? ['signature', null] : null;
      if (x.inv && GAME_ANIMALS.has(x.card)) return ['cheer', ['{c}! Open season!', 'More game for me.']];
      if (x.native && x.c.predatory >= 3) return ['signature', ['A {c} on the prowl. Respect.', 'Now that’s a hunter.']];
      return null;
    },
    eat: x => x.kind === 'i' && !x.self ? ['signature', ['Clean shot.', 'Nice hunting.']] : null,
    lost: x => x.suit === 'Land' ? ['upset', ['That was my land trick…', 'Missed the shot.']] : null,
    win: () => ['cheer', ['Bagged it!', 'Trophy!']],
    crisis: () => ['shock', ['The game’s all gone!', 'Whoa — what hit the woods?']],
  },
  LandDeveloper: {
    travel: x => x.region === 'M' || x.risk >= 15 ? ['signature', ['{place}? Prime real estate.', 'I can see the condos already.']] : null,
    play: x => {
      if (x.self) return null;
      if (x.inv && x.region === 'M') return ['cheer', ['{c} in Miami. Business as usual.']];
      if (x.native && x.populate && x.c.pop >= 4) return ['upset', ['{c} everywhere… there go my lots.', 'More residents? Bad for zoning.']];
      return null;
    },
    keystone: x => x.to < x.from && !x.self ? ['upset', ['Lower risk? Bad for business.']] : null,
    eat: x => x.coop ? (x.kind === 'n' ? ['upset', ['Even I don’t like that snake.']] : null) : ['cheer', ['Fewer residents, more room.', 'Clearing the lot nicely.']],
    win: () => ['cheer', ['Sold!', 'Another parcel for the portfolio.']],
    crisis: x => x.coop ? ['shock', ['This is bad for everyone’s property values!']] : ['cheer', ['A crisis? Cheaper land!', 'Market correction. Love it.']],
  },
  Researcher: {
    travel: x => x.risk >= 13 ? ['think', ['Invasive Risk {risk}. Fascinating.', 'High risk at {place}. Taking notes.']] : null,
    play: x => {
      if (x.self) return null;
      if (x.inv && x.c.impact >= 15) return ['shock', ['A {c}?! That changes the whole study.']];
      if (['Cnidaria', 'Insect', 'Mollusc'].includes(x.c.taxon) || x.c.keystone) return ['signature', ['A {taxon}! Noting that down.', 'Remarkable specimen.']];
      return null;
    },
    keystone: x => ['signature', ['Keystone effect observed: {from} → {to}.']],
    spread: x => ['signature', ['Migration route logged.', 'Tracking the {c} to {place}.']],
    win: () => ['upset', ['Another trick? I wanted the fewest…', 'Too much attention. Bad for the data.']],
    crisis: () => ['shock', ['The data… it’s collapsing!', 'Population crash! Write this down!']],
  },
  Tourist: {
    travel: x => x.want === 'N' || x.want === 'I' ? ['cheer', ['{place} is on my list!', 'Ooh, I’ve always wanted to see {place}!']] : null,
    play: x => {
      if (CHARISMATIC.has(x.card)) return ['signature', x.self ? null : ['Ooh! A {c}! *click*', 'Hold still, {c}!']];
      if (!x.self && SCARY.has(x.card)) return ['shock', ['Is that a {c}?! Eek!', 'Nobody said there’d be a {c}!']];
      if (!x.self && x.inv && x.want === 'N') return ['upset', ['That {c} is ruining my photos.']];
      return null;
    },
    win: () => ['cheer', ['Souvenir!', 'Best trip ever!']],
    crisis: () => ['shock', ['Is everything okay out there?!', 'This was NOT in the brochure!']],
  },
};

const fill = (line, x) => line.replace(/\{(\w+)\}/g, (m, k) => (x.words[k] !== undefined ? x.words[k] : m));

// Reactions to one event: [{ seat, anim, pri, line }], at most one per seat.
function reactionsFor(s, ev) {
  const out = [];
  const actor = ev.p;
  const c = ev.card ? CARDS[ev.card] : null;
  const biome = ev.biome ? BIOMES[ev.biome] : null;
  const region = ev.region || (ev.regions && ev.regions[ev.regions.length - 1]) || (biome && biome.region) || null;
  const winner = ev.type === 'trick' ? ev.p : null;
  const sameSide = (a, b) => a === b || (s.coop && !isBoss(s, a) && !isBoss(s, b)) || (s.partners && s.players[a].team === s.players[b].team);
  s.players.forEach((pl, seat) => {
    if (pl.boss) {
      // The Anaconda has no animations, just a rattle of its portrait when it wins or feeds.
      if ((ev.type === 'trick' && seat === winner) || (ev.type === 'eat' && seat === actor)) out.push({ seat, anim: 'cheer', pri: 2, line: null });
      return;
    }
    if (!pl.role || !REACT[pl.role]) return;
    const R = REACT[pl.role];
    const want = region ? ROLES[pl.role].map[region] : undefined;
    const x = {
      seat, self: seat === actor, card: ev.card, c, inv: c && c.kind === 'Invasive', native: c && c.kind === 'Native',
      region, want, suit: biome ? biome.suit : null, risk: biome ? biome.risk : null, kind: ev.kind, role: ev.role,
      populate: ev.populate !== false, boss: isBoss(s, actor), coop: !!s.coop, from: ev.from, to: ev.to,
      mine: seat === winner,
      words: { c: c ? c.name : '', place: region ? REGIONS[region].name : '', w: winner !== null ? s.players[winner].name : '',
        to: ev.to, from: ev.from, risk: biome ? biome.risk : '', taxon: c ? c.taxon : '' },
    };
    let r = null;
    switch (ev.type) {
      case 'role': if (x.self) r = ['signature', null]; break;
      case 'travel': r = R.travel ? R.travel(x) : null; break;
      case 'play': r = R.play ? R.play(x) : null; break;
      case 'keystone': r = R.keystone ? R.keystone(x) : null; break;
      case 'spread': r = R.spread ? R.spread(x) : null; break;
      case 'eat': r = R.eat ? R.eat(x) : null; break;
      case 'ability': r = x.self ? ['signature', null] : (R.ability ? R.ability(x) : null); break;
      case 'trick':
        if (ev.crisis) r = R.crisis(x);
        else if (seat === winner) r = R.win(x);
        else if (sameSide(seat, winner)) r = ['cheer', [`Nice one, ${x.words.w}!`, `Go ${x.words.w}!`]];
        else if (s.coop && isBoss(s, winner)) r = ['upset', ['The Anaconda takes it…', 'We’ll get it back.']];
        else r = R.lost ? R.lost(x) : null;
        break;
      case 'end': {
        const won = ev.coop ? ev.playersWin : ev.winners.includes(seat);
        r = won ? ['cheer', ['What a trip!', 'GG, everyone!']] : ['upset', ['Next time…', 'Well played.']];
        break;
      }
    }
    if (!r) return;
    const [anim, lines] = r;
    out.push({ seat, anim, pri: PRI[anim], line: lines && lines.length ? fill(pickOne(lines), x) : null });
  });
  return out;
}

// Which bot (if any) says its reaction out loud. One line per event at most, so the table doesn't get noisy:
// a bot never comments on its own move (it already spoke), big moments always get a line, small ones only sometimes.
function reactionLine(s, ev, list) {
  const big = ev.type === 'end' || (ev.type === 'trick' && ev.crisis);
  const chance = big ? 1 : ev.type === 'trick' ? 0.75 : 0.4;
  if (Math.random() >= chance) return null;
  const cands = list.filter(r => r.line && s.players[r.seat] && s.players[r.seat].bot && !s.players[r.seat].boss
    && (r.seat !== ev.p || ev.type === 'trick' || ev.type === 'end'));
  if (!cands.length) return null;
  const top = Math.max(...cands.map(r => r.pri));
  const pick = pickOne(cands.filter(r => r.pri === top));
  return { seat: pick.seat, text: pick.line };
}

module.exports = {
  anacondaResults, COOP,
  botSay, reactionsFor, reactionLine,
  newGame, addPlayer, startGame, availableRoles, partnerSeating, applyAction, legalCards, placeTargets, waitingOn, botAction,
  computeResults, trickWinner, cardMatches, MIN_PLAYERS, MAX_PLAYERS,
  autoBots, pendingSimultaneous, leadSuit, riskFor, impactOf,
};
