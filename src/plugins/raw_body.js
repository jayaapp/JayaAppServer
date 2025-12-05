const fp = require('fastify-plugin');

// Simple raw-body plugin: when a route sets `config.rawBody = true`,
// this plugin will capture the incoming request bytes into `request.rawBody`.
// It avoids adding an external dependency so tests and CI work offline.

module.exports = fp(function rawBody(fastify, opts, done) {
  const limit = (opts && opts.bodyLimit) || 1024 * 1024; // default 1MB

  fastify.addHook('onRequest', (request, reply, next) => {
    try {
      const cfg = request.routeOptions && request.routeOptions.config;
      if (!cfg || !cfg.rawBody) return next();

      const req = request.raw;
      const chunks = [];
      let size = 0;

      function cleanup() {
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
      }

      function onData(chunk) {
        size += chunk.length;
        if (size > limit) {
          cleanup();
          reply.code(413).send({ status: 'error', message: 'Payload too large' });
          return;
        }
        chunks.push(Buffer.from(chunk));
      }

      function onEnd() {
        try {
          request.rawBody = Buffer.concat(chunks);
        } catch (e) {
          request.rawBody = Buffer.from('');
        }
        cleanup();
        next();
      }

      function onError(err) {
        cleanup();
        next(err);
      }

      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    } catch (e) {
      next(e);
    }
  });

  done();
});
