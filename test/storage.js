// Checks that accounts survive a restart when stored in Upstash Redis, using a pretend Upstash
// (an in-memory stand-in for its REST API), so no real database or internet is needed.
// Run: node test/storage.js
const os = require('os'), fs = require('fs'), path = require('path');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) fails++; };

// ---- pretend Upstash: hashes in memory, the /pipeline endpoint, a command counter ----
const redis = new Map(); let commands = 0, up = true;
function runCmd([op, key, ...args]) {
  commands++;
  const h = redis.get(key) || new Map();
  if (op === 'HGETALL') return { result: [...h].flat() };
  if (op === 'HSET') { let n = 0; for (let i = 0; i < args.length; i += 2) { if (!h.has(args[i])) n++; h.set(args[i], args[i + 1]); } redis.set(key, h); return { result: n }; }
  if (op === 'HDEL') { let n = 0; for (const f of args) if (h.delete(f)) n++; return { result: n }; }
  return { error: 'ERR unknown command ' + op };
}
global.fetch = async (url, opts) => {
  if (!up) throw new Error('connect ECONNREFUSED');
  if (opts.headers.Authorization !== 'Bearer test-token') return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) };
  const body = JSON.parse(opts.body);
  const out = url.endsWith('/pipeline') ? body.map(runCmd) : runCmd(body);
  return { ok: true, status: 200, json: async () => out };
};

(async () => {
  const { upstashStore } = require('../storage.js');
  // 1) the store on its own: only changes are sent
  const s1 = upstashStore('https://fake.upstash.io', 'test-token', 't:');
  ok(await s1.load(['accounts']) === null, 'empty database loads as nothing');
  const db = { accounts: { a: { n: 1 }, b: { n: 2 } }, tags: { x: 'a' } };
  await s1.save(db); const afterFirst = commands;
  await s1.save(db);
  ok(commands === afterFirst, 'saving again with no changes sends nothing');
  db.accounts.a.n = 99; await s1.save(db);
  ok(commands === afterFirst + 1 && redis.get('t:accounts').size === 2, 'changing one record sends just one command');
  delete db.accounts.b; await s1.save(db);
  ok(!redis.get('t:accounts').has('b'), 'deleted records are removed');
  const loaded = await upstashStore('https://fake.upstash.io', 'test-token', 't:').load(['accounts', 'tags']);
  ok(JSON.stringify(loaded) === JSON.stringify({ accounts: { a: { n: 99 } }, tags: { x: 'a' } }), 'a fresh connection loads exactly what was saved');

  // 2) the whole account system across a "restart"
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-store-'));
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts: { old1: { id: 'old1', gamertag: 'OldTimer', balance: 777, avatar: 'char:Hunter', owned: [], cardWins: {}, stats: {} } }, tags: { oldtimer: 'old1' } }));
  Object.assign(process.env, { DATA_DIR: dir, UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'test-token', UPSTASH_PREFIX: 'eg:' });
  const fresh = () => { for (const k of Object.keys(require.cache)) if (/accounts\.js$|storage\.js$/.test(k)) delete require.cache[k]; return require('../accounts.js'); };
  let A = fresh(); await A.ready;
  ok(A.storeName().startsWith('Upstash'), 'with the Upstash settings, accounts use Upstash');
  ok(A.get('old1') && A.get('old1').balance === 777, 'accounts from the old local file are copied up on the first boot');
  const g = A.guestLogin('ab'.repeat(24)).account;
  g.balance = 1234; A.setProfile(g, { gamertag: 'Survivor' });
  await A.flush();

  A = fresh(); await A.ready; // "restart"
  const back = A.get(g.id);
  ok(back && back.balance === 1234 && back.gamertag === 'Survivor', `after a restart the account is back with its Eco-bucks (${back && back.balance} EB)`);
  ok(A.get('old1') && A.get('old1').balance === 777, 'the copied-up account survives too');
  ok(A.guestLogin('ab'.repeat(24)).account.id === g.id, 'signing in again finds the same account');

  // 3) a failed connection at boot stops the server instead of starting with empty wallets
  up = false; A = fresh();
  let refused = false; try { await A.ready; } catch { refused = true; }
  ok(refused, 'if Upstash cannot be reached at boot, loading fails (the server then refuses to start)');

  console.log(fails ? `\n${fails} check(s) failed.` : '\nAll storage checks passed.');
  process.exit(fails ? 1 : 0);
})();
