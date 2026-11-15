// Checks buying Eco-bucks (payments.js) against a pretend Stripe: no internet or real keys needed.
// Run: node test/payments.js
const os = require('os'), fs = require('fs'), path = require('path'), crypto = require('crypto');
process.env.UPSTASH_REDIS_REST_URL = ''; process.env.UPSTASH_REDIS_REST_TOKEN = '';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-pay-'));
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
process.env.GOOGLE_CLIENT_ID = 'x.apps.googleusercontent.com';
const A = require('../accounts.js');
const P = require('../payments.js');

let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) fails++; };
const throws = async (fn, re, msg) => { try { await fn(); ok(false, msg); } catch (e) { ok(re.test(e.message), msg + ` (${e.message})`); } };

// pretend Stripe: remembers created sessions; tests can mark them paid
const sessions = {}; let lastBody = null;
global.fetch = async (url, opt) => {
  const u = new URL(url);
  if (opt.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
    lastBody = new URLSearchParams(opt.body);
    const id = 'cs_test_' + crypto.randomBytes(6).toString('hex');
    sessions[id] = { id, object: 'checkout.session', mode: 'payment', payment_status: 'unpaid', livemode: false, currency: 'usd',
      amount_total: +lastBody.get('line_items[0][price_data][unit_amount]'), client_reference_id: lastBody.get('client_reference_id'),
      payment_intent: 'pi_' + id, metadata: { accountId: lastBody.get('metadata[accountId]'), pack: lastBody.get('metadata[pack]') } };
    return { ok: true, json: async () => ({ id, url: 'https://checkout.stripe.com/c/pay/' + id }) };
  }
  const m = u.pathname.match(/^\/v1\/checkout\/sessions\/(.+)$/);
  if (opt.method === 'GET' && m && sessions[m[1]]) return { ok: true, json: async () => sessions[m[1]] };
  return { ok: false, status: 404, json: async () => ({ error: { message: 'No such session' } }) };
};
const sign = (raw, secret = 'whsec_fake', t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;

(async () => {
  await A.ready;
  const guest = A.guestLogin(crypto.randomBytes(16).toString('hex')).account;
  const buyer = A.guestLogin(crypto.randomBytes(16).toString('hex')).account; buyer.guest = false; // stands in for a Google account
  const other = A.guestLogin(crypto.randomBytes(16).toString('hex')).account; other.guest = false;
  const start = buyer.balance;

  console.log('Checkout');
  await throws(() => P.createCheckout(guest, 'eb600', 'http://x'), /Google/, 'guest accounts must sign in with Google first');
  await throws(() => P.createCheckout(buyer, 'eb9999', 'http://x'), /pack/, 'unknown packs are refused');
  const c = await P.createCheckout(buyer, 'eb1400', 'https://game.example');
  ok(c.url.startsWith('https://checkout.stripe.com/'), 'returns the Stripe Checkout URL');
  ok(lastBody.get('line_items[0][price_data][unit_amount]') === '1000' && lastBody.get('line_items[0][price_data][currency]') === 'usd', '1400 EB pack costs $10.00 (price set by the server)');
  ok(lastBody.get('success_url') === 'https://game.example/?purchase=success&session_id={CHECKOUT_SESSION_ID}', 'success URL comes back to the game');
  await throws(() => P.createCheckout(buyer, 'eb500', 'http://x'), /pack/, 'a retired pack (500 EB/$5) can no longer be bought');
  ok(P.publicConfig().packs.map(p => `${p.eb}:${p.cents}`).join(' ') === '100:100 600:500 1400:1000 3500:2000', 'packs are 100 EB/$1, 600 EB/$5, 1400 EB/$10, 3500 EB/$20');

  console.log('Coming back from Stripe');
  let r = await P.confirm(buyer, c.id);
  ok(!r.credited && buyer.balance === start, 'an unpaid session adds nothing');
  await throws(() => P.confirm(other, c.id), /different account/, "can't claim someone else's purchase");
  await throws(() => P.confirm(buyer, 'not-a-session'), /Unknown/, 'junk session ids are refused');
  sessions[c.id].payment_status = 'paid';
  r = await P.confirm(buyer, c.id);
  ok(r.credited && buyer.balance === start + 1400, 'a paid session adds 1400 EB');
  r = await P.confirm(buyer, c.id);
  ok(!r.credited && r.already && buyer.balance === start + 1400, 'confirming again adds nothing more');

  console.log('Webhook');
  const c2 = await P.createCheckout(buyer, 'eb600', 'https://game.example');
  const s2 = Object.assign({}, sessions[c2.id], { payment_status: 'paid' });
  const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s2 } });
  ok(P.webhook(raw, 'garbage')[0] === 400, 'unsigned webhook is rejected');
  ok(P.webhook(raw, sign(raw, 'whsec_wrong'))[0] === 400, 'webhook signed with the wrong secret is rejected');
  ok(P.webhook(raw, sign(raw, 'whsec_fake', Math.floor(Date.now() / 1000) - 3600))[0] === 400, 'an old (replayed) webhook is rejected');
  ok(P.webhook(raw.replace('"eb600"', '"eb1400"'), sign(raw))[0] === 400, 'a tampered webhook body is rejected');
  ok(P.webhook(raw, sign(raw))[0] === 200 && buyer.balance === start + 2000, 'a signed webhook adds 600 EB');
  ok(P.webhook(raw, sign(raw))[0] === 200 && buyer.balance === start + 2000, 'Stripe retrying the webhook adds nothing more');
  sessions[c2.id].payment_status = 'paid';
  ok((await P.confirm(buyer, c2.id)).already && buyer.balance === start + 2000, 'the browser confirming after the webhook adds nothing more');

  console.log('Tampered amounts');
  const c3 = await P.createCheckout(buyer, 'eb3500', 'https://game.example');
  ok(lastBody.get('line_items[0][price_data][unit_amount]') === '2000', '3500 EB pack costs $20.00');
  const s3 = Object.assign({}, sessions[c3.id], { payment_status: 'paid', amount_total: 1 });
  const raw3 = JSON.stringify({ id: 'evt_3', type: 'checkout.session.completed', data: { object: s3 } });
  ok(P.webhook(raw3, sign(raw3))[0] === 200 && buyer.balance === start + 2000, 'a session whose amount does not match its pack is not credited (and Stripe is told to stop retrying)');

  console.log('Refunds and disputes');
  const ev = (type, obj) => { const raw = JSON.stringify({ id: 'evt_' + type, type, data: { object: obj } }); return P.webhook(raw, sign(raw))[0]; };
  const pi = 'pi_' + c.id; // the 1400 EB purchase
  ev('charge.refunded', { payment_intent: pi, amount: 1000, amount_refunded: 500 });
  ok(buyer.balance === start + 1300, 'a half refund of the 1400 EB pack takes back 700 EB');
  ev('charge.refunded', { payment_intent: pi, amount: 1000, amount_refunded: 500 });
  ok(buyer.balance === start + 1300, 'the same refund event again takes nothing more');
  ev('charge.refunded', { payment_intent: pi, amount: 1000, amount_refunded: 1000 });
  ok(buyer.balance === start + 600, 'refunding the rest takes back all 1400 EB');
  const pi2 = 'pi_' + c2.id; // the 600 EB purchase
  ev('charge.dispute.created', { payment_intent: pi2 });
  ok(buyer.balance === start, 'a dispute takes back the 600 EB');
  ev('charge.dispute.closed', { payment_intent: pi2, status: 'won' });
  ok(buyer.balance === start + 600, 'winning the dispute gives them back');
  ok(ev('charge.refunded', { payment_intent: 'pi_unknown', amount: 100, amount_refunded: 100 }) === 200, 'refunds of payments that are not Eco-buck packs are ignored');

  await A.flush();
  const saved = JSON.stringify(fs.readdirSync(process.env.DATA_DIR).map(f => fs.readFileSync(path.join(process.env.DATA_DIR, f), 'utf8')));
  ok(saved.includes(c.id) && saved.includes(c2.id), 'credited payments are saved (and remembered after a restart)');
  console.log(fails ? `\n${fails} payment check(s) FAILED.` : '\nAll payment checks passed.');
  process.exit(fails ? 1 : 0);
})();
