// Everglades — the bots' logic engine.
//
// The bots think in terms of an *evaluation*: an estimate of every player's final score from the current position
// (map objectives as soft probabilities that firm up as the game runs out, tricks won plus the tricks their hand
// is likely to win, and each role's bonus goals). A bot's value for a position is
//   free-for-all:  its own estimate  − a weighted mix of the leading opponent's and the field's estimates
//   partners:      its team's estimate − the best other team's estimate
//   co-op:         all players' estimates − the Anaconda's estimate
// so every decision weighs scoring its own points against holding back (disrupting) whoever threatens to win,
// and teammates play for the team rather than for themselves.
//
// Big decisions (which card to play, which biome to travel to, whether and which Disruption to commit) are
// searched: the bot samples several possible deals of the cards it can't see (it never peeks at hidden hands or
// at face-down Disruptions), plays the rest of the trick out in each with a quick policy, and picks the move
// with the best average value. Small decisions (abilities, which token to hunt or place, Disruption effects)
// compare the evaluation one step ahead.
'use strict';
const { CARDS, REGIONS, BIOMES, ROLES, DISRUPTIONS } = require('./public/data.js');
const REGION_IDS = Object.keys(REGIONS);
const SUITS = ['Wetland', 'Water', 'Land'];
const L = x => 1 / (1 + Math.exp(-x));
const BUDGET = +process.env.BOT_BUDGET || 900; // play-outs per decision (a few ms each) // logistic: a soft "is this above zero?"

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

