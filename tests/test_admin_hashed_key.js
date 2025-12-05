const assert = require('assert');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_admin_hashed_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const donations = require('../src/models/donations');
const config = require('../src/config');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();
    donations.addSponsorship({ user_id: 'admin', user_email: null, sponsor_type: 'donation', target_identifier: null, amount_usd: 1.00, currency: 'USD', payment_provider: 'paypal', payment_provider_order_id: 'o_admin_1', message: 'admin test', idempotency_key: 'admin-1' });

    // generate a token and set its hash in config
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    config.ADMIN_API_KEY = '';
    config.ADMIN_API_KEY_HASH = hash;

    // Request without header should be rejected
    const res1 = await app.inject({ method: 'GET', url: '/admin/donations/sponsorships.csv' });
    assert.strictEqual(res1.statusCode, 401);

    // Request with header should succeed
    const res2 = await app.inject({ method: 'GET', url: '/admin/donations/sponsorships.csv', headers: { 'x-admin-key': token } });
    assert.strictEqual(res2.statusCode, 200);

    await app.close();
    console.log('Admin hashed key test passed');
  } catch (err) {
    console.error('Admin hashed key test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
