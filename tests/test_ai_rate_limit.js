const assert = require('assert');
const os = require('os');
const path = require('path');

// Use an isolated temporary SQLite DB per test run to avoid cross-test contamination
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_${process.pid}_${Date.now()}.db`);

const build = require('../src/index');

async function run() {
  process.env.NODE_ENV = 'test';
  const app = await build();

  // Mock fetch for GitHub and Ollama used by OAuth + proxy
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('github.com/login/oauth/access_token')) {
      return { async json() { return { access_token: 'fake-access-token' }; } };
    }
    if (typeof url === 'string' && url.includes('api.github.com/user')) {
      return { async json() { return { id: 12345, login: 'testuser', name: 'Test User', avatar_url: '' }; } };
    }
    if (typeof url === 'string' && url.includes('api.github.com/user/emails')) {
      return { async json() { return [ { email: 'testuser@example.com', primary: true, verified: true } ]; } };
    }
    if (typeof url === 'string' && url.startsWith('https://ollama.com/api/chat')) {
      return { ok: true, async text() { return JSON.stringify({ status: 'ok', reply: 'hello' }); } };
    }
    if (typeof url === 'string' && url.startsWith('https://ollama.com/api/tags')) {
      return { ok: true, async json() { return { models: ['test-model'] }; } };
    }
    throw new Error('Unexpected fetch URL: ' + url);
  };

  // Create a session via the OAuth flow
  const loginRes = await app.inject({ method: 'GET', url: '/auth/login' });
  const loginJson = JSON.parse(loginRes.payload);
  const callbackRes = await app.inject({ method: 'GET', url: `/auth/callback?code=fakecode&state=${loginJson.state}` });
  const cbJson = JSON.parse(callbackRes.payload);
  assert.strictEqual(cbJson.status, 'success');

  // Get csrf token
  const userRes = await app.inject({ method: 'GET', url: '/auth/user', headers: { cookie: `session_token=${cbJson.session_token}` } });
  const userJson = JSON.parse(userRes.payload);
  const csrf = userJson.csrf_token;

  // Prepare a minimal valid body for proxy-chat
  const body = { messages: [{ role: 'user', content: 'hello' }] };
  const ip = '127.0.0.1';

  // Make LIMIT requests which should succeed
  const LIMIT = 10;
  for (let i = 0; i < LIMIT; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/ollama/proxy-chat',
      payload: body,
      headers: {
        'content-type': 'application/json',
        cookie: `session_token=${cbJson.session_token}`,
        'x-csrf-token': csrf,
        'x-forwarded-for': ip
      }
    });
    assert.notStrictEqual(res.statusCode, 429);
  }

  // The next request should be rate-limited (429)
  const res429 = await app.inject({
    method: 'POST',
    url: '/ollama/proxy-chat',
    payload: body,
    headers: {
      'content-type': 'application/json',
      cookie: `session_token=${cbJson.session_token}`,
      'x-csrf-token': csrf,
      'x-forwarded-for': ip
    }
  });

  assert.strictEqual(res429.statusCode, 429);
  const json = JSON.parse(res429.payload);
  assert.strictEqual(json.status, 'error');
  assert.ok(json.message);

  await app.close();
  console.log('AI per-IP rate limiter test passed');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
