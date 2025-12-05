const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

// Ensure isolated DB env for consistency (not used here but test harness expects it)
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_sig_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

// Load config and stripe service
const config = require('../src/config');
const stripe = require('../src/services/stripe');

async function run() {
  // Use a known secret for test and set it on config so stripe.verifyWebhookSignature reads it
  const secret = 'whsec_test_signature';
  config.STRIPE_WEBHOOK_SECRET = secret;

  const payload = JSON.stringify({ id: 'evt_test', type: 'payment_intent.succeeded', data: { object: { id: 'pi_TEST', amount: 100 } } });
  const t = Math.floor(Date.now() / 1000);
  const signed = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const header = `t=${t},v1=${signed}`;

  const headers = { 'stripe-signature': header };
  const ok = await stripe.verifyWebhookSignature(headers, Buffer.from(payload));
  assert.strictEqual(ok, true);

  console.log('Stripe signature verification unit test passed');
}

run().catch(err => { console.error(err); process.exit(1); });
