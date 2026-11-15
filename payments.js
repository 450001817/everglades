// Everglades — buying Eco-bucks with real money, through Stripe Checkout.
//
// How a purchase works:
//   1. The player picks a pack in the store. The server asks Stripe for a Checkout page for that pack
//      (the price comes from EB_PACKS here, never from the browser) and sends the player there.
//   2. The player pays on Stripe's own page. Card details never touch this server.
//   4. Refunds and disputes (also webhooks) take those Eco-bucks back again.
//   3. Stripe tells us the payment went through, in two ways, and whichever arrives first adds the Eco-bucks:
//        - the webhook  POST /api/stripe/webhook  (signed by Stripe; checked with STRIPE_WEBHOOK_SECRET)
//        - the player's browser coming back to the site, which asks the server to check the session with Stripe
//      Each Checkout session is credited only once (accounts.js remembers it in the `payments` table).
//
// Settings (environment variables, e.g. in Render > Environment):
//   STRIPE_SECRET_KEY      sk_test_... while testing, sk_live_... for real money
//   STRIPE_WEBHOOK_SECRET  whsec_... from the webhook endpoint you add in the Stripe dashboard
//   PUBLIC_URL             optional, e.g. https://everglades.onrender.com (where Stripe sends players back)
// Without STRIPE_SECRET_KEY the Eco-buck packs are simply not offered.
'use strict';
const crypto = require('crypto');
const A = require('./accounts.js');

// `retired` packs are no longer sold, but payments for them still credit (a checkout opened before the change).
const EB_PACKS = [
  { id: 'eb100', eb: 100, cents: 100 },
  { id: 'eb600', eb: 600, cents: 500 },
  { id: 'eb1400', eb: 1400, cents: 1000 },
  { id: 'eb3500', eb: 3500, cents: 2000, tag: 'Best value' },
  // retired
  { id: 'eb500', eb: 500, cents: 500, retired: true },
  { id: 'eb1000', eb: 1000, cents: 900, retired: true },
  { id: 'eb2000', eb: 2000, cents: 1500, retired: true },
];
const API = 'https://api.stripe.com/v1';
const key = () => process.env.STRIPE_SECRET_KEY || '';
const enabled = () => /^(sk|rk)_(test|live)_/.test(key());
const userErr = msg => Object.assign(new Error(msg), { userError: true });

function publicConfig() {
  return { enabled: enabled(), testMode: key().includes('_test_'), packs: EB_PACKS.filter(p => !p.retired) };
}

// Stripe's API takes form-encoded bodies with bracketed keys (line_items[0][price_data][currency]=usd).
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v && typeof v === 'object') form(v, name, out);
    else if (v !== undefined && v !== null) out.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
async function stripe(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
    body: body ? form(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Stripe error:', r.status, j.error && j.error.message);
    throw userErr('The payment service had a problem. Please try again in a moment.');
  }
  return j;
}

// Step 1: a Stripe Checkout page for one pack. Returns the URL to send the player to.
async function createCheckout(account, packId, origin) {
  if (!enabled()) throw userErr('Eco-buck packs are not available right now.');
  const pack = EB_PACKS.find(p => p.id === packId && !p.retired);
  if (!pack) throw userErr('Pick one of the Eco-buck packs.');
  // Guest accounts live in one browser; buying on one risks losing what you paid for. Ask for Google sign-in
  // (when this server has Google sign-in set up).
  if (account.guest && process.env.GOOGLE_CLIENT_ID) throw userErr('Please sign in with Google before buying Eco-bucks, so your purchase is kept safe on every device.');
  const base = (process.env.PUBLIC_URL || origin).replace(/\/+$/, '');
  const s = await stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    line_items: { 0: { quantity: 1, price_data: { currency: 'usd', unit_amount: pack.cents,
      product_data: { name: `${pack.eb.toLocaleString('en-US')} Eco-bucks`, description: 'In-game currency for Everglades. Eco-bucks have no cash value.' } } } },
    client_reference_id: account.id,
    metadata: { accountId: account.id, pack: pack.id, eb: pack.eb },
    payment_intent_data: { metadata: { accountId: account.id, pack: pack.id } },
    success_url: `${base}/?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/?purchase=cancel`,
  });
  return { url: s.url, id: s.id };
}

