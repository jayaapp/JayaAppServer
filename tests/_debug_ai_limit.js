const build = require('../src/index');

(async function () {
  process.env.NODE_ENV = 'test';
  // mock fetch for GitHub and Ollama
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

  const app = await build();

  // create session
  const loginRes = await app.inject({ method: 'GET', url: '/auth/login' });
  const loginJson = JSON.parse(loginRes.payload);
  const callbackRes = await app.inject({ method: 'GET', url: `/auth/callback?code=fakecode&state=${loginJson.state}` });
  const cbJson = JSON.parse(callbackRes.payload);

  const ip = '127.0.0.1';
  const body = { messages: [{ role: 'user', content: 'hello' }] };

  for (let i = 0; i < 12; i++) {
    const res = await app.inject({ method: 'POST', url: '/api/ollama/proxy-chat', payload: body, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, cookie: `session_token=${cbJson.session_token}` } });
    console.log(`request ${i+1} status=${res.statusCode}`);
  }

  // inspect internal state
  try {
    await app.ready();
    console.log('has decorator aiRateLimitState (hasDecorator):', app.hasDecorator && app.hasDecorator('aiRateLimitState'));
    console.log('has decorator aiRateLimitCheck (hasDecorator):', app.hasDecorator && app.hasDecorator('aiRateLimitCheck'));
    console.log('aiRateLimitCheck typeof:', typeof app.aiRateLimitCheck);
    const st = app.aiRateLimitState;
    if (st) {
      console.log('aiRateLimitState size:', st.size);
      console.log('aiRateLimitState keys:', Array.from(st.keys()));
      const dq = st.get(ip) || [];
      console.log('dq length:', dq.length, 'dq sample:', dq.slice(0,5));
    }
    console.log('fastify decoration keys:', Object.keys(app));
  } catch (e) {
    console.error('inspect failed', e);
  }

  await app.close();
})();
