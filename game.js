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
  const roles = shuffle(Object.keys(ROLES));
  s.players = shuffle(s.players); // random seating
  const deck = shuffle(Object.keys(CARDS));
  const per = Math.floor(deck.length / n);
  s.players.forEach((pl, i) => {
    pl.role = roles[i];
    pl.hand = deck.slice(i * per, (i + 1) * per);
    pl.pile = []; pl.biomesWon = []; pl.triggeredCrisis = false;
  });
  s.discard = deck.slice(n * per); // leftover cards are discarded
  s.biomeDeck = shuffle(Object.keys(BIOMES));
  s.travel = s.biomeDeck.splice(0, 3);
  s.board = emptyBoard();
  s.leader = 0; s.turn = 0; s.round = 1;
  s.phase = 'choose'; s.trick = null; s.step = null; s.lastTrick = null;
  s.abilityUsed = false; s.tourPeek = null; s.results = null;
  log(s, `Game started. Each player holds ${per} cards. ${pname(s, 0)} leads the first round.`);
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
  if (c.keystone) { s.trick.risk = c.impact; msg += ` Keystone: Invasive Risk is now ${c.impact}.`; }
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

function afterPlacement(s, cardId, regions, before) {
  const c = CARDS[cardId];
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
  if (s.phase === 'choose') return s.leader;
  if (s.phase === 'play') return s.turn;
  return -1;
}

// ---------- simple bot ----------
function botAction(s, p) {
  const pl = s.players[p];
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
  if (s.tourPeek) return { type: 'tourDecide', bottom: Math.random() < 0.5 };
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
  // Pick a card: win cheaply if possible, otherwise dump the lowest Impact card.
  const legal = legalCards(s, p);
  const suit = leadSuit(s);
  const risk = s.trick.risk;
  const currentBest = s.trick.plays.filter(x => cardMatches(x.card, suit, risk)).reduce((m, x) => Math.max(m, CARDS[x.card].impact), -1);
  const winners = legal.filter(c => cardMatches(c, suit, CARDS[c].keystone ? CARDS[c].impact : risk) && CARDS[c].impact > currentBest)
    .sort((a, b) => CARDS[a].impact - CARDS[b].impact);
  const wantsFew = pl.role === 'Researcher';
  let card;
  if (winners.length && !wantsFew) card = winners[0];
  else card = legal.slice().sort((a, b) => CARDS[a].impact - CARDS[b].impact)[0];
  const populate = !(pl.role === 'Conservationist' && CARDS[card].kind === 'Invasive') ? undefined : false;
  return { type: 'play', card, populate };
}

module.exports = {
  newGame, addPlayer, startGame, applyAction, legalCards, placeTargets, waitingOn, botAction,
  computeResults, trickWinner, cardMatches, MIN_PLAYERS, MAX_PLAYERS,
};
