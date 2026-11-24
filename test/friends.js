// Friends (requests by username, online status, table invites) and the free 0 EB table, against a real server on a
// throwaway data folder (never the live database).  Run: node test/friends.js
const { spawn } = require('child_process');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');
const PORT = 3980 + Math.floor(Math.random() * 9);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-friends-'));
const B = `http://localhost:${PORT}`;
const boot = `process.env.UPSTASH_REDIS_REST_URL='';process.env.UPSTASH_REDIS_REST_TOKEN='';process.env.STRIPE_SECRET_KEY='';` +
  `process.env.DATA_DIR=${JSON.stringify(DATA)};process.env.PORT='${PORT}';require('./server.js')`;
const srv = spawn(process.execPath, ['-e', boot], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = ''; srv.stdout.on('data', d => srvOut += d); srv.stderr.on('data', d => srvOut += d);

let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = async (op, body) => { const r = await fetch(`${B}/api/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return Object.assign(await r.json(), { status: r.status }); };
const guest = async () => (await post('auth/guest', { deviceKey: crypto.randomBytes(16).toString('hex') })).session;
function watch(room, token) {
  const w = { view: null };
  w.req = http.get(`${B}/api/events?room=${room}&token=${token}`, res => {
    let buf = '';
    res.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = /^data: (.*)$/m.exec(chunk); if (data && !/^event:/m.test(chunk)) w.view = JSON.parse(data[1]);
      }
    });
  });
  w.req.on('error', () => {});
  return w;
}
const until = async (fn, ms, step = 100) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(step); } return !!(await fn()); };

(async () => {
  if (!await until(() => /listening|http:\/\//i.test(srvOut), 8000)) throw new Error('server did not start:\n' + srvOut);
  const [aS, bS, cS] = [await guest(), await guest(), await guest()];
  const name = async (s, n) => (await post('profile', { session: s, gamertag: n })).me;
  const aMe = await name(aS, 'Alice Tester'), bMe = await name(bS, 'Bobcat'), cMe = await name(cS, 'Cormorant');

  console.log('Friend requests');
  let r = await post('friends/request', { session: aS, username: 'nobody-here' });
  ok(r.status === 400 && /username/.test(r.error), 'an unknown username is refused');
  r = await post('friends/request', { session: aS, username: 'alice tester' });
  ok(r.status === 400, "you can't friend yourself");
  r = await post('friends/request', { session: aS, username: 'BOBCAT' });
  ok(r.status === 200 && r.status !== 400 && r.to === 'Bobcat' && r.outgoing.length === 1, 'a request goes to a username (any capitals)');
  r = await post('friends/request', { session: aS, username: 'Bobcat' });
  ok(r.status === 400 && /already sent/.test(r.error), "the same request can't be sent twice");
  let fb = await post('friends', { session: bS });
  ok(fb.incoming.length === 1 && fb.incoming[0].username === 'Alice Tester' && fb.friends.length === 0, 'it shows up in their incoming requests');
  r = await post('friends/respond', { session: bS, id: fb.incoming[0].id, accept: true });
  ok(r.status === 200 && r.friends.length === 1 && r.incoming.length === 0, 'accepting makes you friends');
  let fa = await post('friends', { session: aS });
  ok(fa.friends.length === 1 && fa.friends[0].username === 'Bobcat' && fa.outgoing.length === 0, 'both sides see each other');
  ok(fa.friends[0].online === true, 'a friend who was just here shows as online');
  r = await post('friends/request', { session: cS, username: 'Alice Tester' });
  fa = await post('friends', { session: aS });
  r = await post('friends/request', { session: aS, username: 'Cormorant' });
  ok(r.status === 200 && r.status && r.friends.length === 2, 'asking someone who already asked you makes you friends at once');
  r = await post('friends/remove', { session: aS, id: r.friends.find(f => f.username === 'Cormorant').id });
  ok(r.friends.length === 1 && (await post('friends', { session: cS })).friends.length === 0, 'removing a friend removes it on both sides');
  await post('friends/request', { session: cS, username: 'Bobcat' });
  fb = await post('friends', { session: bS });
  r = await post('friends/respond', { session: bS, id: fb.incoming[0].id, accept: false });
  ok(r.incoming.length === 0 && (await post('friends', { session: cS })).outgoing.length === 0, 'declining clears the request on both sides');

  console.log('Invites');
  const t = await post('create', { session: aS });
  const wA = watch(t.room, t.token); await until(() => wA.view, 3000);
  fa = await post('friends', { session: aS });
  const bob = fa.friends[0];
  r = await post('friends/invite', { session: cS, id: aMe.id, room: t.room });
  ok(r.status === 400, 'only friends can be invited');
  r = await post('friends/invite', { session: bS, id: aMe.id, room: t.room });
  ok(r.status === 400 && /not at that table/.test(r.error), "you can't invite people to a table you're not at");
  r = await post('friends/invite', { session: aS, id: bob.id, room: t.room });
  ok(r.status === 200 && r.to === 'Bobcat', 'inviting a friend to your table');
  fa = await post('friends', { session: aS });
  ok(fa.friends[0].online && fa.friends[0].where === null, 'Bob is online (on the home page)');
  fb = await post('friends', { session: bS });
  ok(fb.invites.length === 1 && fb.invites[0].from === 'Alice Tester' && fb.invites[0].room === t.room, 'Bob sees the invite');
  const fAlice = fb.friends.find(f => f.username === 'Alice Tester');
  ok(fAlice.online && fAlice.where === 'lobby' && fAlice.room === null, "Alice shows as at a table (a private table's code isn't shared)");
  r = await post('join', { session: bS, room: fb.invites[0].room });
  ok(r.status === 200, 'Bob joins with the invite');
  const bTok = r.token, wB = watch(t.room, r.token);
  ok((await post('friends', { session: bS })).invites.length === 0, 'the invite is used up');
  ok(await until(() => wA.view && wA.view.lobby.length === 2, 3000), 'Bob is at the table');
  r = await post('friends/invite', { session: aS, id: bob.id, room: t.room });
  ok(r.status === 400 && /already at your table/.test(r.error), "no invite for someone who's already there");

  console.log('Free table');
  const before = [(await post('me', { session: aS })).me.balance, (await post('me', { session: bS })).me.balance];
  r = await post('lobby', { room: t.room, token: t.token, cmd: 'mult', mult: 0 });
  ok(r.status === 200, 'the host can pick a free table (no multiplier)');
  await until(() => wA.view && wA.view.mult === 0, 3000);
  ok(wA.view.lobby.every(m => m.confirmed), 'nobody has a bet to confirm at a free table');
  r = await post('lobby', { room: t.room, token: bTok, cmd: 'burn', on: true });
  ok(r.status === 403, 'only the host can turn on Burn');
  await post('lobby', { room: t.room, token: t.token, cmd: 'burn', on: true });
  ok(await until(() => wA.view && wA.view.burn === true, 3000), 'the host turns on the Burn modifier');
  r = await post('lobby', { room: t.room, token: t.token, cmd: 'start' });
  ok(r.status === 200, 'the game starts without anyone confirming');
  await until(() => wA.view && wA.view.phase !== 'lobby', 3000);
  ok(wA.view.burn === true && wA.view.hand.length === 10, `Burn: 4 players hold 10 cards, not 11 (${wA.view.hand.length})`);
  const after = [(await post('me', { session: aS })).me.balance, (await post('me', { session: bS })).me.balance];
  ok(after[0] === before[0] && after[1] === before[1], `nobody pays anything (${before.join('/')} → ${after.join('/')})`);
  fb = await post('friends', { session: bS });
  ok(fb.friends.find(f => f.username === 'Alice Tester').where === 'game', 'friends see you as "in a game"');
  r = await post('friends/invite', { session: aS, id: bob.id, room: t.room });
  ok(r.status === 400, "no invites once the game has started");

  wA.req.destroy(); wB.req.destroy(); srv.kill();
  console.log(fails ? `\n${fails} friends check(s) FAILED.` : '\nAll friends checks passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
