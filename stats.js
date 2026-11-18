// Everglades — game records and balance metrics.
//
// Every finished game (not the tutorial) is boiled down to a small summary (summarize, called by server.js), which
// then updates:
//  * each signed-in player's record (a.record): games and wins overall, per character and per mode. Players see
//    their own record in the Stats dropdown.
//  * one server-wide record (db.stats.server): win rates per character and seat, score and ending averages, card and
//    Disruption performance, game length and the last few games. Only admin accounts (ADMIN_EMAILS) can see it.
// Wins: classic — the top score (ties all win); partners — the top team; co-op — everyone, if the players beat
// the Anaconda.
'use strict';
const RECENT_MAX = 40;

// ---------- during a game: server.js feeds every game event in here ----------
function newTally() { return { start: Date.now(), cards: {}, dis: [], draft: [] }; }
function tallyEvent(t, s, ev) {
  if (!t) return;
  const boss = p => !!(s.players[p] && s.players[p].boss);
  const card = id => (t.cards[id] = t.cards[id] || { played: 0, won: 0 });
  if (ev.type === 'play' && !boss(ev.p)) card(ev.card).played++;
  else if (ev.type === 'trick' && !boss(ev.p)) card(ev.card).won++;
  else if (ev.type === 'disrupt') t.dis.push({ p: ev.p, card: ev.card });
  else if (ev.type === 'role' && !boss(ev.p)) t.draft.push(ev.p);
}

// ---------- at the end: one summary of the finished game ----------
// seatAccount(seat) -> the account id of the person in that seat (null for bots and guests without one)
function summarize(s, tally, seatAccount, extra = {}) {
  const R = s.results; if (!R) return null;
  const mode = s.coop ? 'coop' : s.partners ? 'partners' : 'classic';
  const people = s.players.map((pl, seat) => ({ pl, seat })).filter(x => !x.pl.boss);
  const t = tally || newTally();
  const seats = people.map(({ pl, seat }) => {
    const sc = R.scores.find(r => r.p === seat) || {};
    return {
      seat, role: pl.role, bot: !!pl.bot, accountId: pl.bot ? null : seatAccount(seat) || null,
      score: sc.total || 0, good: !!sc.good, win: R.winners.includes(seat),
      tricks: pl.biomesWon.length, crises: pl.stats ? pl.stats.crises : 0,
      pick: t.draft.indexOf(seat), // place in the role draft (0 = first pick; -1 = unknown)
    };
  });
  const totals = seats.map(x => x.score).sort((a, b) => b - a);
  return {
    at: Date.now(), ms: Date.now() - t.start, mode, n: seats.length, rounds: s.round || 0,
    disruptions: !!s.disruptions, buyIn: extra.buyIn || 0, easy: !!s.easyBots,
    playersWin: mode === 'coop' ? !!R.playersWin : undefined, anaconda: mode === 'coop' && R.anaconda ? R.anaconda.total : undefined,
    margin: mode === 'classic' && totals.length > 1 ? totals[0] - totals[1] : undefined,
    seats, cards: t.cards, dis: t.dis.map(d => ({ card: d.card, win: R.winners.includes(d.p) })),
  };
}

