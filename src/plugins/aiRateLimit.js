const fs = require('fs');
const config = require('../config');

// module-level shared state so the limiter can be used outside of fastify decorate
const perIp = new Map();
let WINDOW_SECONDS = 60; // default
let LIMIT = 10;
let mode = null;
let timer = null;

function cleanup() {
  const now = Date.now() / 1000;
  for (const [ip, dq] of perIp.entries()) {
    while (dq.length && dq[0] < now - WINDOW_SECONDS) dq.shift();
    if (dq.length === 0) perIp.delete(ip);
  }
}

// exported check function
async function aiRateLimitCheck(request, reply) {
  try {
    // Prefer forwarded header when present (tests set `x-forwarded-for`).
    // Normalize to first entry if a comma-separated list is present.
    let ip = 'unknown';
    try {
      const hdr = request && request.headers && (request.headers['x-forwarded-for'] || request.headers['x-real-ip']);
      if (hdr && typeof hdr === 'string') {
        ip = hdr.split(',')[0].trim();
      } else if (request && request.ip) {
        ip = request.ip;
      } else if (request && request.raw && request.raw.socket && request.raw.socket.remoteAddress) {
        ip = request.raw.socket.remoteAddress;
      }
    } catch (e) {
      ip = 'unknown';
    }
    // Decide mode on first check and then keep it stable for the life of the process.
    const client = (request && request.server && request.server.redis) || null;
    if (mode === null) {
      if (client && client.status === 'ready') mode = 'redis';
      else mode = 'memory';
      request.log && request.log.debug && request.log.debug(`aiRateLimit selected mode=${mode}`);
    }

    if (mode === 'redis' && client) {
      const now = Math.floor(Date.now() / 1000);
      const windowId = Math.floor(now / WINDOW_SECONDS);
      const key = `ai:${ip}:${windowId}`;
      try {
        const v = await client.incr(key);
        if (v === 1) await client.expire(key, WINDOW_SECONDS + 1);
        if (v > LIMIT) {
          const windowEnd = (windowId + 1) * WINDOW_SECONDS;
          const retryAfter = Math.max(1, windowEnd - now);
          reply.code(429);
          reply.header('Retry-After', String(retryAfter));
          return reply.send({ status: 'error', message: 'Too many AI requests. Please try again later.', retry_after: retryAfter });
        }
      } catch (e) {
        request.log && request.log.warn && request.log.warn('aiRateLimit redis check failed', e && e.message ? e.message : e);
        return; // fail-open
      }
      return;
    }

    // Fallback in-memory behavior
    const now = Date.now() / 1000;
    let dq = perIp.get(ip);
    if (!dq) {
      dq = [];
      perIp.set(ip, dq);
    }
    request.log && request.log.debug && request.log.debug(`aiRateLimit memory before ip=${ip} count=${dq.length}`);
    // remove old entries
    while (dq.length && dq[0] < now - WINDOW_SECONDS) dq.shift();
    if (dq.length >= LIMIT) {
      // Too many
      reply.code(429);
      reply.header('Retry-After', String(WINDOW_SECONDS));
      return reply.send({ status: 'error', message: 'Too many AI requests. Please try again later.', retry_after: WINDOW_SECONDS });
    }
    dq.push(now);
    request.log && request.log.debug && request.log.debug(`aiRateLimit memory after ip=${ip} count=${dq.length}`);
    return;
  } catch (e) {
    // on error, allow request to proceed (fail-open)
    request.log && request.log.warn && request.log.warn('aiRateLimitCheck error', e && e.message ? e.message : e);
    return;
  }
}

module.exports = function (fastify, opts, done) {
  WINDOW_SECONDS = opts.windowSeconds || WINDOW_SECONDS;
  LIMIT = opts.limit || LIMIT;
  if (!timer) {
    timer = setInterval(cleanup, WINDOW_SECONDS * 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }
  // decorate for compatibility
  try {
    fastify.decorate('aiRateLimitCheck', aiRateLimitCheck);
  } catch (e) {
    fastify.log && fastify.log.warn && fastify.log.warn('decorate aiRateLimitCheck failed', e && e.message ? e.message : e);
  }

    try {
    fastify.decorate('aiRateLimitState', perIp);
    fastify.log && fastify.log.debug && fastify.log.debug('aiRateLimit decorated state');
  } catch (e) {
    fastify.log && fastify.log.warn && fastify.log.warn('aiRateLimit decorate failed', e && e.message ? e.message : e);
  }

  // export for direct access
  module.exports.aiRateLimitCheck = aiRateLimitCheck;
  module.exports.aiRateLimitState = perIp;

  // Ensure timer is cleaned up when Fastify closes; Redis lifecycle is centralized
  fastify.addHook('onClose', async (instance) => {
    try {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    } catch (e) {
      fastify.log.warn('Error during aiRateLimit shutdown', e && e.message ? e.message : e);
    }
  });

  done();
};
