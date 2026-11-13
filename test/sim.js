const G = require('../game.js');
const { CARDS } = require('../public/data.js');
let games = 0, crises = 0, unmatched = 0, tricks = 0; const wins = {};
// character reactions: every event must produce valid reactions without throwing
const ANIMS = new Set(['idle', 'think', 'signature', 'cheer', 'upset', 'shock']);
const reacts = {}, lines = { said: 0, events: 0 };
let evSeen = 0;
function checkReactions(s) {
  for (const ev of s.events.filter(e => e.id > evSeen)) {
    evSeen = ev.id; lines.events++;
    const list = G.reactionsFor(s, ev);
    const seats = new Set();
    for (const r of list) {
      if (!ANIMS.has(r.anim)) throw new Error('bad anim ' + r.anim);
      if (seats.has(r.seat)) throw new Error('two reactions for one seat');
      seats.add(r.seat);
      if (r.line && /\{\w+\}|undefined|null/.test(r.line)) throw new Error('unfilled line: ' + r.line);
      const k = (s.players[r.seat].role || '?') + ':' + r.anim; reacts[k] = (reacts[k] || 0) + 1;
    }
    if (G.reactionLine(s, ev, list)) lines.said++;
  }
}
for (let g = 0; g < 500; g++) {
  const n = 2 + (g % 5);
  const s = G.newGame();
  for (let i = 0; i < n; i++) G.addPlayer(s, { id: 'p' + i, name: 'P' + i, bot: true });
  G.startGame(s, { coop: g % 7 === 3 }); // every 7th game is co-op vs The Anaconda
  evSeen = 0;
  let guard = 0;
  while (s.phase !== 'ended') {
    if (++guard > 5000) throw new Error('stuck ' + JSON.stringify(s.step) + s.phase);
    const p = G.waitingOn(s);
    // sometimes try abilities
    if (s.phase === 'play' && !s.step && !s.abilityUsed && Math.random() < 0.3) {
      const pl = s.players[p];
      try {
        if (pl.role === 'LandDeveloper') { const r = Object.keys(s.board).find(r => s.board[r].i > 0); if (r) G.applyAction(s, p, { type: 'ability', region: r, kind: 'i' }); }
        else if (pl.role === 'Tourist') G.applyAction(s, p, { type: 'ability' });
        else if (pl.role === 'Researcher' && pl.pile.length) G.applyAction(s, p, { type: 'ability', handCard: pl.hand[0], pileCard: pl.pile[0] });
      } catch (e) { if (!e.userError) throw e; }
    }
    const a = G.botAction(s, p);
    G.applyAction(s, p, a);
    checkReactions(s);
    for (const r in s.board) if (s.board[r].n < 0 || s.board[r].i < 0) throw new Error('negative');
  }
  games++;
  if (s.coop) continue; // co-op balance is checked by coopsim.js; here it just has to run cleanly
  const total = s.players.reduce((a, p) => a + p.pile.length, 0) + s.discard.length;
  if (total !== 45) throw new Error('card count ' + total);
  s.results.scores.forEach(r => { if (s.results.winners.includes(r.p)) wins[r.role] = (wins[r.role] || 0) + 1; });
  crises += s.log.filter(l => l.startsWith('INVASIVE')).length;
  unmatched += s.log.filter(l => l.includes('no card matched')).length;
  tricks += s.players.reduce((a, p) => a + p.biomesWon.length, 0);
}
console.log({ games, tricks, crises, unmatched, wins });
console.log('reactions per game event:', (Object.values(reacts).reduce((a, b) => a + b, 0) / lines.events).toFixed(2),
  '| bot lines per event:', (lines.said / lines.events).toFixed(2));
console.log(Object.entries(reacts).sort().map(([k, v]) => `${k}=${v}`).join('  '));
