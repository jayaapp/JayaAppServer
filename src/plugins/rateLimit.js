const fs = require('fs');
const config = require('../config');

function register(fastify, opts, done) {
  const requestsPerWindow = Number(config.RATE_LIMIT_REQUESTS) || 60;
  const windowSeconds = Number(config.RATE_LIMIT_WINDOW) || 60;

  // in-memory fallback
  const clients = new Map();

  function isAllowedMemory(ip) {
    if (!ip) return true;
    const now = Date.now() / 1000;
    const windowStart = now - windowSeconds;
    let arr = clients.get(ip);
    if (!arr) {
      arr = [];
      clients.set(ip, arr);
    }
    while (arr.length && arr[0] < windowStart) arr.shift();
    if (arr.length >= requestsPerWindow) return false;
    arr.push(now);
    return true;
  }

  fastify.addHook('onRequest', async (request, reply) => {
    const ip = request.ip || (request.raw && request.raw.socket && request.raw.socket.remoteAddress) || 'unknown';
    const client = fastify.redis;
    if (client && client.status === 'ready') {
      try {
        const now = Math.floor(Date.now() / 1000);
        const windowId = Math.floor(now / windowSeconds);
        const key = `rl:${ip}:${windowId}`;
        const v = await client.incr(key);
        if (v === 1) await client.expire(key, windowSeconds + 1);
        if (v > requestsPerWindow) {
          const windowEnd = (windowId + 1) * windowSeconds;
          const retryAfter = Math.max(1, windowEnd - now);
          reply.code(429);
          reply.header('Retry-After', String(retryAfter));
          return reply.send({ status: 'error', message: 'Rate limit exceeded', retry_after: retryAfter });
        }
      } catch (e) {
        fastify.log && fastify.log.warn && fastify.log.warn('Redis rate check failed', e && e.message ? e.message : e);
        // fail-open to avoid blocking traffic if Redis has issues
      }
    } else {
      const allowed = isAllowedMemory(ip);
      if (!allowed) {
        reply.code(429).send({ status: 'error', message: 'Rate limit exceeded' });
      }
    }
  });

  fastify.decorate('rateLimit', { requestsPerWindow, windowSeconds });

  done();
}

module.exports = register;
