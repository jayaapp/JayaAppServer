const config = require('../config');
const crypto = require('crypto');

function getApiBase() {
  return 'https://api.stripe.com';
}

async function createPaymentIntent({ amount, currency = 'USD', metadata = {} }) {
  if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  // Stripe expects amount in cents as integer
  const amt = Math.round(Number(amount) * 100);
  const body = new URLSearchParams();
  body.append('amount', String(amt));
  body.append('currency', (currency || 'USD').toLowerCase());
  // set automatic payment methods
  body.append('automatic_payment_methods[enabled]', 'true');
  // metadata
  for (const k of Object.keys(metadata || {})) {
    body.append(`metadata[${k}]`, String(metadata[k]));
  }

  const res = await fetch(`${getApiBase()}/v1/payment_intents`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeout: 30000
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stripe createPaymentIntent failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function createCheckoutSession({ amount, currency = 'USD', description = 'JayaApp Sponsorship', success_url = null, cancel_url = null, metadata = {} }) {
  if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  const amt = Math.round(Number(amount) * 100);
  const body = new URLSearchParams();
  // payment method
  body.append('payment_method_types[]', 'card');
  // line item price data
  body.append('line_items[0][price_data][currency]', (currency || 'USD').toLowerCase());
  body.append('line_items[0][price_data][product_data][name]', description);
  body.append('line_items[0][price_data][unit_amount]', String(amt));
  body.append('line_items[0][quantity]', '1');
  body.append('mode', 'payment');
  if (success_url) body.append('success_url', success_url);
  if (cancel_url) body.append('cancel_url', cancel_url);
  for (const k of Object.keys(metadata || {})) {
    body.append(`metadata[${k}]`, String(metadata[k]));
  }

  const res = await fetch(`${getApiBase()}/v1/checkout/sessions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    timeout: 30000
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stripe createCheckoutSession failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function retrieveCheckoutSession(sessionId) {
  if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  const res = await fetch(`${getApiBase()}/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent&expand[]=payment_intent.charges.data`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${config.STRIPE_SECRET_KEY}` },
    timeout: 15000
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stripe retrieveCheckoutSession failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function verifySessionCompleted(sessionId) {
  const session = await retrieveCheckoutSession(sessionId);
  // session.payment_status === 'paid' indicates success
  const paid = session && session.payment_status === 'paid';
  const paymentIntent = session && session.payment_intent ? session.payment_intent : null;
  const chargeId = paymentIntent && paymentIntent.charges && paymentIntent.charges.data && paymentIntent.charges.data[0] && paymentIntent.charges.data[0].id;
  return { paid, payment_intent: paymentIntent ? paymentIntent.id : null, charge_id: chargeId };
}

function parseStripeSignature(header) {
  // header like: t=timestamp,v1=signature,v0=old
  const parts = (header || '').split(',');
  const out = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k && v) out[k] = v;
  }
  return out;
}

function secureCompare(a, b) {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (e) {
    return false;
  }
}

async function verifyWebhookSignature(headers, bodyRaw) {
  const secret = config.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  const sigHeader = headers['stripe-signature'] || headers['Stripe-Signature'] || headers['stripe_signature'];
  if (!sigHeader) return false;
  const parsed = parseStripeSignature(sigHeader);
  const t = parsed.t;
  const v1 = parsed.v1;
  if (!t || !v1) return false;
  // check timestamp tolerance (5 minutes)
  const ts = Number(t);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 60 * 5) return false;
  // compute expected signature: HMAC_SHA256(secret, `${t}.${payload}`)
  const payload = (bodyRaw && bodyRaw.toString) ? bodyRaw.toString('utf8') : String(bodyRaw);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return secureCompare(expected, v1);
}

module.exports = { createPaymentIntent, verifyWebhookSignature, createCheckoutSession, retrieveCheckoutSession, verifySessionCompleted };