// ---------- updating the records ----------
const bump = (obj, key, fields) => { const o = (obj[key] = obj[key] || {}); for (const [k, v] of Object.entries(fields)) o[k] = (o[k] || 0) + v; return o; };
function newServer() {
  return { since: Date.now(), games: 0, ms: 0, rounds: 0, humanSeats: 0, botSeats: 0, ties: 0, disruptionGames: 0, crises: 0,
    modes: {}, counts: {}, roles: {}, coopRoles: {}, seatOrder: {}, cards: {}, dis: {}, recent: [] };
}
function record(db, g) {
  if (!g) return;
  db.stats = db.stats || {};
  const S = db.stats.server = db.stats.server || newServer();
  const competitive = g.mode !== 'coop';
  const winners = g.seats.filter(x => x.win);
  S.games++; S.ms += g.ms; S.rounds += g.rounds;
  if (g.disruptions) S.disruptionGames++;
  if (competitive && g.mode === 'classic' && winners.length > 1) S.ties++;
  bump(S.modes, g.mode, { games: 1, wins: g.mode === 'coop' && g.playersWin ? 1 : 0, rounds: g.rounds });
  bump(S.counts, String(g.n), { games: 1, topScore: competitive ? Math.max(...g.seats.map(x => x.score)) : 0, margin: g.margin || 0, margins: g.margin !== undefined ? 1 : 0,
    coop: g.mode === 'coop' ? 1 : 0, coopWins: g.mode === 'coop' && g.playersWin ? 1 : 0 });
  // a fair share of wins: 1 in n for classic, 1 team in n/2 for partners
  const fair = g.mode === 'partners' ? 2 / g.n : 1 / g.n;
  // games with easy bots (a new player's table) stay out of the balance tables below, which assume standard bots;
  // they get their own count, and how often the people at those tables won
  if (g.easy) {
    S.easyGames = (S.easyGames || 0) + 1;
    for (const x of g.seats) if (!x.bot) { S.easySeats = (S.easySeats || 0) + 1; if (x.win) S.easyWins = (S.easyWins || 0) + 1; }
  }
  for (const x of g.seats) {
    if (x.bot) S.botSeats++; else S.humanSeats++;
    S.crises += x.crises;
    if (!x.role || g.easy) continue;
    if (competitive) {
      bump(S.roles, x.role, { seats: 1, wins: x.win ? 1 : 0, fair, hSeats: x.bot ? 0 : 1, hWins: !x.bot && x.win ? 1 : 0,
        score: x.score, good: x.good ? 1 : 0, tricks: x.tricks, crises: x.crises,
        picks: x.pick >= 0 ? 1 : 0, pickSum: x.pick >= 0 ? x.pick + 1 : 0, first: x.pick === 0 ? 1 : 0 });
      if (g.mode === 'classic') bump(S.seatOrder, String(x.seat), { seats: 1, wins: x.win ? 1 : 0, fair });
    } else bump(S.coopRoles, x.role, { seats: 1, wins: x.win ? 1 : 0, good: x.good ? 1 : 0, score: x.score });
  }
  if (!g.easy) for (const [id, c] of Object.entries(g.cards || {})) bump(S.cards, id, { played: c.played, won: c.won });
  if (!g.easy) for (const d of g.dis || []) bump(S.dis, d.card, { played: 1, wins: d.win ? 1 : 0, fair: g.mode === 'coop' ? 0 : fair, coop: g.mode === 'coop' ? 1 : 0 });
  S.recent.unshift({ at: g.at, ms: g.ms, mode: g.mode, n: g.n, rounds: g.rounds, dis: g.disruptions, buyIn: g.buyIn, easy: g.easy || undefined, playersWin: g.playersWin, anaconda: g.anaconda,
    seats: g.seats.map(x => ({ role: x.role, bot: x.bot, score: x.score, win: x.win })) });
  S.recent.length = Math.min(S.recent.length, RECENT_MAX);

  // each person's own record
  for (const x of g.seats) {
    const a = x.accountId && db.accounts[x.accountId];
    if (!a) continue;
    const r = a.record = a.record || { games: 0, wins: 0, since: Date.now(), roles: {}, modes: {} };
    r.games++; if (x.win) r.wins++;
    r.last = g.at;
    if (x.role) bump(r.roles, x.role, { games: 1, wins: x.win ? 1 : 0, score: competitive ? x.score : 0, scored: competitive ? 1 : 0 });
    bump(r.modes, g.mode, { games: 1, wins: x.win ? 1 : 0 });
  }
}

// ---------- what the browser sees ----------
function playerView(a) {
  const r = a.record || { games: 0, wins: 0, roles: {}, modes: {} };
  return { games: r.games, wins: r.wins, since: r.since || null, roles: r.roles, modes: r.modes };
}
function serverView(db) {
  const S = (db.stats && db.stats.server) || newServer();
  const accts = Object.values(db.accounts);
  const week = Date.now() - 7 * 864e5;
  return Object.assign({}, S, {
    accounts: { total: accts.length, google: accts.filter(a => a.google).length, guests: accts.filter(a => a.guest).length,
      played: accts.filter(a => a.record && a.record.games).length, activeWeek: accts.filter(a => a.record && a.record.last > week).length },
  });
}

module.exports = { newTally, tallyEvent, summarize, record, playerView, serverView };
