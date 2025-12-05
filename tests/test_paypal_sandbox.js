const config = require('../src/config');
const assert = require('assert');
const os = require('os');
const path = require('path');

// Only run when sandbox creds are available
if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_CLIENT_SECRET || (config.PAYPAL_MODE !== 'sandbox' && config.PAYPAL_MODE !== 'live')) {
  console.log('Skipping PayPal sandbox test: PAYPAL credentials not configured in environment.');
  process.exit(0);
}

// Use isolated DB for test
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_paypal_sandbox_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';

const build = require('../src/index');
const paypal = require('../src/services/paypal');

async function run() {
  const app = await build();
  try {
    console.log('Running PayPal sandbox integration test using PAYPAL_MODE=' + config.PAYPAL_MODE);
    // Attempt to create a real order via PayPal API
    const order = await paypal.createOrder({ amount: 1.00, currency: 'USD', description: 'JayaApp sandbox test' });
    assert.ok(order && (order.id || order.order_id), 'PayPal did not return an order id');
    console.log('Created PayPal order:', order.id || order.order_id);

    // Note: Capturing an order requires payer approval in most flows; we only validate create+token flows here.
    await app.close();
    console.log('PayPal sandbox integration test passed');
    process.exit(0);
  } catch (err) {
    console.error('PayPal sandbox integration test failed:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
