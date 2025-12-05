const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_create_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const donations = require('../src/models/donations');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();

    // Mock Stripe Checkout Session creation API via fetch
    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/v1/checkout/sessions')) {
        const fake = { id: 'cs_test_123', url: 'https://checkout.stripe/test/123', amount_total: 100, currency: 'usd' };
        return { ok: true, status: 200, async text() { return JSON.stringify(fake); } };
      }
      throw new Error('Unexpected fetch URL: ' + url);
    };

    const payload = { sponsor_type: 'donation', amount: 1.00, currency: 'USD', provider: 'stripe', idempotency_key: 'stripe-create-1' };
    const res = await app.inject({ method: 'POST', url: '/donation/create-payment', payload, headers: { 'content-type': 'application/json' } });
    assert.strictEqual(res.statusCode, 200);
    const j = JSON.parse(res.payload);
    assert.strictEqual(j.status, 'ok');
    assert.ok(j.checkout_url, 'checkout_url should be returned for stripe');

    // Verify DB row created
    const row = donations.getSponsorshipByIdempotencyKey('stripe-create-1');
    assert.ok(row);
    assert.strictEqual(row.payment_provider, 'stripe');
    assert.strictEqual(row.payment_provider_order_id, 'cs_test_123');

    await app.close();
    console.log('Stripe create-flow mocked test passed');
  } catch (err) {
    console.error('Stripe create-flow test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
