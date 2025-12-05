const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');

// Isolate DB
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_replay_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const donations = require('../src/models/donations');
const config = require('../src/config');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();
    donations.addSponsorship({ user_id: 'replay', user_email: null, sponsor_type: 'donation', target_identifier: null, amount_usd: 5.00, currency: 'USD', payment_provider: 'stripe', payment_provider_order_id: 'pi_EXAMPLE_1', message: 'stripe replay', idempotency_key: 'stripe-replay-1' });

    const raw = fs.readFileSync(path.join(__dirname, 'sample_webhooks', 'stripe_payment_intent_succeeded.json'));
    const headers = { 'stripe-signature': 't=123456,v1=fakesig' };

    // Mock stripe verification unless RUN_STRIPE_VERIFY_LIVE
    if (!process.env.RUN_STRIPE_VERIFY_LIVE) {
      global.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('/v1')) {
          // token calls not used here for Stripe
          return { ok: true, async json() { return {}; }, status: 200 };
        }
        return { ok: false, status: 500, async text() { return 'unexpected'; } };
      };
      // Monkeypatch stripe.verifyWebhookSignature to return true
      const stripe = require('../src/services/stripe');
      stripe.verifyWebhookSignature = async () => true;
    }

    const res = await app.inject({ method: 'POST', url: '/webhooks/stripe', payload: raw, headers: { 'content-type': 'application/json', ...headers } });
    assert.strictEqual(res.statusCode, 200);
    const j = JSON.parse(res.payload);
    assert.strictEqual(j.status, 'ok');

    const row = donations.getSponsorshipByOrder('pi_EXAMPLE_1');
    assert.ok(row);
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(row.payment_provider_capture_id, 'ch_EXAMPLE_1');

    await app.close();
    console.log('Stripe webhook replay test passed');
  } catch (err) {
    console.error('Stripe replay test failed:', err);
    if (err && err.stack) console.error(err.stack);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
