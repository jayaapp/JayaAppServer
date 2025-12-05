const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_admin_csv_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'test_admin_key_123';

const build = require('../src/index');
const donations = require('../src/models/donations');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();

    // Seed some sponsorships
    const id1 = donations.addSponsorship({ user_id: 'u1', user_email: 'a@example.com', sponsor_type: 'one-time', target_identifier: 'campaign1', amount_usd: 5.00, currency: 'USD', payment_provider: 'stripe', payment_provider_order_id: 'ord_1', message: 'hello', idempotency_key: 'key1' });
    const id2 = donations.addSponsorship({ user_id: 'u2', user_email: 'b@example.com', sponsor_type: 'monthly', target_identifier: 'campaign2', amount_usd: 10.00, currency: 'USD', payment_provider: 'paypal', payment_provider_order_id: 'ord_2', message: 'hi', idempotency_key: 'key2' });

    // Request CSV export
    const res = await app.inject({ method: 'GET', url: '/admin/donations/sponsorships.csv', headers: { 'x-admin-key': process.env.ADMIN_API_KEY } });
    assert.strictEqual(res.statusCode, 200);
    const body = res.payload;
    // Should contain header and two rows
    const lines = body.split('\n');
    assert(lines.length >= 3, 'expected at least header + 2 rows');
    // header contains idempotency_key
    assert(lines[0].includes('idempotency_key'));
    // Ensure our messages are present in CSV
    assert(body.includes('hello'));
    assert(body.includes('hi'));

    // Test filtering by campaign
    const res2 = await app.inject({ method: 'GET', url: '/admin/donations/sponsorships.csv?campaign=campaign1', headers: { 'x-admin-key': process.env.ADMIN_API_KEY } });
    assert.strictEqual(res2.statusCode, 200);
    const body2 = res2.payload;
    const lines2 = body2.split('\n');
    // header + 1 row
    assert(lines2.length >= 2);
    assert(body2.includes('campaign1'));
    assert(!body2.includes('campaign2') || body2.split('\n').length === 2);

    await app.close();
    console.log('Admin CSV export test passed');
  } catch (err) {
    console.error('Admin CSV export test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
