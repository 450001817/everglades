// Chat: Partners team chat (there is no whole-table chat), DMs between friends, mutes and the message filter, against a real server
// on a throwaway data folder (never the live database).  Run: node test/chat.js
const { spawn } = require('child_process');
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto'), http = require('http');
const PORT = 3960 + Math.floor(Math.random() * 9);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-chat-'));
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
// a player's event stream: the latest game view, every chat message (talk events) and DM nudges
function watch(room, token) {
  const w = { view: null, talk: [], dm: [] };
  w.req = http.get(`${B}/api/events?room=${room}&token=${token}`, res => {
    let buf = '';
    res.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(chunk), data = /^data: (.*)$/m.exec(chunk);
        if (!data) continue;
        if (!ev) w.view = JSON.parse(data[1]);
        else if (ev[1] === 'talk') w.talk.push(...JSON.parse(data[1]));
        else if (ev[1] === 'dm') w.dm.push(JSON.parse(data[1]));
      }
    });
  });
  w.req.on('error', () => {});
  return w;
}
const until = async (fn, ms, step = 50) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(step); } return !!(await fn()); };
const texts = w => w.talk.map(m => m.text);

(async () => {
  if (!await until(() => /listening|http:\/\//i.test(srvOut), 8000)) throw new Error('server did not start:\n' + srvOut);
  const S = [await guest(), await guest(), await guest(), await guest()];
  const names = ['Ana Heron', 'Ben Otter', 'Cy Ibis', 'Di Gator'];
  const me = [];
  for (let k = 0; k < 4; k++) me.push((await post('profile', { session: S[k], gamertag: names[k] })).me);

  console.log('No whole-table chat');
  const t = await post('create', { session: S[0] });
  const tok = [t.token];
  for (let k = 1; k < 4; k++) tok.push((await post('join', { session: S[k], room: t.room })).token);
  const w = tok.map(x => watch(t.room, x));
  await until(() => w.every(x => x.view), 3000);
  let r = await post('talk', { room: t.room, token: tok[0], text: 'Hello table!' });
  ok(r.status === 400 && /Partners/.test(r.error), 'a message to the whole table is refused');
  r = await post('talk', { room: t.room, token: tok[0], text: 'team only', team: true });
  ok(r.status === 400 && /Partners/.test(r.error), 'team chat needs a Partners table');
  await sleep(300);
  ok(w.every(x => x.talk.length === 0), 'nobody received anything');

  console.log('Team chat (Partners)');
  await post('lobby', { room: t.room, token: tok[0], cmd: 'mode', mode: 'partners' });
  await post('lobby', { room: t.room, token: tok[0], cmd: 'team', team: 0 });
  await post('lobby', { room: t.room, token: tok[1], cmd: 'team', team: 0 });
  await post('lobby', { room: t.room, token: tok[2], cmd: 'team', team: 1 });
  await post('lobby', { room: t.room, token: tok[3], cmd: 'team', team: 1 });
  await sleep(700);
  r = await post('talk', { room: t.room, token: tok[0], text: 'our secret plan' });
  ok(r.status === 200, 'with a team, a player can message it');
  ok(await until(() => texts(w[1]).includes('our secret plan'), 3000), 'their partner gets it at once');
  const m0 = w[1].talk.find(m => m.text === 'our secret plan');
  ok(m0.name === 'Ana Heron' && m0.team === 0 && m0.accountId === me[0].id, 'it carries the sender and their team');
  await sleep(300);
  ok(!texts(w[2]).includes('our secret plan') && !texts(w[3]).includes('our secret plan'), 'the other team never sees it');
  await sleep(700);
  r = await post('talk', { room: t.room, token: tok[1], text: 'what the fuuuck' });
  ok(await until(() => texts(w[0]).includes('what the ******'), 3000), 'profanity is masked');
  await sleep(700);
  r = await post('talk', { room: t.room, token: tok[1], text: 'join me at www.example.com' });
  ok(r.status === 400 && /Links/.test(r.error), 'links are refused');
  await sleep(700);
  r = await post('talk', { room: t.room, token: tok[1], text: '    ' });
  ok(r.status === 400, 'an empty message is refused');
  await sleep(700);
  let sent = 0; for (let k = 0; k < 8; k++) if ((await post('talk', { room: t.room, token: tok[2], text: 'spam ' + k })).status === 200) sent++;
  ok(sent >= 1 && sent < 8, `sending too fast is limited (${sent} of 8 quick messages went through)`);
  const late = watch(t.room, tok[1]);
  ok(await until(() => texts(late).includes('our secret plan'), 3000), 'reconnecting brings the team chat so far');
  late.req.destroy();
  const spy = watch(t.room, tok[2]); await until(() => spy.talk.length, 3000); await sleep(200);
  ok(spy.talk.length > 0 && !texts(spy).includes('our secret plan'), "the other team's history never includes it");
  spy.req.destroy();

  console.log('Mutes');
  r = await post('chat/mute', { session: S[1], id: me[0].id, on: true });
  ok(r.status === 200 && r.me.muted.length === 1 && r.me.muted[0].username === 'Ana Heron', 'a player can mute someone');
  await sleep(700);
  await post('talk', { room: t.room, token: tok[0], text: 'can you hear me?' });
  await sleep(500);
  ok(!texts(w[1]).includes('can you hear me?'), "the player who muted them doesn't see their messages");
  r = await post('chat/mute', { session: S[1], id: me[1].id, on: true });
  ok(r.status === 400, "you can't mute yourself");
  r = await post('chat/mute', { session: S[1], id: me[0].id, on: false });
  ok(r.status === 200 && r.me.muted.length === 0, 'and can unmute them');
  await sleep(700);
  await post('talk', { room: t.room, token: tok[0], text: 'how about now?' });
  ok(await until(() => texts(w[1]).includes('how about now?'), 3000), 'after unmuting, their messages come through again');

  console.log('Co-op: all the players are one team');
  const c = await post('create', { session: S[0] });
  const ctok = [c.token, (await post('join', { session: S[1], room: c.room })).token];
  const cw = ctok.map(x => watch(c.room, x));
  await until(() => cw.every(x => x.view), 3000);
  await post('lobby', { room: c.room, token: ctok[0], cmd: 'mode', mode: 'coop' });
  await sleep(700);
  r = await post('talk', { room: c.room, token: ctok[0], text: 'lets beat the snake' });
  ok(r.status === 200 && await until(() => texts(cw[1]).includes('lets beat the snake'), 3000), 'a co-op table has team chat for everyone at it');
  for (const x of cw) x.req.destroy();

  console.log('DMs between friends');
  r = await post('dm/send', { session: S[0], id: me[1].id, text: 'psst' });
  ok(r.status === 400 && /friends/.test(r.error), 'you can only message friends');
  await post('friends/request', { session: S[0], username: 'Ben Otter' });
  const inc = await post('friends', { session: S[1] });
  await post('friends/respond', { session: S[1], id: inc.incoming[0].id, accept: true });
  r = await post('dm/send', { session: S[0], id: me[1].id, text: 'hey Ben, good luck!' });
  ok(r.status === 200 && r.msgs.length === 1 && r.msgs[0].mine && r.msgs[0].text === 'hey Ben, good luck!', 'friends can message each other');
  ok(await until(() => w[1].dm.some(d => d.from === me[0].id), 3000), "a friend at a table is told at once on their game's event stream");
  let fb = await post('friends', { session: S[1] });
  ok(fb.unread[me[0].id] === 1, 'it counts as unread in their friends list');
  r = await post('dm/list', { session: S[1], id: me[0].id });
  ok(r.msgs.length === 1 && !r.msgs[0].mine && r.msgs[0].text === 'hey Ben, good luck!' && !r.unread[me[0].id], 'opening the conversation shows it and marks it read');
  await sleep(700);
  r = await post('dm/send', { session: S[1], id: me[0].id, text: 'thanks!! sh!t, I need it' });
  ok(r.status === 200 && r.msgs[1].text === 'thanks!! ****, I need it', 'DMs are filtered too');
  await post('friends/remove', { session: S[0], id: me[1].id });
  r = await post('dm/list', { session: S[1], id: me[0].id });
  ok(r.status === 400, 'after unfriending, the conversation is closed');
  await post('friends/request', { session: S[0], username: 'Ben Otter' });
  const inc2 = await post('friends', { session: S[1] });
  await post('friends/respond', { session: S[1], id: inc2.incoming[0].id, accept: true });
  r = await post('dm/list', { session: S[1], id: me[0].id });
  ok(r.status === 200 && r.msgs.length === 0, 'and its messages were deleted');

  for (const x of w) x.req.destroy();
  srv.kill();
  await sleep(300);
  // the DM store is saved in the accounts data (the 'dms' table)
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'accounts.json'), 'utf8'));
  ok(saved.dms && typeof saved.dms === 'object', 'the account database has a dms table');

  console.log('Keeping the latest 50 (accounts.js, with the send limit relaxed)');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-chat2-'));
  const C = require('../chat.js'); C.RATE.gapMs = 0; C.RATE.burst = 1e9;
  const A = require('../accounts.js'); await A.ready;
  const x = A.guestLogin(crypto.randomBytes(24).toString('hex')).account, y = A.guestLogin(crypto.randomBytes(24).toString('hex')).account;
  A.setProfile(x, { gamertag: 'Xeno' }); A.setProfile(y, { gamertag: 'Yarrow' });
  A.friendRequest(x, 'Yarrow'); A.friendRespond(y, x.id, true);
  for (let k = 0; k < 60; k++) A.dmSend(x, y.id, 'note ' + k);
  const kept = A.dmList(y, x.id);
  ok(kept.length === 50 && kept[0].text === 'note 10' && kept[49].text === 'note 59', 'a conversation keeps its latest 50 messages');
  A.setMute(y, x.id, true);
  ok(A.dmList(y, x.id).length === 0 && !A.dmUnread(y)[x.id], "a muted friend's DMs are hidden");
  await A.flush();
  console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll chat checks passed.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); console.error(srvOut); srv.kill(); process.exit(1); });
