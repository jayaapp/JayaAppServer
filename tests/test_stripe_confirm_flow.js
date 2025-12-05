const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_confirm_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const donations = require('../src/models/donations');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();
    // create a sponsorship reserved for stripe with session id
    donations.addSponsorship({ user_id: 'u1', user_email: 'x@y', sponsor_type: 'donation', target_identifier: null, amount_usd: 10.0, currency: 'USD', payment_provider: 'stripe', payment_provider_order_id: 'cs_confirm_1', message: 'confirm test', idempotency_key: 'stripe-confirm-1' });

    // Mock stripe.verifySessionCompleted to simulate a paid session
    const stripe = require('../src/services/stripe');
    stripe.verifySessionCompleted = async (sessionId) => {
      assert.strictEqual(sessionId, 'cs_confirm_1');
      return { paid: true, payment_intent: 'pi_confirm_1', charge_id: 'ch_confirm_1' };
    };

    const res = await app.inject({ method: 'POST', url: '/donations/confirm', payload: { order_id: 'cs_confirm_1' }, headers: { 'content-type': 'application/json' } });
    assert.strictEqual(res.statusCode, 200);
    const j = JSON.parse(res.payload);
    assert.strictEqual(j.status, 'ok');
    // verify DB updated
    const row = donations.getSponsorshipByOrder('cs_confirm_1');
    assert.ok(row);
    const db = require('../src/models/db').getDb();
    const r = db.prepare('SELECT status, payment_provider_capture_id FROM sponsorships WHERE id = ?').get(row.id);
    assert.strictEqual(r.status, 'completed');
    assert.strictEqual(r.payment_provider_capture_id, 'ch_confirm_1');

    await app.close();
    console.log('Stripe /donations/confirm flow test passed');
  } catch (err) {
    console.error('Stripe confirm test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
