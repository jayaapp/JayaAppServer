const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const fs = require('fs');

// TTL in seconds for Redis
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

// In-memory fallback store
const sessions = new Map();

function createInMemorySession(user) {
  const token = uuidv4();
  const now = Date.now();
  const session = {
    token,
    user,
    createdAt: now,
    expiresAt: now + DEFAULT_TTL_SECONDS * 1000
  };
  sessions.set(token, session);
  return session;
}

function getInMemorySession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(token);
    return null;
  }
  // fixed expiry: do not refresh expiresAt on access (align with reference server)
  return s;
}

function destroyInMemorySession(token) {
  return sessions.delete(token);
}

// Redis-backed helpers will use `fastify.redis` when available

function register(fastify, opts, done) {
  fastify.log.debug && fastify.log.debug('session plugin register called');


  // wrapper functions that choose Redis if available
  const createSession = async (user) => {
    const client = fastify.redis;
    if (client && client.status === 'ready') {
      const token = uuidv4();
      const payload = JSON.stringify({ token, user, createdAt: Date.now() });
      try {
        // ioredis provides setex
        await client.setex(`session:${token}`, DEFAULT_TTL_SECONDS, payload);
        return { token, user, createdAt: Date.now(), expiresAt: Date.now() + DEFAULT_TTL_SECONDS * 1000 };
      } catch (e) {
        fastify.log.warn('Failed to store session in Redis, falling back to memory', e && e.message ? e.message : e);
        return createInMemorySession(user);
      }
    }
    return createInMemorySession(user);
  };

  const getSession = async (token) => {
    const client = fastify.redis;
    if (!token) return null;
    if (client && client.status === 'ready') {
      try {
        const data = await client.get(`session:${token}`);
        if (!data) return null;
        const parsed = JSON.parse(data);
        // fixed TTL: do not extend Redis expiry on read (expiration handled by Redis setex)
        return { token: parsed.token, user: parsed.user, createdAt: parsed.createdAt, expiresAt: parsed.createdAt + DEFAULT_TTL_SECONDS * 1000 };
      } catch (e) {
        fastify.log.warn('Failed to read session from Redis, falling back to memory', e && e.message ? e.message : e);
        return getInMemorySession(token);
      }
    }
    return getInMemorySession(token);
  };

  const destroySession = async (token) => {
    const client = fastify.redis;
    if (client && client.status === 'ready') {
      try {
        await client.del(`session:${token}`);
        return true;
      } catch (e) {
        fastify.log.warn('Failed to destroy session in Redis, falling back to memory', e && e.message ? e.message : e);
        return destroyInMemorySession(token);
      }
    }
    return destroyInMemorySession(token);
  };

  // decorate fastify instance
  fastify.decorate('createSession', createSession);
  fastify.decorate('getSession', getSession);
  fastify.decorate('destroySession', destroySession);

  // add helper to request (resolve session synchronously where possible)
  fastify.addHook('preHandler', async (request, reply) => {
    // Prefer cookie-based session_token, fall back to Authorization: Bearer <token>
    let token = request.cookies && request.cookies.session_token;
    if (!token) {
      const auth = request.headers && request.headers.authorization;
      if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
        token = auth.slice(7).trim();
      }
    }

    if (!token) {
      request.session = null;
      return;
    }

    try {
      // getSession may be async (redis)
      request.session = await getSession(token);
    } catch (err) {
      request.log.warn('Failed to load session', err.message || err);
      request.session = null;
    }
  });

  fastify.log.debug && fastify.log.debug('session plugin register done');
  // Redis client lifecycle is handled by the centralized redis plugin

  done();
}

module.exports = register;
// export helper functions for direct require usage (in-memory versions)
module.exports._inMemory = {
  createInMemorySession,
  getInMemorySession,
  destroyInMemorySession
};

// Export TTL so other modules (auth) can align cookie expiry
module.exports.TTL_SECONDS = DEFAULT_TTL_SECONDS;
