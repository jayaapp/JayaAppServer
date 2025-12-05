const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_concurrency_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const donations = require('../src/models/donations');

async function run() {
  try {
    donations.initDonationsTable();
    const key = 'concurrency-key-1';
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(new Promise((resolve) => {
        // simulate concurrent insert attempts
        setImmediate(() => {
          const id = donations.addSponsorship({ user_id: `u${i}`, user_email: `u${i}@example.com`, sponsor_type: 'one-time', target_identifier: 'campaign', amount_usd: 1.00, currency: 'USD', payment_provider: 'paypal', payment_provider_order_id: null, message: 'concurrency test', idempotency_key: key });
          resolve(id);
        });
      }));
    }
    const results = await Promise.all(promises);
    // All returned ids should be the same non-null value
    const unique = Array.from(new Set(results.filter(Boolean)));
    assert(unique.length === 1, 'Expected a single unique sponsorship id');
    const stored = donations.getSponsorshipByIdempotencyKey(key);
    assert(stored && stored.id, 'Stored sponsorship missing');
    console.log('Donations concurrency test passed');
    process.exit(0);
  } catch (err) {
    console.error('Donations concurrency test failed:', err);
    process.exit(1);
  }
}

run();
