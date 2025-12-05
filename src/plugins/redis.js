const fs = require('fs');
const config = require('../config');
let IORedis;
try { IORedis = require('ioredis'); } catch (e) { IORedis = null; }

function register(fastify, opts, done) {
  fastify.log.debug && fastify.log.debug('redis plugin register called');

  const socketPath = config.REDIS_SOCKET_PATH || process.env.REDIS_SOCKET_PATH || null;
  const redisUrl = process.env.REDIS_URL || null;

  // If no redis config, decorate with null and exit silently
  if (!IORedis) {
    fastify.log.info('ioredis not installed; redis plugin disabled');
    fastify.decorate('redis', null);
    done();
    return;
  }

  if (socketPath && !fs.existsSync(socketPath)) {
    fastify.log.info(`Redis socket ${socketPath} not found; skipping Redis plugin`);
    fastify.decorate('redis', null);
    done();
    return;
  }

  if (!socketPath && !redisUrl) {
    fastify.log.info('No REDIS_SOCKET_PATH or REDIS_URL configured; redis plugin disabled');
    fastify.decorate('redis', null);
    done();
    return;
  }

  let client;
  try {
    if (socketPath) client = new IORedis({ path: socketPath, lazyConnect: true });
    else client = new IORedis(redisUrl, { lazyConnect: true });

    // Provide the client on fastify immediately; it may be null until connected
    fastify.decorate('redis', client);

    // attempt to connect but don't block startup
    client.connect().then(() => {
      fastify.log.info('Redis client connected');
    }).catch(err => {
      fastify.log.warn('Redis client connect failed; redis disabled for this run', err && err.message ? err.message : err);
      try { client.disconnect(); } catch (e) {}
      fastify.redis = null;
    });
  } catch (err) {
    fastify.log.warn('Redis init error; redis disabled', err && err.message ? err.message : err);
    if (client) try { client.disconnect(); } catch (e) {}
    fastify.decorate('redis', null);
  }

  // ensure cleanup on close
  fastify.addHook('onClose', async (instance) => {
    const c = fastify.redis;
    if (c) {
      try {
        await c.disconnect();
        fastify.log.info('Redis client disconnected');
      } catch (e) {
        fastify.log.warn('Error disconnecting Redis client', e && e.message ? e.message : e);
      }
    }
  });

  done();
}

module.exports = register;
