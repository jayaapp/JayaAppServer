const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_admin_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const donations = require('../src/models/donations');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();
    // Insert some rows
    donations.addSponsorship({ user_id: 'u1', user_email: 'a@b', sponsor_type: 'donation', target_identifier: 'words_analysis', amount_usd: 10.00, currency: 'USD', payment_provider: 'paypal', payment_provider_order_id: 'O1', message: '', idempotency_key: 'a1' });
    donations.addSponsorship({ user_id: 'u2', user_email: 'b@c', sponsor_type: 'donation', target_identifier: 'verse_analysis', amount_usd: 20.00, currency: 'USD', payment_provider: 'paypal', payment_provider_order_id: 'O2', message: '', idempotency_key: 'a2' });

    const res = await app.inject({ method: 'GET', url: '/admin/donations/sponsorships?page=1&page_size=10' });
    assert.strictEqual(res.statusCode, 200);
    const j = JSON.parse(res.payload);
    assert.strictEqual(j.status, 'ok');
    assert.strictEqual(j.total, 2);
    assert.ok(Array.isArray(j.items));

    // Filter by campaign
    const res2 = await app.inject({ method: 'GET', url: '/admin/donations/sponsorships?campaign=words_analysis' });
    const j2 = JSON.parse(res2.payload);
    assert.strictEqual(j2.total, 1);
    assert.strictEqual(j2.items[0].target_identifier, 'words_analysis');

    await app.close();
    console.log('Admin sponsorships test passed');
  } catch (err) {
    console.error('Admin test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
