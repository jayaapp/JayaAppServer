const assert = require('assert');
const os = require('os');
const path = require('path');

// Isolate DB per test run
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
          return { id: 54321, login: 'logoutuser', name: 'Logout User', avatar_url: '' };
        }
      };
    }

    if (typeof url === 'string' && url.includes('api.github.com/user/emails')) {
      return {
        async json() {
          return [ { email: 'logoutuser@example.com', primary: true, verified: true } ];
        }
      };
    }

    throw new Error('Unexpected fetch URL: ' + url);
  };

  const app = await build();

  // 1) initiate login to get state
  const loginRes = await app.inject({ method: 'GET', url: '/auth/login' });
  assert.strictEqual(loginRes.statusCode, 200);
  const loginJson = JSON.parse(loginRes.payload);

  // 2) callback to create session
  const callbackRes = await app.inject({ method: 'GET', url: `/auth/callback?code=fakecode&state=${loginJson.state}` });
  assert.strictEqual(callbackRes.statusCode, 200);
  const cbJson = JSON.parse(callbackRes.payload);
  assert.strictEqual(cbJson.status, 'success');
  const token = cbJson.session_token;

  // 3) fetch /auth/user to obtain csrf_token
  const userRes = await app.inject({ method: 'GET', url: '/auth/user', headers: { cookie: `session_token=${token}` } });
  assert.strictEqual(userRes.statusCode, 200);
  const userJson = JSON.parse(userRes.payload);
  assert.strictEqual(userJson.status, 'success');
  const csrf = userJson.csrf_token;
  assert.ok(csrf, 'csrf token returned');

  // 4) POST /auth/logout with CSRF header and cookie
  const logoutRes = await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie: `session_token=${token}`, 'X-CSRF-Token': csrf } });
  assert.strictEqual(logoutRes.statusCode, 200);
  const logoutJson = JSON.parse(logoutRes.payload);
  assert.strictEqual(logoutJson.status, 'success');

  // 5) subsequent /auth/user should be 401
  const afterRes = await app.inject({ method: 'GET', url: '/auth/user', headers: { cookie: `session_token=${token}` } });
  assert.strictEqual(afterRes.statusCode, 401);

  // verify in-memory session cleared
  const sessionModule = require('../src/plugins/session');
  const s = sessionModule._inMemory.getInMemorySession(token);
  assert.strictEqual(s, null);

  console.log('Logout + CSRF test passed');
  await app.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Logout CSRF test failed:', err);
  process.exit(1);
});
