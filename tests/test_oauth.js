const assert = require('assert');
const os = require('os');
const path = require('path');

// Use an isolated temporary SQLite DB per test run to avoid cross-test contamination
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_${process.pid}_${Date.now()}.db`);

const build = require('../src/index');

async function run() {
  // mock global.fetch to intercept GitHub calls
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('github.com/login/oauth/access_token')) {
      return {
        async json() {
          return { access_token: 'fake-access-token' };
        }
      };
    }

    if (typeof url === 'string' && url.includes('api.github.com/user')) {
      return {
        async json() {
          return { id: 12345, login: 'testuser', name: 'Test User', avatar_url: '' };
        }
      };
    }

    if (typeof url === 'string' && url.includes('api.github.com/user/emails')) {
      return {
        async json() {
          return [ { email: 'testuser@example.com', primary: true, verified: true } ];
        }
      };
    }

    throw new Error('Unexpected fetch URL: ' + url);
  };

  const app = await build();
  console.log('createSession type:', typeof app.createSession);

  // 1) call /auth/login and get JSON containing auth_url and state
  const loginRes = await app.inject({ method: 'GET', url: '/auth/login' });
  assert.strictEqual(loginRes.statusCode, 200, 'login should return 200');
  const loginJson = JSON.parse(loginRes.payload);
  assert.strictEqual(loginJson.status, 'success');
  assert.ok(loginJson.auth_url, 'auth_url present');
  assert.ok(loginJson.state, 'state present');

  // 2) simulate callback with code and state
  const callbackRes = await app.inject({ method: 'GET', url: `/auth/callback?code=fakecode&state=${loginJson.state}` });
  assert.strictEqual(callbackRes.statusCode, 200, 'callback should return 200');
  const cbJson = JSON.parse(callbackRes.payload);
  console.log('cbJson:', cbJson);
  const sessionModule = require('../src/plugins/session');
  console.log('session check for token:', sessionModule._inMemory.getInMemorySession(cbJson.session_token));
  assert.strictEqual(cbJson.status, 'success');
  assert.ok(cbJson.session_token, 'session token returned');
  assert.ok(cbJson.user && cbJson.user.login === 'testuser');

  // 3) subsequent /auth/user with cookie should return user
  const userRes = await app.inject({ method: 'GET', url: '/auth/user', headers: { cookie: `session_token=${cbJson.session_token}` } });
  assert.strictEqual(userRes.statusCode, 200);
  const userJson = JSON.parse(userRes.payload);
  assert.strictEqual(userJson.status, 'success');
  assert.strictEqual(userJson.user.login, 'testuser');

  console.log('OAuth flow test passed');

  await app.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
