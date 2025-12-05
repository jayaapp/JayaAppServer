const { URLSearchParams } = require('url');
const config = require('../config');
const { createOrUpdateUser, getUserById } = require('../models/user');

// ephemeral in-memory state store for OAuth (state -> {createdAt, redirect})
const oauthStates = new Map();
const STATE_TTL = 10 * 60 * 1000; // 10 minutes

function generateState() {
  const state = require('crypto').randomBytes(16).toString('hex');
  oauthStates.set(state, { createdAt: Date.now() });
  // schedule cleanup (unref so test processes can exit)
  const t = setTimeout(() => oauthStates.delete(state), STATE_TTL + 1000);
  if (t && typeof t.unref === 'function') t.unref();
  return state;
}

function validateState(state) {
  if (!state) return false;
  const entry = oauthStates.get(state);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > STATE_TTL) {
    oauthStates.delete(state);
    return false;
  }
  // valid, consume it
  oauthStates.delete(state);
  return true;
}

const sessionModule = require('../plugins/session');
async function routes(fastify, options) {
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, FRONTEND_URL } = config;
  const csrfModule = require('../plugins/csrf');

  function getRedirectUri(request) {
    // Prefer configured FRONTEND_URL when set
    if (config.FRONTEND_URL) return config.FRONTEND_URL.replace(/\/$/, '') + '/auth/callback';
    // Use X-Forwarded-Proto/Host when present (behind proxies)
    const proto = (request.headers && (request.headers['x-forwarded-proto'] || request.headers['x-forwarded-protocol'])) || request.protocol || 'https';
    const host = (request.headers && (request.headers['x-forwarded-host'] || request.headers.host)) || 'localhost';
    return `${proto}://${host}/auth/callback`;
  }

  function isAllowedRedirect(nextUrl) {
    if (!nextUrl) return false;
    // Allow relative paths
    if (nextUrl.startsWith('/')) return true;
    try {
      const u = new URL(nextUrl);
      // Allow if origin matches configured FRONTEND_URLS
      const origins = (config.FRONTEND_URLS || []).map(s => {
        try { return (new URL(s)).origin; } catch (e) { return s.replace(/\/$/, ''); }
      });
      return origins.includes(u.origin);
    } catch (e) {
      return false;
    }
  }

  fastify.get('/auth/login', async (request, reply) => {
    const state = generateState();
    const params = new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      redirect_uri: getRedirectUri(request),
      scope: 'read:user,user:email',
      state
    });
    const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    // For SPA usage, return JSON; also support redirect
    if (request.query.redirect === 'true') {
      reply.redirect(authUrl);
      return;
    }
    return { status: 'success', auth_url: authUrl, state };
  });

  fastify.get('/auth/callback', async (request, reply) => {
    const { code, state } = request.query;
    if (!code || !state || !validateState(state)) {
      reply.code(400);
      return { status: 'error', message: 'Invalid OAuth state or missing code' };
    }

    // Exchange code for access token
    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code })
      });
      // parse JSON body when possible
      let tokenJson = null;
      if (tokenRes && typeof tokenRes.json === 'function') {
        try { tokenJson = await tokenRes.json(); } catch (e) { tokenJson = null; }
      }
      if (tokenRes && tokenRes.ok === false) {
        const txt = (tokenRes && typeof tokenRes.text === 'function') ? await tokenRes.text().catch(() => '') : JSON.stringify(tokenJson || {});
        request.log.warn('GitHub token endpoint returned non-OK', { status: tokenRes.status, body: txt });
        reply.code(502);
        return { status: 'error', message: 'GitHub token exchange failed', detail: txt };
      }
      if (!tokenJson || !tokenJson.access_token) {
        request.log.warn('GitHub token response missing access_token', tokenJson);
        reply.code(400);
        return { status: 'error', message: 'Failed to obtain access token', detail: tokenJson };
      }

      const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `Bearer ${tokenJson.access_token}`, 'User-Agent': 'JayaApp', 'Accept': 'application/json' }
      });
      let user = null;
      if (userRes && typeof userRes.json === 'function') {
        try { user = await userRes.json(); } catch (e) { user = null; }
      }
      if (userRes && userRes.ok === false) {
        const txt = (userRes && typeof userRes.text === 'function') ? await userRes.text().catch(() => '') : JSON.stringify(user || {});
        request.log.warn('GitHub /user returned non-OK', { status: userRes.status, body: txt });
        reply.code(502);
        return { status: 'error', message: 'Failed to fetch GitHub user', detail: txt };
      }
      if (!user || !user.id || !user.login) {
        request.log.warn('GitHub /user missing expected fields', user);
        reply.code(502);
        return { status: 'error', message: 'GitHub user response missing required fields', detail: user };
      }

      // If GitHub did not return an email in the user object, fetch the user's emails
      // and prefer the primary & verified email.
      if ((!user.email || user.email === null) && tokenJson.access_token) {
        try {
          const emailsRes = await fetch('https://api.github.com/user/emails', {
            headers: { 'Authorization': `Bearer ${tokenJson.access_token}`, 'User-Agent': 'JayaApp', 'Accept': 'application/json' }
          });
          const emailsJson = await emailsRes.json();
          if (Array.isArray(emailsJson) && emailsJson.length > 0) {
            const primary = emailsJson.find(e => e.primary && e.verified && e.email);
            const verified = emailsJson.find(e => e.verified && e.email);
            const first = emailsJson.find(e => e.email);
            user.email = (primary && primary.email) || (verified && verified.email) || (first && first.email) || null;
          }
        } catch (e) {
          // ignore email fetch errors; we'll persist without email if unavailable
          request.log.warn('Failed to fetch user emails from GitHub', e && e.message ? e.message : e);
        }
      }

      // basic user normalization
      const userRecord = {
        id: String(user.id),
        login: user.login,
        name: user.name || '',
        avatar_url: user.avatar_url || '',
        email: user.email || null
      };

      // persist user to DB
      const storedUser = createOrUpdateUser(userRecord);

      // create session and set cookie (fastify.createSession may be async when Redis is enabled)
      const createSessionFn = (typeof fastify.createSession === 'function') ? fastify.createSession.bind(fastify) : sessionModule._inMemory.createInMemorySession;
      const session = await createSessionFn(storedUser);

      // analytics hooks
      try {
        if (typeof fastify.trackAuthEvent === 'function') fastify.trackAuthEvent('login', { user: storedUser.login });
        if (typeof fastify.trackSessionStart === 'function') fastify.trackSessionStart(session.token, { user: storedUser.login });
      } catch (e) {
        request.log.debug('perf hooks error', e && e.message ? e.message : e);
      }

      // Align cookie expiry with session TTL exported by session plugin
      const cookieOpts = {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        // set expires so browsers evict the cookie when the session expires
        expires: new Date(Date.now() + (sessionModule.TTL_SECONDS || 0) * 1000)
      };

      reply.setCookie('session_token', session.token, cookieOpts);

      // redirect to frontend or return JSON
      const requestedNext = request.query.next;
      const redirectTo = (requestedNext && isAllowedRedirect(requestedNext)) ? requestedNext : (FRONTEND_URL || '/');
      if (request.query.as === 'redirect') {
        reply.redirect(redirectTo);
        return;
      }

      return { status: 'success', session_token: session.token, user: storedUser };
    } catch (err) {
      request.log.error(err);
      reply.code(500);
      return { status: 'error', message: 'OAuth callback processing failed' };
    }
  });

  fastify.get('/auth/user', async (request, reply) => {
    // Determine token candidate (so we can generate CSRF even if session object lacks token)
    let tokenCandidate = null;
    if (request.cookies && request.cookies.session_token) tokenCandidate = request.cookies.session_token;
    const authHeader = request.headers && request.headers.authorization;
    if (!tokenCandidate && authHeader && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      tokenCandidate = authHeader.slice(7).trim();
    }

    // Try request.session (session plugin now supports cookies or Authorization bearer token)
    let s = request.session;
    if (!s) {
      // As a fallback, check Authorization: Bearer <token>
      const auth = request.headers && request.headers.authorization;
      if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        if (token) {
          if (typeof fastify.getSession === 'function') {
            try {
              s = await fastify.getSession(token);
            } catch (e) {
              s = sessionModule._inMemory.getInMemorySession(token);
            }
          } else {
            s = sessionModule._inMemory.getInMemorySession(token);
          }
        }
      }
      // Also support cookie header fallback (some clients/tests set cookie header directly)
      if (!s) {
        const cookieHeader = request.headers && request.headers.cookie;
        if (cookieHeader) {
          const match = cookieHeader.match(/(?:^|;)\s*session_token=([^;]+)/);
          if (match) {
            const token = match[1];
            if (token) {
              if (!tokenCandidate) tokenCandidate = token;
              if (typeof fastify.getSession === 'function') {
                try {
                  s = await fastify.getSession(token);
                } catch (e) {
                  s = sessionModule._inMemory.getInMemorySession(token);
                }
              } else {
                s = sessionModule._inMemory.getInMemorySession(token);
              }
            }
          }
        }
      }
    }

    if (!s) {
      reply.code(401);
      return { status: 'error', message: 'Not authenticated' };
    }

    // If session contains a user id, prefer fresh DB read
    try {
      if (s.user && s.user.id) {
        const fresh = getUserById(s.user.id);
        const userOut = fresh || s.user;
        // Attach csrf token for client use if available
        const csrf_token = tokenCandidate ? ((typeof fastify.generateCsrfToken === 'function') ? fastify.generateCsrfToken(tokenCandidate) : (csrfModule && typeof csrfModule.generateCsrfToken === 'function' ? csrfModule.generateCsrfToken(tokenCandidate) : null)) : null;
        return { status: 'success', user: userOut, csrf_token };
      }
    } catch (e) {
      // ignore DB errors and fall back to session user
    }

    const csrf_token = tokenCandidate ? ((typeof fastify.generateCsrfToken === 'function') ? fastify.generateCsrfToken(tokenCandidate) : (csrfModule && typeof csrfModule.generateCsrfToken === 'function' ? csrfModule.generateCsrfToken(tokenCandidate) : null)) : null;
    return { status: 'success', user: s.user, csrf_token };
  });

  fastify.post('/auth/logout', async (request, reply) => {
    // Require CSRF protection on logout
    if (typeof fastify.csrfProtection === 'function') {
      const maybe = await fastify.csrfProtection(request, reply);
      // if csrfProtection already sent a reply (for errors), stop
      if (reply.sent) return;
    }

    const token = request.cookies && request.cookies.session_token;
    if (token) {
      try {
        if (typeof fastify.destroySession === 'function') {
          await fastify.destroySession(token);
        } else {
          // fallback to in-memory destroy
          try { sessionModule._inMemory.destroyInMemorySession(token); } catch (e) {}
        }
      } catch (e) {
        request.log.warn('Error destroying session during logout', e && e.message ? e.message : e);
      }
      // Clear cookie (set expiry in the past)
      reply.clearCookie('session_token', { path: '/' });
    }
      try {
        if (typeof fastify.trackSessionEnd === 'function') fastify.trackSessionEnd(token, {});
        if (typeof fastify.trackAuthEvent === 'function') fastify.trackAuthEvent('logout', { token });
      } catch (e) {}
    return { status: 'success' };
  });
}

module.exports = routes;
