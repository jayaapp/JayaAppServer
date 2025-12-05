const crypto = require('crypto');
const config = require('../config');

const DEFAULT_MAX_AGE = 60 * 60; // 1 hour

function generateCsrfToken(sessionToken) {
  if (!sessionToken) return null;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${sessionToken}:${timestamp}`;
  const hmac = crypto.createHmac('sha256', String(config.SESSION_SECRET || ''));
  hmac.update(message);
  const token = hmac.digest('hex');
  return `${token}:${timestamp}`;
}

function validateCsrfToken(sessionToken, csrfToken, maxAgeSeconds = DEFAULT_MAX_AGE) {
  if (!sessionToken) return false;
  if (!csrfToken || typeof csrfToken !== 'string') return false;
  const parts = csrfToken.split(':');
  if (parts.length !== 2) return false;
  const [token, tsStr] = parts;
  const ts = parseInt(tsStr, 10);
  if (Number.isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > maxAgeSeconds) return false;
  const message = `${sessionToken}:${tsStr}`;
  const hmac = crypto.createHmac('sha256', String(config.SESSION_SECRET || ''));
  hmac.update(message);
  const expected = hmac.digest('hex');
  // constant-time compare
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
}

function register(fastify, opts, done) {
  fastify.decorate('generateCsrfToken', generateCsrfToken);
  fastify.decorate('validateCsrfToken', validateCsrfToken);

  // preHandler middleware for routes that need CSRF protection
  fastify.decorate('csrfProtection', async function (request, reply) {
    // Only accept the canonical header used by the frontend: X-CSRF-Token
    const header = request.headers && request.headers['x-csrf-token'];
    const session = request.session;
    if (!session || !session.token) {
      reply.code(401);
      return reply.send({ status: 'error', message: 'Not authenticated' });
    }
    if (!header) {
      reply.code(403);
      return reply.send({ status: 'error', message: 'Missing CSRF token' });
    }
    const ok = validateCsrfToken(session.token, header);
    if (!ok) {
      reply.code(403);
      return reply.send({ status: 'error', message: 'Invalid CSRF token' });
    }
  });

  done();
}

module.exports = register;
// export helpers for direct require usage
module.exports.generateCsrfToken = generateCsrfToken;
module.exports.validateCsrfToken = validateCsrfToken;
