const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_paypal_wh_${process.pid}_${Date.now()}.db`);
const build = require('../src/index');
const donations = require('../src/models/donations');

async function run() {
  process.env.NODE_ENV = 'test';
  const app = await build();

  // Prepare a pending sponsorship in DB
  donations.initDonationsTable();
  const sponsorId = donations.addSponsorship({ user_id: 'anon', user_email: null, sponsor_type: 'donation', target_identifier: null, amount_usd: 10.00, currency: 'USD', payment_provider: 'paypal', payment_provider_order_id: 'ORDER-WH-1', message: 'webhook test', idempotency_key: 'wh-test-1' });
  assert.ok(sponsorId);

  // Mock fetch for token and verify-webhook-signature
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.endsWith('/v1/oauth2/token')) {
      return { ok: true, async json() { return { access_token: 'fake-paypal-token' }; }, status: 200 };
    }
    if (typeof url === 'string' && url.endsWith('/v1/notifications/verify-webhook-signature')) {
      return { ok: true, async json() { return { verification_status: 'SUCCESS' }; }, status: 200 };
    }
    throw new Error('Unexpected fetch URL: ' + url);
  };

  // Create a fake webhook event payload
  const event = {
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
      id: 'CAP-111',
      order_id: 'ORDER-WH-1'
    }
  };

  const headers = {
    'paypal-transmission-id': 'trans-1',
    'paypal-transmission-time': new Date().toISOString(),
    'paypal-cert-url': 'https://api.paypal.com/certs/cert.pem',
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-transmission-sig': 'sig-1'
  };

  const res = await app.inject({ method: 'POST', url: '/webhooks/paypal', payload: event, headers, 'content-type': 'application/json' });
  assert.strictEqual(res.statusCode, 200);
  const json = JSON.parse(res.payload);
  assert.strictEqual(json.status, 'ok');

  // Verify DB updated
  const row = donations.getSponsorshipByOrder('ORDER-WH-1');
  assert.ok(row, 'Sponsorship not found');
  assert.strictEqual(row.status, 'completed');
  assert.strictEqual(row.payment_provider_capture_id, 'CAP-111');

  await app.close();
  console.log('PayPal webhook test passed');
}

run().catch(err => {
  console.error('PayPal webhook test failed:', err);
  process.exit(1);
});
