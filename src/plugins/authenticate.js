async function register(fastify, opts) {
  // Decorator usable as preHandler: await fastify.authenticate(request, reply)
  fastify.decorate('authenticate', async function (request, reply) {
    if (!request.session) {
      // try to populate from Authorization header (session plugin also attempts this in preHandler)
      if (request.headers && request.headers.authorization && request.headers.authorization.toLowerCase().startsWith('bearer ')) {
        // noop here; session preHandler should have populated request.session
      }
      reply.code(401);
      return reply.send({ status: 'error', message: 'Not authenticated' });
    }
  });

  // A convenience preHandler wrapper usable in route definitions
  fastify.decorateRequest('ensureAuthenticated', null);

  fastify.addHook('preHandler', async (request, reply) => {
    // leave request.ensureAuthenticated available but no-op unless used
  });
}

module.exports = register;
