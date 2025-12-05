const assert = require('assert');
const os = require('os');
const path = require('path');

if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) {
  console.log('Skipping Stripe E2E webhook test; STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY must be set');
  process.exit(0);
}

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_stripe_e2e_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

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

    // Create a sponsorship row that will be matched by payment_intent id
    const piId = 'pi_e2e_' + Date.now();
    const chId = 'ch_e2e_' + Date.now();
    donations.addSponsorship({ user_id: 'u_e2e', user_email: 'e2e@example.com', sponsor_type: 'one-time', target_identifier: 'campaign', amount_usd: 5.00, currency: 'USD', payment_provider: 'stripe', payment_provider_order_id: piId, message: 'stripe e2e test', idempotency_key: 'k_e2e' });

    const event = {
      id: 'evt_e2e_' + Date.now(),
      type: 'payment_intent.succeeded',
      data: { object: { id: piId, charges: { data: [{ id: chId }] } } }
    };
    const payload = JSON.stringify(event);
    const sig = makeStripeSig(payload, process.env.STRIPE_WEBHOOK_SECRET);

    const res = await app.inject({ method: 'POST', url: '/webhooks/stripe', payload: payload, headers: { 'stripe-signature': sig, 'content-type': 'application/json' } });
    assert.strictEqual(res.statusCode, 200);
    const row = donations.getSponsorshipByOrder(piId);
    assert(row && row.status === 'completed', 'Sponsorship not marked completed');
    const updated = donations.getSponsorshipByCaptureId(chId);
    assert(updated && updated.id === row.id, 'Capture id not associated');

    await app.close();
    console.log('Stripe E2E webhook test passed');
    process.exit(0);
  } catch (err) {
    console.error('Stripe E2E webhook test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
