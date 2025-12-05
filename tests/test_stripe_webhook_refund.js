const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_webhook_refund_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const donations = require('../src/models/donations');
const config = require('../src/config');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();
    // sponsorship completed with a capture id
    donations.addSponsorship({ user_id: 'replay', user_email: null, sponsor_type: 'donation', target_identifier: null, amount_usd: 5.00, currency: 'USD', payment_provider: 'stripe', payment_provider_order_id: 'cs_EXAMPLE_1', message: 'stripe refund replay', idempotency_key: 'stripe-refund-1' });
    // mark it completed with capture id
    donations.completeSponsorship('cs_EXAMPLE_1', 'ch_EXAMPLE_REFUND');

    const raw = fs.readFileSync(path.join(__dirname, 'sample_webhooks', 'stripe_charge_refunded.json'));
    const headers = { 'stripe-signature': 't=123456,v1=fakesig' };

    // Mock stripe verification unless RUN_STRIPE_VERIFY_LIVE
    if (!process.env.RUN_STRIPE_VERIFY_LIVE) {
      // Monkeypatch stripe.verifyWebhookSignature to return true
      const stripe = require('../src/services/stripe');
      stripe.verifyWebhookSignature = async () => true;
    }

    const res = await app.inject({ method: 'POST', url: '/webhooks/stripe', payload: raw, headers: { 'content-type': 'application/json', ...headers } });
    assert.strictEqual(res.statusCode, 200);
    const j = JSON.parse(res.payload);
    assert.strictEqual(j.status, 'ok');

    const row = donations.getSponsorshipByCaptureId('ch_EXAMPLE_REFUND');
    assert.ok(row);
    // should have status 'refunded'
    const db = require('../src/models/db').getDb();
    const r = db.prepare('SELECT status FROM sponsorships WHERE id = ?').get(row.id);
    assert.strictEqual(r.status, 'refunded');

    await app.close();
    console.log('Stripe webhook refund replay test passed');
  } catch (err) {
    console.error('Stripe refund replay test failed:', err);
    if (err && err.stack) console.error(err.stack);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
