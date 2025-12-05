function register(fastify, opts, done) {
  // Minimal performance/analytics hooks that mirror Python names
  fastify.decorate('trackAuthEvent', (eventType, details) => {
    fastify.log.info(`AUTH_EVENT ${eventType}`, details || {});
  });

  fastify.decorate('trackSessionStart', (sessionToken, details) => {
    fastify.log.info(`SESSION_START ${sessionToken}`, details || {});
  });

  fastify.decorate('trackSessionEnd', (sessionToken, details) => {
    fastify.log.info(`SESSION_END ${sessionToken}`, details || {});
  });

  fastify.decorate('trackPerformanceMetric', (name, value) => {
    fastify.log.debug(`METRIC ${name}=${value}`);
  });

  done();
}

module.exports = register;
