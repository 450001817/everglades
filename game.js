// Everglades — rules engine. Pure game logic, no networking.
// Every change to a game goes through applyAction(state, playerIndex, action).
'use strict';
const { CARDS, REGIONS, ADJ, BIOMES, ROLES } = require('./public/data.js');

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

function newGame() {
  return {
    phase: 'lobby', players: [], biomeDeck: [], travel: [], board: emptyBoard(),
    leader: 0, turn: 0, trick: null, step: null, abilityUsed: false, tourPeek: null,
    lastTrick: null, log: [], round: 0, discard: [], seq: 0, results: null,
  };
}

function addPlayer(s, info) {
  if (s.phase !== 'lobby') err('The game has already started.');
  if (s.players.length >= MAX_PLAYERS) err('The table is full (6 players max).');
  s.players.push({ id: info.id, name: info.name, bot: !!info.bot, role: null, hand: [], pile: [], biomesWon: [], triggeredCrisis: false });
}

function startGame(s) {
  const n = s.players.length;
  if (n < MIN_PLAYERS) err('You need at least 2 players.');
  s.players = shuffle(s.players); // random seating = turn order
  const deck = shuffle(Object.keys(CARDS));
  const per = Math.floor(deck.length / n);
  s.players.forEach((pl, i) => {
    pl.role = null; // chosen in the role draft
    pl.hand = deck.slice(i * per, (i + 1) * per);
    pl.pile = []; pl.biomesWon = []; pl.triggeredCrisis = false;
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
function pickRole(s, p, role) {
  if (s.phase !== 'draft') err('Roles have already been chosen.');
  if (p !== s.draftTurn) err('It is not your turn to choose a role.');
  if (!availableRoles(s).includes(role)) err('That role is not available.');
  s.players[p].role = role;
  log(s, `${pname(s, p)} becomes the ${ROLES[role].name}.`);
  s.draftTurn += 1;
  if (s.draftTurn >= s.players.length) {
    s.phase = 'choose'; s.leader = 0; s.turn = 0;
    log(s, `All roles chosen. ${pname(s, 0)} leads the first round.`);
  }
}

// ---------- rules queries ----------
function leadSuit(s) { return s.trick ? BIOMES[s.trick.biome].suit : null; }
function trickRegion(s) { return s.trick ? BIOMES[s.trick.biome].region : null; }

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
  const suit = leadSuit(s), risk = s.trick.risk;
  const plays = s.trick.plays;
  let best = -1;
  const better = (a, b) => { // is play a better than play b (b played earlier)?
    const ca = CARDS[a.card], cb = CARDS[b.card];
    if (ca.impact !== cb.impact) return ca.impact > cb.impact;
    return ca.kind === 'Invasive' && cb.kind === 'Native'; // Invasive wins ties vs Native
  };
  plays.forEach((pl, idx) => {
    if (!cardMatches(pl.card, suit, risk)) return;
    if (best < 0 || better(pl, plays[best])) best = idx;
  });
  let matched = true;
  if (best < 0) {
    // Nobody matched the biome. House rule: the highest Impact card played wins.
    matched = false;
    plays.forEach((pl, idx) => { if (best < 0 || CARDS[pl.card].impact > CARDS[plays[best].card].impact) best = idx; });
  }
  return { idx: best, matched };
}

// ---------- turn flow ----------
function chooseBiome(s, p, biomeId) {
  if (s.phase !== 'choose') err('Not time to choose a biome.');
  if (p !== s.leader) err('Only the lead player chooses the biome.');
  const i = s.travel.indexOf(biomeId);
  if (i < 0) err('That biome is not in the travel row.');
  s.travel.splice(i, 1);
  s.trick = { biome: biomeId, plays: [], risk: BIOMES[biomeId].risk };
  s.phase = 'play'; s.turn = s.leader; s.step = null; s.abilityUsed = false; s.tourPeek = null;
  const b = BIOMES[biomeId];
  log(s, `${pname(s, p)} travels to ${b.name} (${REGIONS[b.region].name}) — ${b.suit}, Invasive Risk ${b.risk}.`);
}

function playCard(s, p, cardId, populate) {
  if (s.phase !== 'play' || s.step) err('You cannot play a card right now.');
  if (p !== s.turn) err('It is not your turn.');
  const pl = s.players[p];
  if (!pl.hand.includes(cardId)) err('That card is not in your hand.');
  if (!legalCards(s, p).includes(cardId)) err(`You must follow ${leadSuit(s)} (or play an Invasive card).`);
  const c = CARDS[cardId];
  pl.hand.splice(pl.hand.indexOf(cardId), 1);
  s.trick.plays.push({ p, card: cardId });
  s.tourPeek = null;
  let msg = `${pname(s, p)} plays ${c.name} (${c.kind === 'Invasive' ? 'Invasive ' : ''}${c.habitat}, Impact ${c.impact}).`;
  log(s, msg);

  const kind = c.kind === 'Invasive' ? 'i' : 'n';
  const skip = populate === false && pl.role === 'Conservationist' && c.kind === 'Invasive';
  if (skip) { log(s, `${pname(s, p)} (Conservationist) chooses not to populate.`); return endTurn(s); }
  const before = JSON.parse(JSON.stringify(s.board));
  const region = trickRegion(s);
  if (c.migratory && c.pop > 0) {
    s.step = { type: 'place', card: cardId, kind, left: c.pop, line: [], placed: [], before };
    return;
  }
  s.board[region][kind] += c.pop;
  afterPlacement(s, cardId, [region], before);
}

function placeToken(s, p, region) {
  const st = s.step;
  if (!st || st.type !== 'place' || p !== s.turn) err('Not placing tokens now.');
  if (!placeTargets(s).includes(region)) err('Migratory tokens must spread in a continuous line from the current region.');
  if (!st.line.includes(region)) st.line.push(region);
  s.board[region][st.kind] += 1;
  st.placed.push(region);
  st.left -= 1;
  if (st.left <= 0) {
    const regions = [...new Set(st.placed)];
    log(s, `${CARDS[st.card].name} spreads to ${regions.map(r => REGIONS[r].name).join(' → ')}.`);
    s.step = null;
    afterPlacement(s, st.card, regions, st.before);
  }
}

// Valid regions for the next Migratory token.
function placeTargets(s) {
  const st = s.step;
  if (!st || st.type !== 'place') return [];
  if (!st.line.length) return [trickRegion(s)];
  const last = st.line[st.line.length - 1];
  return [...st.line, ...ADJ[last].filter(r => !st.line.includes(r))];
}

// Keystone: after the card populates, lower the Invasive Risk by the Native tokens now in the trick's region
// (this card's own tokens included), never below 0.
function applyKeystone(s, c) {
  const natives = s.board[trickRegion(s)].n;
  const was = s.trick.risk;
  s.trick.risk = Math.max(0, was - natives);
  log(s, natives > 0
    ? `Keystone: ${natives} Native token${natives > 1 ? 's' : ''} in ${REGIONS[trickRegion(s)].name} lower the Invasive Risk from ${was} to ${s.trick.risk}.`
    : `Keystone: no Native tokens in ${REGIONS[trickRegion(s)].name}, so the Invasive Risk stays at ${was}.`);
}

function afterPlacement(s, cardId, regions, before) {
  const c = CARDS[cardId];
  if (c.keystone) applyKeystone(s, c);
  if (c.predatory > 0) {
    // Predators remove up to X tokens of either kind (Native or Invasive) from any region they populated.
    const total = regions.reduce((a, r) => a + s.board[r].n + s.board[r].i, 0);
    if (total > 0) { s.step = { type: 'predate', card: cardId, left: c.predatory, regions }; return; }
  }
  endTurn(s);
}

function predate(s, p, region, kind) {
  const st = s.step;
  if (!st || st.type !== 'predate' || p !== s.turn) err('Not removing tokens now.');
  if (!st.regions.includes(region) || !['n', 'i'].includes(kind) || s.board[region][kind] <= 0) err('You cannot remove that token.');
  s.board[region][kind] -= 1; st.left -= 1;
  log(s, `${CARDS[st.card].name} removes 1 ${kind === 'n' ? 'Native' : 'Invasive'} token from ${REGIONS[region].name}.`);
  const remaining = st.regions.reduce((a, r) => a + s.board[r].n + s.board[r].i, 0);
  if (st.left <= 0 || remaining <= 0) { s.step = null; endTurn(s); }
}

function predateDone(s, p) {
  if (!s.step || s.step.type !== 'predate' || p !== s.turn) err('Not removing tokens now.');
  s.step = null; endTurn(s);
}

function endTurn(s) {
  s.step = null;
  if (s.trick.plays.length >= s.players.length) return resolveTrick(s);
  s.turn = (s.turn + 1) % s.players.length;
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
    for (const r of REGION_IDS) {
      const t = s.board[r];
      if (t.i > 0 && t.n > 0) t.n = Math.max(0, t.n - t.i);
      else if (t.i > 0 && t.n === 0) t.i -= 1;
    }
    log(s, 'INVASIVE CRISIS! Native populations fall across the map.');
  }
  s.lastTrick = { biome: s.trick.biome, plays: s.trick.plays, winner: play.p, card: play.card, crisis, risk: s.trick.risk, matched, round: s.round };
  s.trick = null; s.step = null;
  if (s.players.every(pl => pl.hand.length === 0)) return endGame(s);
  s.round += 1;
  s.leader = play.p; s.turn = play.p;
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
      if (CARDS[pileCard].impact >= CARDS[handCard].impact) err('The scoring-pile card must have a lower Impact than the card from your hand.');
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
    log(s, `${pl.name} removes 1 ${kind === 'n' ? 'Native' : 'Invasive'} token from ${REGIONS[region].name}.`);
  } else if (role === 'Tourist') {
    if (!s.biomeDeck.length) err('The location deck is empty.');
    s.tourPeek = s.biomeDeck[0];
    s.abilityUsed = true;
    log(s, `${pl.name} peeks at the top of the location deck.`);
  } else err('Your role has no start-of-turn action.');
}

