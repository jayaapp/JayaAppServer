const assert = require('assert');
const os = require('os');
const path = require('path');

// Use isolated test DB
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_${process.pid}_${Date.now()}.db`);

const build = require('../src/index');

(async function run() {
  const REDIS_CONFIG = process.env.REDIS_URL || process.env.REDIS_SOCKET_PATH || null;
  if (!REDIS_CONFIG) {
    console.log('Skipping Redis-specific AI rate-limit test: no REDIS_URL or REDIS_SOCKET_PATH configured');
    process.exit(0);
  }

  try {
    process.env.NODE_ENV = 'test';
    const app = await build();

    // Wait up to 3s for Redis client to become ready
    const client = app.redis;
    if (!client) {
      console.error('Redis plugin did not provide a client; aborting test');
      await app.close();
      process.exit(2);
    }

    const waitUntilReady = async (c, timeoutMs = 3000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (c.status === 'ready') return true;
        // some transports expose .connected or .status changes
        await new Promise(r => setTimeout(r, 100));
      }
      return false;
    };

    const ready = await waitUntilReady(client, 5000);
    if (!ready) {
      console.error('Redis client did not become ready in time; aborting test');
      await app.close();
      process.exit(2);
    }

    // Create a session and CSRF token without going through OAuth flows
    const user = { id: 'redis-ai-test', login: 'redis-ai' };
    const session = await app.createSession(user);
    assert.ok(session && session.token, 'session created');
    const csrf = app.generateCsrfToken(session.token);

    const ip = '127.0.0.1';
    const LIMIT = 10; // must match plugin config
    const WINDOW_SECONDS = 60;

    // Determine the Redis key we'll expect
    const nowSec = Math.floor(Date.now() / 1000);
    const windowId = Math.floor(nowSec / WINDOW_SECONDS);
    const key = `ai:${ip}:${windowId}`;

    // Ensure key not present to start
    await client.del(key);

    const body = { messages: [{ role: 'user', content: 'ping' }] };

    // Send LIMIT requests that should succeed and increment the Redis counter
    for (let i = 1; i <= LIMIT; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ollama/proxy-chat',
        payload: body,
        headers: {
          'content-type': 'application/json',
          cookie: `session_token=${session.token}`,
          'x-csrf-token': csrf,
          'x-forwarded-for': ip
        }
      });
      assert.notStrictEqual(res.statusCode, 429, `request ${i} unexpectedly rate-limited`);

      // check Redis counter value
      const v = await client.get(key);
      assert.strictEqual(String(i), String(v), `expected redis key ${key} to be ${i} but got ${v}`);
      const ttl = await client.ttl(key);
      assert.ok(ttl > 0 && ttl <= WINDOW_SECONDS + 5, `ttl should be set and <= ${WINDOW_SECONDS + 5}, got ${ttl}`);
    }

    // Next request should be rate-limited and include Retry-After
    const res429 = await app.inject({
      method: 'POST',
      url: '/api/ollama/proxy-chat',
      payload: body,
      headers: {
        'content-type': 'application/json',
        cookie: `session_token=${session.token}`,
        'x-csrf-token': csrf,
        'x-forwarded-for': ip
      }
    });

    assert.strictEqual(res429.statusCode, 429, 'expected 429 after exceeding limit');
    const retryAfter = res429.headers && (res429.headers['retry-after'] || res429.headers['Retry-After']);
    assert.ok(retryAfter, 'Retry-After header expected on 429');
    const retryNum = Number(retryAfter);
    assert.ok(!Number.isNaN(retryNum) && retryNum > 0, 'Retry-After should be a positive number');

    // Cleanup
    await client.del(key);
    await app.close();
    console.log('Redis-specific AI rate-limit test passed');
    process.exit(0);
  } catch (err) {
    console.error('Redis-specific AI rate-limit test failed:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();
