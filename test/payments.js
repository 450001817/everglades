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
  await throws(() => P.createCheckout(guest, 'eb100', 'http://x'), /Google/, 'guest accounts must sign in with Google first');
  await throws(() => P.createCheckout(buyer, 'eb9999', 'http://x'), /pack/, 'unknown packs are refused');
  const c = await P.createCheckout(buyer, 'eb1000', 'https://game.example');
  ok(c.url.startsWith('https://checkout.stripe.com/'), 'returns the Stripe Checkout URL');
  ok(lastBody.get('line_items[0][price_data][unit_amount]') === '900' && lastBody.get('line_items[0][price_data][currency]') === 'usd', '1000 EB pack costs $9.00 (price set by the server)');
  ok(lastBody.get('success_url') === 'https://game.example/?purchase=success&session_id={CHECKOUT_SESSION_ID}', 'success URL comes back to the game');
  ok(P.EB_PACKS.map(p => `${p.eb}:${p.cents}`).join(' ') === '100:100 500:500 1000:900', 'packs are 100 EB/$1, 500 EB/$5, 1000 EB/$9');

  console.log('Coming back from Stripe');
  let r = await P.confirm(buyer, c.id);
  ok(!r.credited && buyer.balance === start, 'an unpaid session adds nothing');
  await throws(() => P.confirm(other, c.id), /different account/, "can't claim someone else's purchase");
  await throws(() => P.confirm(buyer, 'not-a-session'), /Unknown/, 'junk session ids are refused');
  sessions[c.id].payment_status = 'paid';
  r = await P.confirm(buyer, c.id);
  ok(r.credited && buyer.balance === start + 1000, 'a paid session adds 1000 EB');
  r = await P.confirm(buyer, c.id);
  ok(!r.credited && r.already && buyer.balance === start + 1000, 'confirming again adds nothing more');

  console.log('Webhook');
  const c2 = await P.createCheckout(buyer, 'eb500', 'https://game.example');
  const s2 = Object.assign({}, sessions[c2.id], { payment_status: 'paid' });
  const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s2 } });
  ok(P.webhook(raw, 'garbage')[0] === 400, 'unsigned webhook is rejected');
  ok(P.webhook(raw, sign(raw, 'whsec_wrong'))[0] === 400, 'webhook signed with the wrong secret is rejected');
  ok(P.webhook(raw, sign(raw, 'whsec_fake', Math.floor(Date.now() / 1000) - 3600))[0] === 400, 'an old (replayed) webhook is rejected');
  ok(P.webhook(raw.replace('"eb500"', '"eb1000"'), sign(raw))[0] === 400, 'a tampered webhook body is rejected');
  ok(P.webhook(raw, sign(raw))[0] === 200 && buyer.balance === start + 1500, 'a signed webhook adds 500 EB');
  ok(P.webhook(raw, sign(raw))[0] === 200 && buyer.balance === start + 1500, 'Stripe retrying the webhook adds nothing more');
  sessions[c2.id].payment_status = 'paid';
  ok((await P.confirm(buyer, c2.id)).already && buyer.balance === start + 1500, 'the browser confirming after the webhook adds nothing more');

  console.log('Tampered amounts');
  const c3 = await P.createCheckout(buyer, 'eb100', 'https://game.example');
  const s3 = Object.assign({}, sessions[c3.id], { payment_status: 'paid', amount_total: 1 });
  const raw3 = JSON.stringify({ id: 'evt_3', type: 'checkout.session.completed', data: { object: s3 } });
  ok(P.webhook(raw3, sign(raw3))[0] === 200 && buyer.balance === start + 1500, 'a session whose amount does not match its pack is not credited (and Stripe is told to stop retrying)');

  console.log('Refunds and disputes');
  const ev = (type, obj) => { const raw = JSON.stringify({ id: 'evt_' + type, type, data: { object: obj } }); return P.webhook(raw, sign(raw))[0]; };
  const pi = 'pi_' + c.id; // the 1000 EB purchase
  ev('charge.refunded', { payment_intent: pi, amount: 900, amount_refunded: 450 });
  ok(buyer.balance === start + 1000, 'a half refund of the 1000 EB pack takes back 500 EB');
  ev('charge.refunded', { payment_intent: pi, amount: 900, amount_refunded: 450 });
  ok(buyer.balance === start + 1000, 'the same refund event again takes nothing more');
  ev('charge.refunded', { payment_intent: pi, amount: 900, amount_refunded: 900 });
  ok(buyer.balance === start + 500, 'refunding the rest takes back all 1000 EB');
  const pi2 = 'pi_' + c2.id; // the 500 EB purchase
  ev('charge.dispute.created', { payment_intent: pi2 });
  ok(buyer.balance === start, 'a dispute takes back the 500 EB');
  ev('charge.dispute.closed', { payment_intent: pi2, status: 'won' });
  ok(buyer.balance === start + 500, 'winning the dispute gives them back');
  ok(ev('charge.refunded', { payment_intent: 'pi_unknown', amount: 100, amount_refunded: 100 }) === 200, 'refunds of payments that are not Eco-buck packs are ignored');

  await A.flush();
  const saved = JSON.stringify(fs.readdirSync(process.env.DATA_DIR).map(f => fs.readFileSync(path.join(process.env.DATA_DIR, f), 'utf8')));
  ok(saved.includes(c.id) && saved.includes(c2.id), 'credited payments are saved (and remembered after a restart)');
  console.log(fails ? `\n${fails} payment check(s) FAILED.` : '\nAll payment checks passed.');
  process.exit(fails ? 1 : 0);
})();
