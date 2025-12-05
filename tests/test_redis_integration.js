const assert = require('assert');
const os = require('os');
const path = require('path');

// Use isolated test DB even for Redis integration run
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_${process.pid}_${Date.now()}.db`);

const build = require('../src/index');

(async function run() {
  // This is an integration-style test that only runs when Redis is configured
  const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_SOCKET_PATH || null;
  if (!REDIS_URL) {
    console.log('Skipping Redis integration test: no REDIS_URL or REDIS_SOCKET_PATH configured');
    process.exit(0);
  }

  try {
    const app = await build();
    // Attempt to create a session via the plugin and then read it back
    const user = { id: 'rtest', login: 'redistest' };
    const session = await app.createSession(user);
    assert.ok(session && session.token, 'session created');
    const fetched = await app.getSession(session.token);
    assert.ok(fetched && fetched.user && fetched.user.id === 'rtest', 'session retrieved from store');
    console.log('Redis integration test passed');
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('Redis integration test failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
