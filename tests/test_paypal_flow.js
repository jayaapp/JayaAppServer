const assert = require('assert');
const os = require('os');
const path = require('path');

// Isolate DB
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_paypal_${process.pid}_${Date.now()}.db`);

const build = require('../src/index');
const donations = require('../src/models/donations');

async function run() {
  process.env.NODE_ENV = 'test';
  const app = await build();

  // Mock PayPal endpoints via fetch
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.endsWith('/v1/oauth2/token')) {
      return { ok: true, async json() { return { access_token: 'fake-paypal-token' }; }, status: 200 };
    }
    if (typeof url === 'string' && url.endsWith('/v2/checkout/orders')) {
      // Creating order
      const fakeOrder = {
        id: 'ORDER-12345',
        links: [ { href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-12345', rel: 'approve' } ]
      };
      return { status: 201, ok: true, async text() { return JSON.stringify(fakeOrder); } };
    }
    if (typeof url === 'string' && url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) {
      const fakeCapture = {
        purchase_units: [ { payments: { captures: [ { id: 'CAPTURE-6789' } ] } } ]
      };
      return { status: 201, ok: true, async text() { return JSON.stringify(fakeCapture); } };
    }

    throw new Error('Unexpected fetch URL: ' + url);
  };

  // Create donation
  const payload = { sponsor_type: 'donation', amount: 5.00, currency: 'USD', idempotency_key: 'test-key-1' };
  const createRes = await app.inject({ method: 'POST', url: '/donations/create', payload, headers: { 'content-type': 'application/json' } });
  assert.strictEqual(createRes.statusCode, 200);
  const createJson = JSON.parse(createRes.payload);
  assert.strictEqual(createJson.status, 'ok');
  const orderId = createJson.order_id;
  const sponsorshipId = createJson.sponsorship_id;
  assert.ok(orderId);
  assert.ok(sponsorshipId);

  // Confirm via capture endpoint (simulates the user returning and capturing)
  const confirmRes = await app.inject({ method: 'POST', url: '/donations/confirm', payload: { order_id: orderId }, headers: { 'content-type': 'application/json' } });
  assert.strictEqual(confirmRes.statusCode, 200);
  const confirmJson = JSON.parse(confirmRes.payload);
  assert.ok(confirmJson.updated || confirmJson.status === 'ok');

  // Verify DB updated
  const row = donations.getSponsorshipByOrder(orderId);
  assert.ok(row, 'Sponsorship not found in DB');
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.payment_provider_capture_id, 'CAPTURE-6789');

  await app.close();
  console.log('PayPal flow test passed');
}

run().catch(err => {
  console.error('PayPal test failed:', err);
  process.exit(1);
});
