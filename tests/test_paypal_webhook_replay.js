const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');

// Use isolated DB
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_paypal_replay_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const donations = require('../src/models/donations');
const config = require('../src/config');

async function run() {
  const app = await build();
  try {
    // Ensure a matching sponsorship exists for the sample order
    donations.initDonationsTable();
    donations.addSponsorship({ user_id: 'replay', user_email: null, sponsor_type: 'donation', target_identifier: null, amount_usd: 5.00, currency: 'USD', payment_provider: 'paypal', payment_provider_order_id: 'ORDER-WH-EXAMPLE-1', message: 'replay test', idempotency_key: 'replay-1' });

    const samplePath = path.join(__dirname, 'sample_webhooks', 'paypal_capture_completed.json');
    const raw = fs.readFileSync(samplePath);
    const headers = {
      'paypal-transmission-id': 'trans-replay-1',
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-cert-url': 'https://api.sandbox.paypal.com/certs/CERT',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-transmission-sig': 'sig-replay-1'
    };

    // Decide whether to run live verification. Default: mocked verify.
    const runLiveVerify = (process.env.RUN_PAYPAL_VERIFY_LIVE === '1');

    if (!runLiveVerify) {
      // Mock fetch used by paypal.verifyWebhookSignature to return SUCCESS
      global.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('/v1/oauth2/token')) {
          return { ok: true, async json() { return { access_token: 'fake-token' }; }, status: 200 };
        }
        if (typeof url === 'string' && url.includes('/v1/notifications/verify-webhook-signature')) {
          return { ok: true, async json() { return { verification_status: 'SUCCESS' }; }, status: 200 };
        }
        // Other calls shouldn't happen in this test
        return { ok: false, status: 500, async text() { return 'unexpected'; } };
      };
    }

    const reqHeaders = Object.assign({ 'content-type': 'application/json' }, headers);
    const res = await app.inject({ method: 'POST', url: '/webhooks/paypal', payload: raw, headers: reqHeaders });
    assert.strictEqual(res.statusCode, 200, 'Webhook handler should return 200');
    const j = JSON.parse(res.payload);
    assert.strictEqual(j.status, 'ok');

    const row = donations.getSponsorshipByOrder('ORDER-WH-EXAMPLE-1');
    assert.ok(row, 'Sponsorship row must exist');
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(row.payment_provider_capture_id, 'CAP-EXAMPLE-123');

    await app.close();
    console.log('Webhook replay test passed (liveVerify=' + runLiveVerify + ')');
    process.exit(0);
  } catch (err) {
    console.error('Webhook replay test failed:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