module.exports = function makeAI(G) {
  // ---------- copying positions ----------
  // A private copy to experiment on: no log/events, all seats driven by the quick policy, endings skipped.
  function clone(s) {
    const { log, events, ...rest } = s;
    const c = JSON.parse(JSON.stringify(rest));
    c.log = []; c.events = []; c.sim = true;
    for (const pl of c.players) pl.bot = true;
    return c;
  }
  // Re-deal the cards `me` can't see (other hands and the face-down leftovers), keeping hand sizes.
  function determinize(c, me) {
    const others = c.players.map((_, k) => k).filter(k => k !== me && !c.players[k].boss);
    const pool = shuffle([...others.flatMap(k => c.players[k].hand), ...c.discard]);
    let i = 0;
    for (const k of others) { const n = c.players[k].hand.length; c.players[k].hand = pool.slice(i, i + n); i += n; }
    c.discard = pool.slice(i);
    if (c.coop && me !== c.bossIdx) shuffle(c.players[c.bossIdx].hand); // the Anaconda's deck order is unknown
    // Disruptions others hold are hidden too: re-deal them from the unseen ones
    if (c.disruptions) {
      const seen = new Set([...(c.players[me].dis || []), ...((c.trick && c.trick.dis) || []).map(d => d.card)]);
      const unseen = shuffle(Object.keys(DISRUPTIONS).filter(d => !seen.has(d)));
      let j = 0;
      for (const k of others) { const n = (c.players[k].dis || []).length; c.players[k].dis = unseen.slice(j, j + n); j += n; }
    }
  }
  // Play on with the quick policy until the current trick is over (or the game ends).
  function finishTrick(c) {
    for (let g = 0; g < 400 && c.phase !== 'ended' && c.trick; g++) {
      if (c.phase === 'disrupt' && c.dcommit) { G.autoBots(c); continue; }
      const w = G.waitingOn(c);
      if (w < 0) break;
      G.applyAction(c, w, G.simpleBot(c, w));
    }
  }

  // ---------- evaluation ----------
  const handStrength = id => { const c = CARDS[id]; return c.impact * c.impact * (c.kind === 'Invasive' ? 0.45 : 1); };
  // How strong each player's hand is for each suit. Cards a viewer can't see count at the average of the unseen pool.
  function strengths(s, viewer, known) {
    const sOf = (id, suit) => { const c = CARDS[id]; return c.kind === 'Invasive' ? handStrength(id) : c.habitat === suit ? handStrength(id) : 0.08 * handStrength(id); };
    let avg = null;
    if (!known) {
      const hidden = [...s.players.flatMap((pl, k) => k === viewer || pl.boss ? [] : pl.hand), ...s.discard];
      avg = {};
      for (const suit of SUITS) avg[suit] = hidden.length ? hidden.reduce((a, id) => a + sOf(id, suit), 0) / hidden.length : 0;
    }
    return s.players.map((pl, k) => {
      const o = {};
      for (const suit of SUITS) o[suit] = (known || k === viewer || pl.boss) ? pl.hand.reduce((a, id) => a + sOf(id, suit), 0) : pl.hand.length * avg[suit];
      return o;
    });
  }
  // Tricks still to play after the current one is settled.
  function tricksLeft(s) {
    const people = s.players.filter(pl => !pl.boss);
    let r = Math.max(0, ...people.map(pl => pl.hand.length));
    if (s.coop) r = Math.min(r, Math.ceil(s.players[s.bossIdx].hand.length / Math.max(1, s.np)));
    return r;
  }
  // How often each suit will come up from here (the travel row and the biome deck).
  function suitMix(s) {
    const ids = [...s.travel, ...s.biomeDeck];
    const m = { Wetland: 0, Water: 0, Land: 0 };
    for (const id of ids) m[BIOMES[id].suit]++;
    const n = ids.length || 1;
    for (const k of SUITS) m[k] /= n;
    return m;
  }

  // Estimated final score of every seat (index-aligned with s.players; the Anaconda's too in co-op).
  function estimates(s, viewer, known) {
    const b = s.board, R = tricksLeft(s);
    const sig = 0.6 + 0.45 * R;            // how much a token margin can still swing
    const tsig = 0.5 + 0.3 * R;            // how much a trick count can still swing
    const S = strengths(s, viewer, known), mix = suitMix(s);
    const tot = {}; for (const suit of SUITS) tot[suit] = S.reduce((a, o) => a + o[suit], 0) || 1;
    // expected future tricks, overall and per suit
    const fut = S.map(o => { const f = {}; let all = 0; for (const suit of SUITS) { f[suit] = R * mix[suit] * o[suit] / tot[suit]; all += f[suit]; } f.all = all; return f; });
    const won = s.players.map(pl => pl.biomesWon.length);
    const totN = REGION_IDS.reduce((a, r) => a + b[r].n, 0), totI = REGION_IDS.reduce((a, r) => a + b[r].i, 0);
    const met = (r, want) => L(((want === 'N' ? b[r].n - b[r].i : b[r].i - b[r].n) - 0.5) / sig);
    const people = s.players.map((pl, k) => k).filter(k => !s.players[k].boss);
    const suitTricks = (k, suit) => s.players[k].biomesWon.filter(id => BIOMES[id].suit === suit).length + fut[k][suit];
    const totalTricks = k => won[k] + fut[k].all;

    const est = s.players.map((pl, k) => {
      if (pl.boss) return 0;
      const Rl = ROLES[pl.role]; if (!Rl) return 0;
      const objs = Object.keys(Rl.map);
      const mets = objs.map(r => met(r, Rl.map[r]));
      let v = mets.reduce((a, x) => a + x, 0) * Rl.mapPts + 5 * totalTricks(k);
      const others = people.filter(q => q !== k);
      switch (pl.role) {
        case 'Conservationist':
          v += Rl.majorityPts * L((totN - totI - 0.5) / (sig * 1.6));
          v += pl.triggeredCrisis ? 0 : Rl.noCrisisPts * Math.pow(0.96, R);
          break;
        case 'Fisherman': case 'Hunter': {
          const suit = pl.role === 'Fisherman' ? 'Water' : 'Land';
          const pop = objs.reduce((a, r) => a + b[r].n + b[r].i, 0);
          v += (pl.role === 'Fisherman' ? 10 : 15) * L((pop - 24.5) / (1 + sig));
          const mine = suitTricks(k, suit), best = Math.max(0, ...others.map(q => suitTricks(q, suit)));
          if (mine > 0.05) v += 15 * L((mine - best + 0.25) / tsig);
          break;
        }
        case 'LandDeveloper': {
          const e = REGION_IDS.reduce((a, r) => a + L((0.5 - b[r].n - b[r].i) / (0.35 + 0.25 * R)), 0);
          v += Rl.emptyPts * L((e - (Rl.emptyNeed - 0.5)) / 0.45);
          const mine = totalTricks(k), best = Math.max(0, ...others.map(totalTricks));
          if (mine > 0.05) v += 10 * L((mine - best + 0.25) / tsig);
          break;
        }
        case 'Researcher': {
          const tax = new Set(pl.pile.map(c => CARDS[c].taxon)).size;
          const gain = R > 0 ? Math.min(2.5, 1.2 * fut[k].all + 0.6) : 0; // winning a trick brings new taxa
          v += 15 * L((tax + gain - 5.5) / 0.6);
          const mine = totalTricks(k), least = Math.min(...others.map(totalTricks));
          v += 10 * L((least - mine + 0.25) / tsig);
          break;
        }
        case 'Tourist': {
          v += Rl.allMetPts * mets.reduce((a, x) => a * x, 1);
          const off = pl.biomesWon.filter(id => !Rl.map[BIOMES[id].region]).length;
          const inObj = objs.length / REGION_IDS.length;
          if (off === 0) v += Rl.onlyObjPts * (pl.biomesWon.length ? 1 : (R > 0 ? 0.6 : 0)) * Math.pow(inObj, fut[k].all * 0.6);
          break;
        }
      }
      return v;
    });
    if (s.coop) {
      const boss = s.bossIdx;
      let unmet = 0;
      for (const k of people) { const m = ROLES[s.players[k].role].map; for (const r of Object.keys(m)) unmet += 1 - met(r, m[r]); }
      const infested = REGION_IDS.reduce((a, r) => a + met(r, 'I'), 0);
      est[boss] = unmet * G.COOP.unmetMap + infested * G.COOP.infestedRegion + G.COOP.trick * (won[boss] + fut[boss].all);
    }
    return est;
  }

  // The value of a position for player `me` (see the top of this file).
  function value(s, me, known) {
    const est = estimates(s, me, known);
    if (s.coop) return s.players.reduce((a, pl, k) => a + (pl.boss ? -est[k] : est[k]), 0);
    if (s.partners) {
      const team = {};
      s.players.forEach((pl, k) => { team[pl.team] = (team[pl.team] || 0) + est[k]; });
      const mine = team[s.players[me].team];
      const rest = Object.keys(team).filter(t => String(t) !== String(s.players[me].team)).map(t => team[t]);
      return mine - 0.75 * Math.max(...rest) - 0.25 * rest.reduce((a, x) => a + x, 0) / rest.length;
    }
    const others = est.filter((_, k) => k !== me);
    return est[me] - 0.65 * Math.max(...others) - 0.35 * others.reduce((a, x) => a + x, 0) / others.length;
  }

  // ---------- searching ----------
  // Average value of each candidate action over K sampled deals, each played out to the end of the trick.
  // `prep(c, a)` applies candidate a to copy c (it may also set things up first).
  function search(s, p, cands, prep, budget = BUDGET) {
    if (cands.length === 1) return cands[0];
    const K = Math.max(8, Math.min(80, Math.ceil(budget / cands.length)));
    const tot = cands.map(() => 0);
    for (let w = 0; w < K; w++) {
      const base = clone(s); determinize(base, p);
      const str = JSON.stringify(base);
      cands.forEach((a, i) => {
        const c = JSON.parse(str);
        try { prep(c, a); finishTrick(c); tot[i] += value(c, p, true); } catch (e) { tot[i] -= 1e6; }
      });
    }
    let bi = 0;
    tot.forEach((v, i) => { if (v > tot[bi] + 1e-9) bi = i; });
    return cands[bi];
  }
  // One step ahead with the evaluation (for small choices). Returns [best action, its value, value of `base`].
  function greedy(s, p, cands) {
    let best = null, bv = -Infinity;
    for (const a of cands) {
      const c = clone(s);
      try { G.applyAction(c, p, a); } catch (e) { continue; }
      const v = value(c, p, false);
      if (v > bv) { bv = v; best = a; }
    }
    return [best, bv];
  }

  // ---------- decisions ----------
  function decide(s, p) {
    const pl = s.players[p];
    if (s.phase === 'draft') return { type: 'pickRole', role: pickRole(s, p) };
    if (s.phase === 'disrupt' && s.step && s.step.type === 'dis') return disStep(s, p);
    if (s.phase === 'choose') return chooseBiome(s, p);
    if (s.tourPeek) return tourDecide(s, p);
    if (s.step && s.step.type === 'place') return greedy(s, p, G.placeTargets(s).map(r => ({ type: 'place', region: r })))[0];
    if (s.step && s.step.type === 'predate') {
      const c = [{ type: 'predateDone' }];
      for (const r of s.step.regions) for (const k of ['n', 'i']) if (s.board[r][k] > 0) c.push({ type: 'predate', region: r, kind: k });
      return greedy(s, p, c)[0];
    }
    if (s.phase === 'play' && !s.step && !s.abilityUsed) { const a = ability(s, p); if (a) return a; }
    return playCard(s, p);
  }

  function playCard(s, p) {
    const pl = s.players[p];
    const cands = [];
    for (const card of G.legalCards(s, p)) {
      cands.push({ type: 'play', card });
      if (pl.role === 'Conservationist' && CARDS[card].kind === 'Invasive') cands.push({ type: 'play', card, populate: false });
    }
    return search(s, p, cands, (c, a) => G.applyAction(c, p, a));
  }

  function chooseBiome(s, p) {
    const opts = [...s.travel];
    if (s.guide && s.guide.p === p) opts.push(...s.guide.options.filter(id => !opts.includes(id)));
    return search(s, p, opts.map(biome => ({ type: 'chooseBiome', biome })), (c, a) => G.applyAction(c, p, a), BUDGET * 0.7);
  }

  // Tourist peek: keep the top biome if the bot would rather see it come up.
  function tourDecide(s, p) {
    const id = s.tourPeek, pl = s.players[p], Rl = ROLES[pl.role];
    const S = strengths(s, p, false), suit = BIOMES[id].suit;
    const share = S[p][suit] / (S.reduce((a, o) => a + o[suit], 0) || 1);
    const people = s.players.filter(x => !x.boss).length;
    const good = (Rl.map[BIOMES[id].region] ? 1 : 0) + (share > 1 / people ? 1 : 0) - (pl.role === 'Researcher' ? 1 : 0);
    return { type: 'tourDecide', bottom: good <= 0 };
  }

  // Start-of-turn abilities: used when they improve the position.
  function ability(s, p) {
    const pl = s.players[p], role = pl.role;
    if (role === 'Tourist') return s.biomeDeck.length ? { type: 'ability' } : null; // free information
    const cands = [];
    if (role === 'LandDeveloper') {
      for (const r of REGION_IDS) for (const k of ['n', 'i']) if (s.board[r][k] > 0) cands.push({ type: 'ability', region: r, kind: k });
    } else if (['Fisherman', 'Hunter', 'Researcher'].includes(role) && pl.pile.length) {
      const need = role === 'Fisherman' ? 'Water' : role === 'Hunter' ? 'Land' : null;
      const pile = [...new Set(pl.pile)].filter(c => !need || CARDS[c].habitat === need);
      const hand = [...new Set(pl.hand)];
      for (const pc of pile) for (const hc of hand) cands.push({ type: 'ability', handCard: hc, pileCard: pc });
    }
    if (!cands.length) return null;
    const base = value(s, p, false);
    const [best, bv] = greedy(s, p, cands.slice(0, 160));
    return best && bv > base + 0.4 ? best : null;
  }

  // Choices inside a Disruption's effect: one token (or destination) at a time, judged one step ahead.
  function disStep(s, p) {
    const st = s.step, cands = [];
    if (!st.must) cands.push({ type: 'dDone' });
    if (st.mode === 'remove') {
      const regions = st.quota ? Object.keys(st.quota).filter(r => st.quota[r] > 0) : st.regions;
      for (const r of regions) for (const k of st.kinds) if (s.board[r][k] > 0) cands.push({ type: 'dRemove', region: r, kind: k });
    } else if (st.mode === 'dest') {
      for (const r of REGION_IDS) if (r !== st.from && !(s.trick.blocked && r === G.trickRegion(s))) cands.push({ type: 'dDest', region: r });
    } else if (st.mode === 'scatter') {
      for (const r of REGION_IDS) if (r !== st.from && !(s.trick.blocked && r === G.trickRegion(s)))
        for (const k of ['n', 'i']) if (st.pool[k] > 0) cands.push({ type: 'dScatter', region: r, kind: k });
    } else if (st.mode === 'steal') {
      s.players.forEach((o, k) => { if (k !== p) for (const c of new Set(o.pile)) cands.push({ type: 'dSteal', from: k, card: c }); });
    }
    const [best] = greedy(s, p, cands);
    return best || { type: 'dDone' };
  }

  // Role draft: what the hand is good for (with a little variety).
  function pickRole(s, p) {
    const hand = s.players[p].hand.map(id => CARDS[id]);
    const top = (f, n) => hand.filter(f).map(c => c.impact).sort((a, b) => b - a).slice(0, n).reduce((a, x) => a + x, 0);
    const nat = c => c.kind === 'Native';
    const allPow = hand.reduce((a, c) => a + c.impact * c.impact * (nat(c) ? 1 : 0.45), 0) / Math.max(1, hand.length);
    const score = {
      Fisherman: 6 + top(c => nat(c) && c.habitat === 'Water', 4) * 0.55,
      Hunter: 7 + top(c => nat(c) && c.habitat === 'Land', 4) * 0.6,
      LandDeveloper: 4 + allPow * 0.32,
      Researcher: 26 - allPow * 0.38 + new Set(hand.map(c => c.taxon)).size * 0.4,
      Conservationist: 10 + hand.filter(nat).length * 0.45 + hand.filter(c => c.keystone).length * 1.5,
      Tourist: 15,
    };
    if (s.coop) { score.Conservationist += 3; score.Hunter += 2; } // Native-majority goals pull together against the Anaconda
    const av = G.availableRoles(s);
    let best = av[0], bv = -Infinity;
    for (const r of av) { const v = (score[r] || 10) + Math.random() * 3; if (v > bv) { bv = v; best = r; } }
    return best;
  }

  // Disruption draft: a rating for each card by role.
  const DIS_BASE = { NatureDocumentary: 3.2, ChangingSeasons: 3, Liberation: 2.4, HuntingSeason: 3, CatchAndRelease: 3, TakeBribes: 2.4,
    EcologicalProtest: 2.4, TravelersGuidebook: 2.4, BountyHunting: 2.5, Hurricane: 2, LandDevelopment: 2, Drought: 2.2, Flood: 2,
    MassMigration: 2, RunawayPets: 1.8, FertilizerLeaching: 1.8, WildFire: 2, RedTide: 2 };
  const DIS_ROLE = {
    Conservationist: { BountyHunting: 1.5, EcologicalProtest: 1, CatchAndRelease: 0.5, FertilizerLeaching: 0.5 },
    Fisherman: { NatureDocumentary: 1.5, TakeBribes: 0.5, FertilizerLeaching: 1, CatchAndRelease: 0.5 },
    Hunter: { NatureDocumentary: 1.5, TakeBribes: 0.5, FertilizerLeaching: 1.2, CatchAndRelease: 0.5 },
    LandDeveloper: { HuntingSeason: 1.2, Hurricane: 1.5, LandDevelopment: 1, WildFire: 1, RedTide: 1, NatureDocumentary: 0.8, RunawayPets: 0.8, FertilizerLeaching: -1 },
    Researcher: { ChangingSeasons: 1.2, Liberation: 1.5, NatureDocumentary: -1.5, TakeBribes: -1, RunawayPets: 0.6 },
    Tourist: { TravelersGuidebook: 1.3, RunawayPets: 1, CatchAndRelease: 0.6, ChangingSeasons: 0.5 },
  };
  function draftPick(s, p) {
    const pack = s.ddraft.packs[p], role = s.players[p].role;
    let best = pack[0], bv = -Infinity;
    for (const id of pack) { const v = (DIS_BASE[id] || 2) + ((DIS_ROLE[role] || {})[id] || 0) + Math.random() * 0.6; if (v > bv) { bv = v; best = id; } }
    return best;
  }

  // Commit a Disruption face down (or pass). Each option is played out against sampled deals and sampled
  // commits by everyone else (the bot can't see what anyone else committed). Spending a card has to beat the
  // value of keeping it for a later round.
  function commit(s, p) {
    const pl = s.players[p];
    const held = [...new Set(pl.dis || [])];
    if (!held.length) return null;
    const left = pl.hand.length; // rounds this player still plays, including this one
    const keep = left <= (pl.dis || []).length ? 0 : 1.6 + 0.08 * Math.min(left, 10);
    const cands = [null, ...held];
    const K = Math.max(14, Math.round(BUDGET / 25)), tot = cands.map(() => 0);
    for (let w = 0; w < K; w++) {
      const base = clone(s); determinize(base, p);
      for (let q = 0; q < base.np; q++) if (q !== p) base.dcommit.picks[q] = (base.players[q].dis || []).length ? G.simpleCommit(base, q) : null;
      delete base.dcommit.picks[p];
      const str = JSON.stringify(base);
      cands.forEach((card, i) => {
        const c = JSON.parse(str);
        try { G.applyAction(c, p, { type: 'commitDis', card }); finishTrick(c); tot[i] += value(c, p, true) - (card ? keep : 0); } catch (e) { tot[i] -= 1e6; }
      });
    }
    let bi = 0;
    tot.forEach((v, i) => { if (v > tot[bi] + 1e-9) bi = i; });
    return cands[bi];
  }

  return { decide, draftPick, commit, value, estimates };
};
