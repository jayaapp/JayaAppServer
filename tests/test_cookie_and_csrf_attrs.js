const assert = require('assert');
const os = require('os');
const path = require('path');

// Isolate DB per test run
process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_cookie_${process.pid}_${Date.now()}.db`);

const build = require('../src/index');

async function run() {
  // mock global.fetch to intercept GitHub calls
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('github.com/login/oauth/access_token')) {
      return {
        async json() { return { access_token: 'fake-access-token' }; }
      };
    }

    if (typeof url === 'string' && url.includes('api.github.com/user')) {
      return {
        async json() { return { id: 99999, login: 'cookietest', name: 'Cookie Test', avatar_url: '' }; }
      };
    }

    if (typeof url === 'string' && url.includes('api.github.com/user/emails')) {
      return {
        async json() { return [ { email: 'cookietest@example.com', primary: true, verified: true } ]; }
      };
    }

    throw new Error('Unexpected fetch URL: ' + url);
  };

  const csrfModule = require('../src/plugins/csrf');
  const config = require('../src/config');
  const crypto = require('crypto');

  const app = await build();

  // 1) initiate login to get state
  const loginRes = await app.inject({ method: 'GET', url: '/auth/login' });
  assert.strictEqual(loginRes.statusCode, 200);
  const loginJson = JSON.parse(loginRes.payload);

  // 2) callback to create session (this should set the cookie)
  const callbackRes = await app.inject({ method: 'GET', url: `/auth/callback?code=fakecode&state=${loginJson.state}` });
  assert.strictEqual(callbackRes.statusCode, 200);
  const cbJson = JSON.parse(callbackRes.payload);
  assert.strictEqual(cbJson.status, 'success');
  const token = cbJson.session_token;

  // Verify Set-Cookie header exists and contains expected attributes
  const setCookie = callbackRes.headers && (callbackRes.headers['set-cookie'] || callbackRes.headers['Set-Cookie']);
  assert.ok(setCookie, 'Set-Cookie header present');
  const sc = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
  assert.ok(sc.includes(`session_token=${token}`), 'cookie contains session token');
  // HttpOnly should be present
  assert.ok(/httponly/i.test(sc), 'HttpOnly flag present');
  // SameSite should be present and lax
  assert.ok(/samesite=/i.test(sc), 'SameSite attribute present');
  assert.ok(/lax/i.test(sc), 'SameSite value includes Lax');
  // Expires or Max-Age or Path should be present
  assert.ok(/expires=/i.test(sc) || /max-age=/i.test(sc), 'Expires or Max-Age present');
  assert.ok(/path=\//i.test(sc), 'Path=/ present');

  // 3) fetch /auth/user to obtain csrf_token
  const userRes = await app.inject({ method: 'GET', url: '/auth/user', headers: { cookie: `session_token=${token}` } });
  assert.strictEqual(userRes.statusCode, 200);
  const userJson = JSON.parse(userRes.payload);
  assert.strictEqual(userJson.status, 'success');
  const csrf = userJson.csrf_token;
  assert.ok(csrf, 'csrf token returned');

  // Validate CSRF token using module helper (fresh token should validate)
  const okFresh = csrfModule.validateCsrfToken(token, csrf);
  assert.strictEqual(okFresh, true, 'fresh CSRF token validates');

  // Build an expired CSRF token (older than 3600s) and ensure validation fails
  const expiredTs = Math.floor(Date.now() / 1000) - (3600 + 10);
  const message = `${token}:${expiredTs}`;
  const hmac = crypto.createHmac('sha256', String(config.SESSION_SECRET || ''));
  hmac.update(message);
  const expiredToken = `${hmac.digest('hex')}:${expiredTs}`;
  const okExpired = csrfModule.validateCsrfToken(token, expiredToken);
  assert.strictEqual(okExpired, false, 'expired CSRF token does not validate');

  console.log('Cookie & CSRF attribute tests passed');
  await app.close();
  process.exit(0);
}

run().catch(err => {
  console.error('Cookie & CSRF attrs test failed:', err);
  process.exit(1);
});
