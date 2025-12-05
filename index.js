// Entry point for hosting providers that expect index.js in root
const build = require('./src/index.js');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch (e) {}

const logger = pino({
  level: 'info',
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: {
    target: 'pino/file',
    options: { destination: path.join(logsDir, 'server.log'), mkdir: true }
  }
});

(async () => {
  try {
    const app = await build();
    
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

    // LiteSpeed/Passenger mode: listen on port 0 (auto-assigned socket)
    // Standalone mode: use PORT env or default 3000
    const usePassenger = !process.env.PORT && !process.env.JAYAAPP_PORT;
    
    if (usePassenger) {
      const address = await app.listen({ port: 0, host: '0.0.0.0' });
      logger.info(`Server listening (Passenger mode) at ${address}`);
    } else {
      const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
      await app.listen({ port, host: '0.0.0.0' });
      logger.info(`Server listening on port ${port}`);
    }
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
})();