// Step 3: credit a paid session (safe to call any number of times; only the first one adds Eco-bucks).
function fulfil(session) {
  if (!session || session.object !== 'checkout.session' || session.mode !== 'payment') return { credited: false, reason: 'not a payment' };
  if (session.payment_status !== 'paid') return { credited: false, reason: 'not paid yet' };
  const m = session.metadata || {};
  return A.creditPurchase({ sessionId: session.id, accountId: m.accountId || session.client_reference_id, packId: m.pack,
    amount: session.amount_total, currency: session.currency, packs: EB_PACKS, livemode: !!session.livemode,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) });
}

// The browser came back from Stripe: look the session up with Stripe (never trust the browser) and credit it.
async function confirm(account, sessionId) {
  if (!enabled()) throw userErr('Eco-buck packs are not available right now.');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(String(sessionId || ''))) throw userErr('Unknown purchase.');
  const s = await stripe('GET', '/checkout/sessions/' + encodeURIComponent(sessionId));
  const owner = (s.metadata && s.metadata.accountId) || s.client_reference_id;
  if (owner !== account.id) throw userErr('That purchase belongs to a different account.');
  return fulfil(s);
}

// Stripe-Signature: "t=<unix time>,v1=<hex hmac>[,v1=...]", signed over "<t>.<raw body>" with the webhook secret.
function verifySignature(raw, header, secret, toleranceSec = 300, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = String(header).split(',').map(p => p.split('='));
  const t = (parts.find(p => p[0] === 't') || [])[1];
  const sigs = parts.filter(p => p[0] === 'v1').map(p => p[1]);
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest();
  return sigs.some(s => { const b = Buffer.from(s || '', 'hex'); return b.length === expected.length && crypto.timingSafeEqual(b, expected); });
}

// Stripe's webhook. Returns [status, body].
function webhook(raw, header) {
  if (!verifySignature(raw, header, process.env.STRIPE_WEBHOOK_SECRET)) return [400, { error: 'Bad signature.' }];
  let ev; try { ev = JSON.parse(raw); } catch { return [400, { error: 'Bad JSON.' }]; }
  if (ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') {
    try { const r = fulfil(ev.data.object); if (r.credited) console.log(`Eco-bucks bought: ${r.eb} EB for account ${r.accountId}`); }
    catch (e) {
      console.error('Could not credit purchase', ev.data && ev.data.object && ev.data.object.id, e.message);
      // a payment that can never be credited (e.g. it doesn't match a pack) is acknowledged so Stripe stops retrying;
      // anything unexpected gets a 500 and Stripe tries again later
      return e.userError ? [200, { received: true, ignored: e.message }] : [500, { error: 'Not credited.' }];
    }
  }
  // Refunds and disputes: take the Eco-bucks back (see adjustPurchase in accounts.js)
  const o = ev.data && ev.data.object;
  let adj = null;
  if (ev.type === 'charge.refunded' && o) adj = A.adjustPurchase(o.payment_intent, { refundedFraction: o.amount ? o.amount_refunded / o.amount : 1 });
  if (ev.type === 'charge.dispute.created' && o) adj = A.adjustPurchase(o.payment_intent, { disputed: true });
  if (ev.type === 'charge.dispute.closed' && o) adj = A.adjustPurchase(o.payment_intent, { disputed: o.status !== 'won' });
  if (adj && adj.changed) console.log(`Eco-bucks ${adj.eb < 0 ? 'taken back' : 'restored'} (${ev.type}): ${adj.eb} EB for account ${adj.accountId}`);
  return [200, { received: true }];
}

module.exports = { EB_PACKS, enabled, publicConfig, createCheckout, confirm, webhook, fulfil, verifySignature, form };
