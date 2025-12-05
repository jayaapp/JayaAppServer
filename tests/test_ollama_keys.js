const assert = require('assert');
const os = require('os');
const path = require('path');

// Use an isolated temporary SQLite DB per test run to avoid cross-test contamination
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_${process.pid}_${Date.now()}.db`);

const build = require('../src/index');

async function run() {
  // Mock fetch for GitHub and Ollama
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
    if (typeof url === 'string' && url.startsWith('https://ollama.com/api/tags')) {
      return { ok: true, async json() { return { models: ['test-model'] }; } };
      }
      if (typeof url === 'string' && url.startsWith('https://ollama.com/api/chat')) {
        return { ok: true, async text() { return JSON.stringify({ status: 'ok', reply: 'hello' }); } };
    }
    throw new Error('Unexpected fetch URL: ' + url);
  };

  const app = await build();

  // Create a session by going through the OAuth flow
  const loginRes = await app.inject({ method: 'GET', url: '/auth/login' });
  const loginJson = JSON.parse(loginRes.payload);
  const callbackRes = await app.inject({ method: 'GET', url: `/auth/callback?code=fakecode&state=${loginJson.state}` });
  const cbJson = JSON.parse(callbackRes.payload);
  assert.strictEqual(cbJson.status, 'success');

  // Get csrf token
  const userRes = await app.inject({ method: 'GET', url: '/auth/user', headers: { cookie: `session_token=${cbJson.session_token}` } });
  const userJson = JSON.parse(userRes.payload);
  assert.strictEqual(userJson.status, 'success');
  const csrf = userJson.csrf_token;

  // Ensure check-key returns has_key false initially
  const check1 = await app.inject({ method: 'GET', url: '/api/ollama/check-key', headers: { cookie: `session_token=${cbJson.session_token}` } });
  const check1Json = JSON.parse(check1.payload);
  assert.strictEqual(check1Json.status, 'success');
  assert.strictEqual(check1Json.has_key, false);

  // Store a key
  const key = 'ok_testapikey_1234567890';
  const saveRes = await app.inject({ method: 'POST', url: '/api/ollama/store-key', headers: { cookie: `session_token=${cbJson.session_token}`, 'x-csrf-token': csrf }, payload: { ollama_api_key: key } });
  const saveJson = JSON.parse(saveRes.payload);
  assert.strictEqual(saveJson.status, 'success');

  // Check key exists
  const check2 = await app.inject({ method: 'GET', url: '/api/ollama/check-key', headers: { cookie: `session_token=${cbJson.session_token}` } });
  const check2Json = JSON.parse(check2.payload);
  assert.strictEqual(check2Json.has_key, true);
  assert.ok(check2Json.masked_key && typeof check2Json.masked_key === 'string');

  // Get key
  const getRes = await app.inject({ method: 'GET', url: '/api/ollama/get-key', headers: { cookie: `session_token=${cbJson.session_token}` } });
  const getJson = JSON.parse(getRes.payload);
  assert.strictEqual(getJson.has_key, true);
  assert.strictEqual(getJson.api_key, key);

  // List models
  const modelsRes = await app.inject({ method: 'GET', url: '/api/ollama/list-models', headers: { cookie: `session_token=${cbJson.session_token}` } });
  const modelsJson = JSON.parse(modelsRes.payload);
  assert.ok(modelsJson.models && Array.isArray(modelsJson.models));

  // Call proxy-chat: should require auth + CSRF
  const chatBody = { model: 'test', messages: [{ role: 'user', content: 'hi' }], stream: false };
  const chatRes = await app.inject({ method: 'POST', url: '/api/ollama/proxy-chat', headers: { cookie: `session_token=${cbJson.session_token}`, 'x-csrf-token': csrf }, payload: chatBody });
  assert.strictEqual(chatRes.statusCode, 200);
  const chatJson = JSON.parse(chatRes.payload);
  assert.strictEqual(chatJson.status, 'ok');

  // Delete key
  const delRes = await app.inject({ method: 'DELETE', url: '/api/ollama/delete-key', headers: { cookie: `session_token=${cbJson.session_token}`, 'x-csrf-token': csrf } });
  const delJson = JSON.parse(delRes.payload);
  assert.strictEqual(delJson.status, 'success');

  // Confirm key deleted
  const check3 = await app.inject({ method: 'GET', url: '/api/ollama/check-key', headers: { cookie: `session_token=${cbJson.session_token}` } });
  const check3Json = JSON.parse(check3.payload);
  assert.strictEqual(check3Json.has_key, false);

  console.log('Ollama keys endpoints test passed');
  await app.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
