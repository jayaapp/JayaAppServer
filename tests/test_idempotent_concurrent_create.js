const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_idempotent_${process.pid}_${Date.now()}.db`);
const build = require('../src/index');

async function run() {
  process.env.NODE_ENV = 'test';
  const app = await build();

  // Count PayPal createOrder calls by intercepting global.fetch
  let createOrderCalls = 0;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.endsWith('/v1/oauth2/token')) {
      return { ok: true, async json() { return { access_token: 'fake-paypal-token' }; }, status: 200 };
    }
    if (typeof url === 'string' && url.endsWith('/v2/checkout/orders')) {
      createOrderCalls += 1;
      const fakeOrder = { id: 'ORDER-CONC-1', links: [{ href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-CONC-1', rel: 'approve' }] };
      return { status: 201, ok: true, async text() { return JSON.stringify(fakeOrder); } };
    }
    throw new Error('Unexpected fetch URL: ' + url);
  };

  const payload = { sponsor_type: 'donation', amount: 1.00, currency: 'USD', idempotency_key: 'conc-test-1' };

  // Fire two parallel create requests
  const p1 = app.inject({ method: 'POST', url: '/donation/create-payment', payload, headers: { 'content-type': 'application/json' } });
  const p2 = app.inject({ method: 'POST', url: '/donation/create-payment', payload, headers: { 'content-type': 'application/json' } });

  const [r1, r2] = await Promise.all([p1, p2]);
  const j1 = JSON.parse(r1.payload);
  const j2 = JSON.parse(r2.payload);

  // Both should be OK and refer to same order id
  assert.strictEqual(j1.status, 'ok');
  assert.strictEqual(j2.status, 'ok');
  assert.strictEqual(j1.order_id, j2.order_id);
  assert.ok(j1.sponsorship_id);
  assert.ok(j2.sponsorship_id);

  // Only a single PayPal createOrder should have been called
  assert.strictEqual(createOrderCalls, 1);

  await app.close();
  console.log('Concurrent idempotency test passed');
}

run().catch(err => {
  console.error('Concurrent idempotency test failed:', err);
  process.exit(1);
});
