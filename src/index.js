const path = require('path');
const fastify = require('fastify');
const cookie = require('@fastify/cookie');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const pino = require('pino');
const config = require('./config');

// Default redact paths for common sensitive fields (headers, cookies, auth tokens)
const defaultRedact = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'authorization',
  'cookie',
  'payload.authorization',
  'payload.cookie',
  'payload.password',
  'payload.token',
  'payload.session_token',
  'params.password'
];

// Extend redact paths with any configured sensitive keys (map to object keys and shallow paths)
const extra = (config.SENSITIVE_KEYS || []).map(k => k).filter(Boolean);
const redactPaths = defaultRedact.concat(extra.map(k => `payload.${k}`)).concat(extra.map(k => `req.headers.${k}`));

const logger = pino({ level: (config.LOG_LEVEL || 'info').toLowerCase(), redact: { paths: redactPaths, censor: '***REDACTED***' } });

async function build() {
  const app = fastify({ logger });

  // Basic plugins
  await app.register(cookie);
  await app.register(cors, {
    origin: config.FRONTEND_URLS,
    credentials: true
  });
  // capture raw bodies for specific routes (webhooks)
  // Use the installed `fastify-raw-body` package to preserve exact bytes for webhook signature verification
  await app.register(require('fastify-raw-body'), { field: 'rawBody', global: false, encoding: 'utf8', runFirst: true });
  if (config.SECURITY_HEADERS_ENABLED) {
    await app.register(helmet, { contentSecurityPolicy: false });
  }

  // Internal plugins
  await app.register(require('./plugins/redis'));
  await app.register(require('./plugins/session'));
  await app.register(require('./plugins/csrf'));
  await app.register(require('./plugins/rateLimit'));
  await app.register(require('./plugins/aiRateLimit'), { limit: 10, windowSeconds: 60 });
  await app.register(require('./plugins/authenticate'));
  await app.register(require('./plugins/perf'));
  // Routes
  await app.register(require('./routes/auth'));
  await app.register(require('./routes/donations'));
  await app.register(require('./routes/admin'));
  await app.register(require('./routes/ollama'));

  app.get('/health', async (req, reply) => ({ status: 'ok' }));

  return app;
}

if (require.main === module) {
  (async () => {
    const app = await build();
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    try {
      await app.listen({ port, host: '0.0.0.0' });
      logger.info(`Server listening on port ${port}`);
    } catch (err) {
      logger.error(err);
      process.exit(1);
    }
  })();
}

module.exports = build;
