const config = require('../src/config');
const assert = require('assert');
const os = require('os');
const path = require('path');

// Only run when Stripe secret key is available
if (!config.STRIPE_SECRET_KEY) {
  console.log('Skipping Stripe sandbox test: STRIPE_SECRET_KEY not configured');
  process.exit(0);
}

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_sandbox_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const stripe = require('../src/services/stripe');

async function run() {
  const app = await build();
  try {
    console.log('Running Stripe sandbox integration test');
    const pi = await stripe.createPaymentIntent({ amount: 1.0, currency: 'USD', metadata: { test: 'jayaapp' } });
    console.log('Created PaymentIntent:', pi.id);
    assert.ok(pi && pi.id);
    await app.close();
    console.log('Stripe sandbox integration test passed');
    process.exit(0);
  } catch (err) {
    console.error('Stripe sandbox integration test failed:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
