// Game records: plays bot games (classic, partners, co-op, with Disruptions) through the same tally -> summary ->
// record path the server uses, then checks the per-player and server-wide numbers add up.
// usage: node test/stats.js
'use strict';
const assert = require('assert');
const G = require('../game.js');
const ST = require('../stats.js');

const db = { accounts: { acc1: { id: 'acc1' }, acc2: { id: 'acc2' } }, stats: {} };
function play(n, opts, humans) {
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true, simple: true, team: opts.partners ? i % (n / 2) : null });
  G.startGame(s, opts);
  const tally = ST.newTally();
  let seen = 0, guard = 0;
  const drain = () => { for (const ev of (s.events || []).filter(e => e.id > seen)) { ST.tallyEvent(tally, s, ev); seen = ev.id; } };
  while (s.phase !== 'ended') {
    if (++guard > 8000) throw new Error('stuck ' + s.phase);
    const p = G.waitingOn(s);
    if (p < 0) G.autoBots(s); else G.applyAction(s, p, G.botAction(s, p));
    drain();
  }
  // the "people": seats whose player id is in `humans` (they're still bots in the engine, which is fine here)
  const seatAccount = seat => humans[s.players[seat].id] || null;
  for (const pl of s.players) if (humans[pl.id]) pl.bot = false;
  const g = ST.summarize(s, tally, seatAccount, { mult: 1 });
  ST.record(db, g);
  return { s, g };
}

const runs = [];
for (let k = 0; k < 6; k++) runs.push(play(3 + (k % 3), { disruptions: k % 2 === 0 }, { p0: 'acc1', p1: 'acc2' }));
runs.push(play(4, { partners: true }, { p0: 'acc1' }));
runs.push(play(3, { coop: true, disruptions: true }, { p0: 'acc1', p2: 'acc2' }));

const S = db.stats.server;
assert.strictEqual(S.games, runs.length);
assert.strictEqual(S.recent.length, runs.length);
assert.strictEqual(S.humanSeats + S.botSeats, runs.reduce((a, r) => a + r.g.n, 0));
// every competitive seat landed in a role row; wins match the winners lists
const compRuns = runs.filter(r => r.g.mode !== 'coop');
const roleSeats = Object.values(S.roles).reduce((a, x) => a + x.seats, 0);
assert.strictEqual(roleSeats, compRuns.reduce((a, r) => a + r.g.n, 0));
assert.strictEqual(Object.values(S.roles).reduce((a, x) => a + x.wins, 0), compRuns.reduce((a, r) => a + r.g.seats.filter(x => x.win).length, 0));
// fair shares add up to one winning seat per classic game and one winning team (2 seats) per partners game
const fairWant = compRuns.reduce((a, r) => a + (r.g.mode === 'partners' ? 2 : 1), 0);
assert.ok(Math.abs(Object.values(S.roles).reduce((a, x) => a + x.fair, 0) - fairWant) < 1e-9);
// draft picks were seen for everyone
assert.ok(Object.values(S.roles).every(x => x.picks === x.seats), 'every seat has a draft pick');
// cards: every non-boss play counted; tricks won <= tricks played
const plays = Object.values(S.cards).reduce((a, c) => a + c.played, 0), won = Object.values(S.cards).reduce((a, c) => a + c.won, 0);
assert.ok(plays > 0 && won > 0 && won <= plays);
const totalTricks = runs.reduce((a, r) => a + r.s.players.filter(p => !p.boss).reduce((b, p) => b + p.biomesWon.length, 0), 0);
assert.strictEqual(won, totalTricks, 'one winning card per trick the players won');
// per-account records
const a1 = db.accounts.acc1.record, a2 = db.accounts.acc2.record;
assert.strictEqual(a1.games, runs.length);
assert.strictEqual(a2.games, runs.length - 1); // not in the partners game
const winsOf = acct => runs.reduce((a, r) => a + r.g.seats.filter(x => x.accountId === acct && x.win).length, 0);
assert.strictEqual(a1.wins, winsOf('acc1')); assert.strictEqual(a2.wins, winsOf('acc2'));
assert.strictEqual(Object.values(a1.roles).reduce((a, x) => a + x.games, 0), a1.games);
assert.strictEqual(a1.modes.coop.games, 1); assert.strictEqual(a1.modes.partners.games, 1);
// views
const pv = ST.playerView(db.accounts.acc1); assert.strictEqual(pv.games, a1.games);
const sv = ST.serverView(db); assert.strictEqual(sv.accounts.total, 2); assert.strictEqual(sv.accounts.played, 2);
JSON.parse(JSON.stringify(sv)); // storable / sendable
console.log(`stats: ${S.games} games recorded, ${plays} cards played, ${Object.keys(S.dis).length} Disruptions seen — all checks passed`);
