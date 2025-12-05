const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_concurrent_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');

async function run() {
  const app = await build();
  try {
    let createCalls = 0;
    // Mock Stripe Checkout Session creation API
    global.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('/v1/checkout/sessions')) {
        createCalls += 1;
        const fake = { id: 'cs_conc_1', url: 'https://checkout.stripe/conc/1', amount_total: 100, currency: 'usd' };
        return { ok: true, status: 200, async text() { return JSON.stringify(fake); } };
      }
      throw new Error('Unexpected fetch URL: ' + url);
    };

    const payload = { sponsor_type: 'donation', amount: 1.00, currency: 'USD', provider: 'stripe', idempotency_key: 'stripe-conc-1' };

    const p1 = app.inject({ method: 'POST', url: '/donations/create', payload, headers: { 'content-type': 'application/json' } });
    const p2 = app.inject({ method: 'POST', url: '/donations/create', payload, headers: { 'content-type': 'application/json' } });

    const [r1, r2] = await Promise.all([p1, p2]);
    const j1 = JSON.parse(r1.payload);
    const j2 = JSON.parse(r2.payload);

    assert.strictEqual(j1.status, 'ok');
    assert.strictEqual(j2.status, 'ok');
    assert.strictEqual(j1.order_id, j2.order_id);
    assert.ok(j1.checkout_url);
    assert.strictEqual(createCalls, 1, 'Expected a single Stripe createCheckoutSession call');

    await app.close();
    console.log('Stripe concurrent create test passed');
  } catch (err) {
    console.error('Stripe concurrent create test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
