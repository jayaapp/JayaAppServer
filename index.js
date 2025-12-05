// Entry point for LiteSpeed/Passenger hosting
// Passenger requires synchronous http.createServer pattern
const http = require('http');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
try { fs.mkdirSync(logsDir, { recursive: true }); } catch (e) {}

// Simple file logger (pino transport doesn't work well with Passenger's process model)
const logFile = path.join(logsDir, 'server.log');
function log(level, msg, data) {
  const entry = JSON.stringify({
    level,
    time: new Date().toISOString(),
    pid: process.pid,
    msg,
    ...data
  }) + '\n';
  fs.appendFileSync(logFile, entry);
}

// Create HTTP server synchronously (required by Passenger)
const server = http.createServer((req, res) => {
  // Placeholder until Fastify is ready
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Server starting up...' }));
});

// Start listening immediately (Passenger injects socket)
server.listen();
log(30, 'Server listening (Passenger mode)');

// Now bootstrap Fastify asynchronously and swap the handler
(async () => {
  try {
    const build = require('./src/index.js');
    const app = await build();
    await app.ready();
    
    // Replace the placeholder handler with Fastify's handler
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      app.routing(req, res);
    });
    
    log(30, 'Fastify routes ready');
    
    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      log(30, `Received ${signal}. Shutting down gracefully...`);
      try {
        await app.close();
        server.close();
        log(30, 'Server closed successfully');
        process.exit(0);
      } catch (err) {
        log(50, 'Error during shutdown', { error: err.message });
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (err) {
    log(50, 'Failed to initialize Fastify', { error: err.message, stack: err.stack });
    // Keep basic server running for diagnostics
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server initialization failed', details: err.message }));
    });
  }
})();
