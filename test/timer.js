// Turn timer, public/private tables and Join a random public table, against a real server (on a throwaway data
// folder, never the live database) with the turn limit shortened to 1.2 seconds.  Run: node test/timer.js
const { spawn } = require('child_process');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');
const PORT = 3990 + Math.floor(Math.random() * 9);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-timer-'));
const B = `http://localhost:${PORT}`;
// the database settings are blanked inside the process, so .env can't point this server at the live database
const boot = `process.env.UPSTASH_REDIS_REST_URL='';process.env.UPSTASH_REDIS_REST_TOKEN='';process.env.STRIPE_SECRET_KEY='';` +
  `process.env.DATA_DIR=${JSON.stringify(DATA)};process.env.PORT='${PORT}';process.env.TURN_MS='1200';require('./server.js')`;
const srv = spawn(process.execPath, ['-e', boot], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = ''; srv.stdout.on('data', d => srvOut += d); srv.stderr.on('data', d => srvOut += d);

let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = async (op, body) => { const r = await fetch(`${B}/api/${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return Object.assign(await r.json(), { status: r.status }); };
const guest = async () => (await post('auth/guest', { deviceKey: crypto.randomBytes(16).toString('hex') })).session;
// a live connection to a table, like a browser: keeps the latest view and notes a 'kicked' event
function watch(room, token) {
  const w = { view: null, kicked: false };
  w.req = http.get(`${B}/api/events?room=${room}&token=${token}`, res => {
    let buf = '';
    res.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^event: kicked/m.test(chunk)) w.kicked = true;
        const data = /^data: (.*)$/m.exec(chunk); if (data && !/^event:/m.test(chunk)) w.view = JSON.parse(data[1]);
      }
    });
  });
  w.req.on('error', () => {});
  return w;
}
const until = async (fn, ms, step = 100) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(step); } return !!fn(); };

(async () => {
  if (!await until(() => /listening|http:\/\//i.test(srvOut), 8000)) throw new Error('server did not start:\n' + srvOut);

  console.log('Public and private tables');
  const hostS = await guest(), joinS = await guest(), loneS = await guest();
  const priv = await post('create', { session: hostS });
  const wPriv = watch(priv.room, priv.token); await until(() => wPriv.view, 3000);
  ok(wPriv.view && wPriv.view.public === false && wPriv.view.turnTimer === true, 'a new table is private, with the turn timer on');
  let q = await post('quickjoin', { session: joinS });
  ok(q.created && q.room !== priv.room, 'with no public tables open, Join a random public table starts a new public one');
  const wPub = watch(q.room, q.token); await until(() => wPub.view, 3000);
  ok(wPub.view.public === true, '...and that table is public');
  const q2 = await post('quickjoin', { session: loneS });
  ok(!q2.created && q2.room === q.room, 'the next player is put into that open public table');
  let r = await post('lobby', { room: q.room, token: q.token, cmd: 'timer', on: false });
  ok(r.status === 400, "public tables can't turn the timer off");
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'timer', on: false }); await sleep(200);
  ok(wPriv.view.turnTimer === false, 'private tables can turn it off');
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'visibility', public: true }); await sleep(200);
  ok(wPriv.view.public === true && wPriv.view.turnTimer === true, 'making a table public turns the timer back on');
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'visibility', public: false });
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'timer', on: false });

  console.log('Confirming the bid');
  r = await post('lobby', { room: priv.room, token: priv.token, cmd: 'start' });
  ok(r.status === 400 && /confirm/.test(r.error), "the game can't start until everyone confirms the bid");
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'confirm', on: true }); await sleep(200);
  ok(wPriv.view.lobby.find(x => x.pid === wPriv.view.yourPid).confirmed, 'confirming shows on my seat');
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'buyin', amount: 50 }); await sleep(200);
  ok(!wPriv.view.lobby.find(x => x.pid === wPriv.view.yourPid).confirmed, 'changing the bid clears confirmations');
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'buyin', amount: 150 });
  r = await post('lobby', { room: priv.room, token: priv.token, cmd: 'confirm', on: true });
  ok(r.status === 400 && /need 150 EB/.test(r.error), "can't confirm a bid you can't cover (a new guest has 50 EB, the bid is 150)");
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'buyin', amount: 5 });
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'confirm', on: true });
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'mode', mode: 'coop' }); await sleep(200);
  ok(!wPriv.view.lobby.find(x => x.pid === wPriv.view.yourPid).confirmed, 'changing the game mode clears confirmations too');
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'mode', mode: 'solo' });
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'confirm', on: true });

  console.log('Timer off (private table)');
  await post('lobby', { room: priv.room, token: priv.token, cmd: 'speed', speed: 'fast' });
  r = await post('lobby', { room: priv.room, token: priv.token, cmd: 'start' });
  ok(r.status === 200, 'once everyone has confirmed, the game starts');
  await until(() => wPriv.view && wPriv.view.phase !== 'lobby' && wPriv.view.waiting === wPriv.view.you, 15000);
  await sleep(3500); // well past 1.2 s
  ok(!wPriv.view.deadline && !wPriv.kicked && wPriv.view.players[wPriv.view.you].strikes === 0, 'nothing happens when the timer is off');

  console.log('Timer on: strikes, then a bot takes the seat');
  const soloS = await guest();
  const t = await post('create', { session: soloS });
  const w = watch(t.room, t.token); await until(() => w.view, 3000);
  await post('lobby', { room: t.room, token: t.token, cmd: 'speed', speed: 'fast' });
  await post('lobby', { room: t.room, token: t.token, cmd: 'confirm', on: true });
  await post('lobby', { room: t.room, token: t.token, cmd: 'start' });
  await until(() => w.view && w.view.deadline && w.view.deadline.seats.includes(w.view.you), 20000);
  ok(!!(w.view.deadline && w.view.deadline.at > Date.now()), 'when it is my turn the view carries my deadline');
  const seat = w.view.you;
  await until(() => w.view.players[seat].strikes === 1, 20000);
  ok(w.view.players[seat].strikes === 1 && w.view.log.some(l => /ran out of time.*\(1\/3\)/.test(l)), 'running out of time once: a bot plays that turn, strike 1/3');
  ok(!w.kicked, '...and I keep my seat');
  await until(() => w.kicked, 60000, 200);
  ok(w.kicked, 'the third time I am removed (my browser is told so)');
  const after = watch(t.room, t.token); await sleep(800);
  ok(!after.view, 'my old seat link no longer works');
  r = await post('lobby', { room: t.room, token: t.token, cmd: 'ping' });
  ok(r.status === 410, 'and my requests are refused');
  const spy = await post('quickjoin', { session: await guest() }); // a fresh account just to read the game state
  ok(spy.room !== t.room, "a game in progress isn't offered to Join a random public table");

  srv.kill();
  console.log(fails ? `\n${fails} timer check(s) FAILED.` : '\nAll timer checks passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
