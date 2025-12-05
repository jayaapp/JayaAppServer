const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_webhook_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_testsecret123';

const build = require('../src/index');
const donations = require('../src/models/donations');
const crypto = require('crypto');

function makeStripeSig(payload, secret) {
  const t = Math.floor(Date.now() / 1000);
  const signed = `${t}.${payload}`;
  const h = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${t},v1=${h}`;
}

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();
    // seed sponsorship with payment_provider_order_id = payment_intent id
    const piId = 'pi_test_123';
    const chId = 'ch_test_456';
    donations.addSponsorship({ user_id: 'u1', user_email: 'a@example.com', sponsor_type: 'one-time', target_identifier: 'campaign', amount_usd: 5.00, currency: 'USD', payment_provider: 'stripe', payment_provider_order_id: piId, message: 'stripe replay test', idempotency_key: 'k1' });

    const event = {
      id: 'evt_test_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: piId, charges: { data: [{ id: chId }] } } }
    };
    const payload = JSON.stringify(event);
    const sig = makeStripeSig(payload, process.env.STRIPE_WEBHOOK_SECRET);

    const res = await app.inject({ method: 'POST', url: '/webhooks/stripe', payload: payload, headers: { 'stripe-signature': sig, 'content-type': 'application/json' } });
    assert.strictEqual(res.statusCode, 200);
    const row = donations.getSponsorshipByOrder(piId);
    assert(row && row.status === 'completed', 'Sponsorship not marked completed');
    // ensure capture id updated
    const updated = donations.getSponsorshipByCaptureId(chId);
    assert(updated && updated.id === row.id, 'Capture id not associated');

    await app.close();
    console.log('Stripe webhook replay test passed');
    process.exit(0);
  } catch (err) {
    console.error('Stripe webhook replay test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