function tourDecide(s, p, bottom) {
  if (p !== s.turn || !s.tourPeek) err('Nothing to decide.');
  if (bottom) { s.biomeDeck.push(s.biomeDeck.shift()); log(s, `${pname(s, p)} puts it on the bottom.`); }
  else log(s, `${pname(s, p)} leaves it on top.`);
  s.tourPeek = null;
}

// ---------- scoring ----------
function computeResults(s) {
  const b = s.board;
  const tricks = s.players.map(pl => pl.biomesWon.length);
  const suitTricks = (pl, suit) => pl.biomesWon.filter(id => BIOMES[id].suit === suit).length;
  const maxOf = arr => Math.max(...arr);
  const minOf = arr => Math.min(...arr);
  const totalN = REGION_IDS.reduce((a, r) => a + b[r].n, 0);
  const totalI = REGION_IDS.reduce((a, r) => a + b[r].i, 0);
  const scoredRegions = new Set(s.players.flatMap(pl => pl.biomesWon.map(id => BIOMES[id].region)));

  return s.players.map((pl, p) => {
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
      const best = maxOf(s.players.map(x => suitTricks(x, suit)));
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

function endGame(s) {
  s.phase = 'ended';
  const res = computeResults(s);
  const top = Math.max(...res.map(r => r.total));
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
    default: err('Unknown action.');
  }
  s.seq++;
}

// Whose input is the game waiting on?
function waitingOn(s) {
  if (s.phase === 'draft') return s.draftTurn;
  if (s.phase === 'choose') return s.leader;
  if (s.phase === 'play') return s.turn;
  return -1;
}

// ---------- simple bot ----------
function botAction(s, p) {
  const pl = s.players[p];
  if (s.phase === 'draft') { const av = availableRoles(s); return { type: 'pickRole', role: av[Math.floor(Math.random() * av.length)] }; }
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
  const risk = s.trick.risk;
  const currentBest = s.trick.plays.filter(x => cardMatches(x.card, suit, risk)).reduce((m, x) => Math.max(m, CARDS[x.card].impact), -1);
  const winners = legal.filter(c => cardMatches(c, suit, CARDS[c].keystone ? Math.max(0, risk - s.board[BIOMES[s.trick.biome].region].n - CARDS[c].pop) : risk) && CARDS[c].impact > currentBest)
    .sort((a, b) => CARDS[a].impact - CARDS[b].impact);
  const wantsFew = pl.role === 'Researcher';
  let card;
  if (winners.length && !wantsFew) card = winners[0];
  else card = legal.slice().sort((a, b) => CARDS[a].impact - CARDS[b].impact)[0];
  const populate = !(pl.role === 'Conservationist' && CARDS[card].kind === 'Invasive') ? undefined : false;
  return { type: 'play', card, populate };
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
    // Trade an off-suit card for a lower Impact card of its favourite suit, to compete for those tricks.
    const need = r === 'Fisherman' ? 'Water' : 'Land';
    for (const h of pl.hand.filter(c => CARDS[c].habitat !== need).sort(byImpact).reverse()) {
      const pc = pl.pile.filter(c => CARDS[c].habitat === need && CARDS[c].kind === 'Native' && CARDS[c].impact < CARDS[h].impact).sort(byImpact).pop();
      if (pc) return { type: 'ability', handCard: h, pileCard: pc };
    }
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
function botSay(s, p, a) {
  const pl = s.players[p];
  if (a.type === 'pickRole') return VOICE[a.role].pick[0];
  const V = VOICE[pl.role];
  const rn = r => REGIONS[r].name;
  switch (a.type) {
    case 'chooseBiome': { const b = BIOMES[a.biome]; return pickOne(V.travel({ name: b.name, place: rn(b.region) })); }
    case 'play': {
      const c = CARDS[a.card];
      if (c.keystone) return pickOne([`${c.name} anchors the ecosystem. Invasive Risk drops!`, `${c.name} keeps the invaders in check.`]);
      if (c.kind === 'Invasive') return pickOne(V.inv(c.name));
      const suit = leadSuit(s), risk = s.trick.risk;
      const best = s.trick.plays.filter(x => cardMatches(x.card, suit, risk)).reduce((m, x) => Math.max(m, CARDS[x.card].impact), -1);
      return pickOne(cardMatches(a.card, suit, risk) && c.impact > best ? V.win(c.name) : V.low(c.name));
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

module.exports = {
  botSay,
  newGame, addPlayer, startGame, availableRoles, applyAction, legalCards, placeTargets, waitingOn, botAction,
  computeResults, trickWinner, cardMatches, MIN_PLAYERS, MAX_PLAYERS,
};
