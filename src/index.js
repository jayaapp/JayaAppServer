const path = require('path');
const fs = require('fs');
const fastify = require('fastify');
const cookie = require('@fastify/cookie');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const pino = require('pino');
const config = require('./config');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch (e) {}

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

// Configure logging: write to logs/server.log in production, stdout in development
const logLevel = (config.LOG_LEVEL || 'info').toLowerCase();
const logTarget = process.env.NODE_ENV === 'development' 
  ? { target: 'pino-pretty', options: { colorize: true } }
  : { target: 'pino/file', options: { destination: path.join(logsDir, 'server.log'), mkdir: true } };

const logger = pino({
  level: logLevel,
  redact: { paths: redactPaths, censor: '***REDACTED***' },
  transport: logTarget
});

async function build() {
  const app = fastify({
    logger,
    bodyLimit: 1048576, // 1MB request body limit
    trustProxy: true // Trust X-Forwarded-* headers from reverse proxy
  });

  // Basic plugins
  await app.register(cookie);
  await app.register(cors, {
    origin: config.FRONTEND_URLS,
    credentials: true
  });
  // capture raw bodies for specific routes (webhooks)
  // Use our custom raw_body plugin to preserve exact bytes for webhook signature verification
  // This avoids the deprecation warning from fastify-raw-body package
  await app.register(require('./plugins/raw_body'), { bodyLimit: 1048576 });
  if (config.SECURITY_HEADERS_ENABLED) {
    await app.register(helmet, { contentSecurityPolicy: false });
    
    // Add additional security headers matching the Python reference implementation
    app.addHook('onSend', async (request, reply, payload) => {
      // These headers complement what helmet provides
      reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      reply.header('Pragma', 'no-cache');
      reply.header('Expires', '0');
      return payload;
    });
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

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      try {
        await app.close();
        logger.info('Server closed successfully');
        process.exit(0);
      } catch (err) {
        logger.error('Error during shutdown', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', err);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at', promise, 'reason:', reason);
      // Don't exit on unhandled rejection, just log it
    });

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
