/**
 * Ollama API Routes - Multi-Auth Support
 * 
 * Supports multiple authentication methods for flexible user access:
 * 1. GitHub OAuth (session-based) - for community features
 * 2. TrueHeart authentication (Bearer token) - for core app features
 * 
 * Token validation:
 * - GitHub sessions: Stored locally in session store
 * - TrueHeart tokens: Validated against TrueHeart backend API
 * 
 * User identification:
 * - GitHub: Uses github.login (username)
 * - TrueHeart: Uses email address
 * - Keys stored separately per user ID (no conflicts)
 */

const { Readable } = require('stream');
const config = require('../config');
const sessionModule = require('../plugins/session');
const { storeKey, getKey, checkKeyExists, deleteKey } = require('../models/ollama_keys');
const csrfModule = require('../plugins/csrf');

// Basic validation similar to the Python reference: messages array, limits
function validateChatRequest(body) {
  if (!body || typeof body !== 'object') return [false, 'Invalid request body'];
  const { messages } = body;
  if (!Array.isArray(messages)) return [false, 'Messages must be an array'];
  if (messages.length > 100) return [false, 'Message history too long (max 100 messages)'];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || typeof m !== 'object') return [false, `Message ${i} must be an object`];
    const content = (m.content !== undefined && m.content !== null) ? String(m.content) : '';
    if (typeof content !== 'string') return [false, `Message ${i} content must be a string`];
    if (content.length > 50000) return [false, `Message ${i} content too large (max 50KB)`];
  }
  return [true, ''];
}

// Validation for OCR vision requests
function validateOcrRequest(body) {
  if (!body || typeof body !== 'object') return [false, 'Invalid request body'];
  const { model, prompt, image } = body;
  
  if (!model || typeof model !== 'string') return [false, 'Model name is required'];
  if (model.length > 100) return [false, 'Model name too long'];
  
  if (!prompt || typeof prompt !== 'string') return [false, 'Prompt is required'];
  if (prompt.length > 10000) return [false, 'Prompt too long (max 10KB)'];
  
  if (!image || typeof image !== 'string') return [false, 'Image (base64) is required'];
  if (image.length > 10000000) return [false, 'Image too large (max ~10MB base64)'];
  
  return [true, ''];
}

async function routes(fastify, opts) {
  // Use Ollama cloud API base (per reference implementation)
  const targetBase = 'https://ollama.com';
  const targetPath = '/api/chat';

  fastify.post('/ollama/proxy-chat', async (request, reply) => {
    // Require authentication and CSRF like reference
    if (typeof fastify.csrfProtection === 'function') {
      await fastify.csrfProtection(request, reply);
      if (reply.sent) return;
    }
    const authLogin = await getAuthenticatedUserLogin(request);
    if (!authLogin) {
      reply.code(401);
      return { status: 'error', message: 'unauthorized' };
    }
    // Enforce per-IP AI limiter (mirrors Python reference)
    const aiLimiter = require('../plugins/aiRateLimit');
    if (typeof fastify.aiRateLimitCheck === 'function') {
      const maybe = await fastify.aiRateLimitCheck(request, reply);
      if (reply.sent) return;
    } else if (aiLimiter && typeof aiLimiter.aiRateLimitCheck === 'function') {
      const maybe = await aiLimiter.aiRateLimitCheck(request, reply);
      if (reply.sent) return;
    }
    // Minimal validation: body shape
    let body = request.body;
    const [ok, errMsg] = validateChatRequest(body);
    if (!ok) {
      reply.code(400);
      return { status: 'error', message: errMsg };
    }

    // Retrieve user's stored Ollama API key (like Python reference)
    const [keySuccess, ollamaApiKey, keyMessage] = getKey(authLogin);
    if (!keySuccess || !ollamaApiKey) {
      reply.code(401);
      return { status: 'error', message: 'No API key configured. Please add your Ollama API key in settings.' };
    }

    // Build outgoing headers: use user's stored Ollama API key
    const forwardHeaders = { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ollamaApiKey}`
    };

    // NOTE: we intentionally do not handle `enable_crowdsourcing` here yet.

    const targetUrl = `${targetBase}${targetPath}`;
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify(body)
      });

      // Forward status codes (default to 200 when not provided by a mock)
      try {
        reply.code(res && typeof res.status === 'number' ? res.status : 200);
      } catch (e) {
        reply.code(200);
      }

      // Forward selected headers (be defensive: mocks may not provide headers)
      let ct = null;
      if (res && res.headers && typeof res.headers.get === 'function') {
        try { ct = res.headers.get('content-type'); } catch (e) { ct = null; }
      }
      if (ct) reply.header('Content-Type', ct);

      // If response body is a WHATWG ReadableStream, convert to Node stream
      if (res.body && typeof res.body.getReader === 'function') {
        const nodeStream = Readable.fromWeb(res.body);
        // Fastify will handle streaming Node readable
        return reply.send(nodeStream);
      }

      // Fallback: read text and send
      const txt = await res.text();
      try {
        const parsed = JSON.parse(txt);
        return parsed;
      } catch (e) {
        return txt;
      }
    } catch (err) {
      request.log.warn('Ollama proxy error', err && err.message ? err.message : err);
      reply.code(502);
      return { status: 'error', message: 'Failed to reach Ollama server' };
    }
  });

  fastify.post('/ollama/proxy-ocr', {
    // Increase body limit for image uploads (10MB) to prevent 413 or 503 errors
    bodyLimit: 10485760 
  }, async (request, reply) => {
    // Require authentication and CSRF protection
    if (typeof fastify.csrfProtection === 'function') {
      await fastify.csrfProtection(request, reply);
      if (reply.sent) return;
    }
    const authLogin = await getAuthenticatedUserLogin(request);
    if (!authLogin) {
      reply.code(401);
      return { status: 'error', message: 'unauthorized' };
    }
    
    // Enforce per-IP AI limiter
    const aiLimiter = require('../plugins/aiRateLimit');
    if (typeof fastify.aiRateLimitCheck === 'function') {
      const maybe = await fastify.aiRateLimitCheck(request, reply);
      if (reply.sent) return;
    } else if (aiLimiter && typeof aiLimiter.aiRateLimitCheck === 'function') {
      const maybe = await aiLimiter.aiRateLimitCheck(request, reply);
      if (reply.sent) return;
    }
    
    // Validate OCR request body
    let body = request.body;
    const [ok, errMsg] = validateOcrRequest(body);
    if (!ok) {
      reply.code(400);
      return { status: 'error', message: errMsg };
    }

    // Retrieve user's stored Ollama API key
    const [keySuccess, ollamaApiKey, keyMessage] = getKey(authLogin);
    if (!keySuccess || !ollamaApiKey) {
      reply.code(401);
      return { status: 'error', message: 'No API key configured. Please add your Ollama API key in settings.' };
    }

    // Build vision API request with image in messages array
    const visionRequest = {
      model: body.model,
      messages: [
        {
          role: 'user',
          content: body.prompt,
          images: [body.image] // base64 encoded image
        }
      ],
      stream: false
    };

    // Build outgoing headers with user's API key
    const forwardHeaders = { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ollamaApiKey}`
    };

    const targetUrl = `${targetBase}${targetPath}`;
    try {
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: forwardHeaders,
        body: JSON.stringify(visionRequest)
      });

      // Forward status codes
      try {
        reply.code(res && typeof res.status === 'number' ? res.status : 200);
      } catch (e) {
        reply.code(200);
      }

      // Forward content-type header
      let ct = null;
      if (res && res.headers && typeof res.headers.get === 'function') {
        try { ct = res.headers.get('content-type'); } catch (e) { ct = null; }
      }
      if (ct) reply.header('Content-Type', ct);

      // Read and parse response
      const txt = await res.text();
      try {
        const parsed = JSON.parse(txt);
        return parsed;
      } catch (e) {
        return txt;
      }
    } catch (err) {
      request.log.warn('Ollama OCR proxy error', err && err.message ? err.message : err);
      reply.code(502);
      return { status: 'error', message: 'Failed to reach Ollama server' };
    }
  });

  // Helper: Validate TrueHeart token by calling TrueHeart backend
  async function validateTrueHeartToken(token, request) {
    try {
      // TrueHeart user service base URL
      const trueheartUserURL = config.TRUEHEART_USER_URL || 'https://trueheartapps.com/user';
      const authEndpoint = `${trueheartUserURL}/auth/validate`;
      fastify.log.info({ authEndpoint, hasToken: !!token }, 'Attempting TrueHeart token validation');
      
      const resp = await fetch(authEndpoint, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      fastify.log.info({ status: resp.status, ok: resp.ok }, 'TrueHeart validation response');
      
      if (resp.ok) {
        const data = await resp.json();
        fastify.log.info({ hasEmail: !!data.email, userId: data.user_id }, 'TrueHeart user data received');
        if (data.email && data.success) {
          // Return a session-like object with TrueHeart user info
          return {
            user: {
              id: data.email,
              login: data.email, // Use email as login identifier
              email: data.email,
              user_id: data.user_id,
              source: 'trueheart'
            }
          };
        }
      } else {
        const errorText = await resp.text();
        fastify.log.warn({ status: resp.status, error: errorText }, 'TrueHeart token validation failed');
      }
    } catch (e) {
      fastify.log.warn({ error: e.message }, 'TrueHeart token validation error');
    }
    return null;
  }

  // Helper: resolve session and user login (uses same fallback logic as auth routes)
  async function getAuthenticatedUserLogin(request) {
    // Try request.session first (only if it has a valid user)
    let s = request.session;
    if (!s || !s.user) {
      // try Authorization: Bearer token
      const auth = request.headers && request.headers.authorization;
      if (auth && typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
        const token = auth.slice(7).trim();
        if (token) {
          // Try local session store first (GitHub sessions)
          if (typeof fastify.getSession === 'function') {
            try { s = await fastify.getSession(token); } catch (e) { s = sessionModule._inMemory.getInMemorySession(token); }
          } else {
            s = sessionModule._inMemory.getInMemorySession(token);
          }
          // If no local session, try validating as TrueHeart token
          if (!s) {
            s = await validateTrueHeartToken(token, request);
          }
        }
      }
      // cookie header fallback
      if (!s) {
        const cookieHeader = request.headers && request.headers.cookie;
        if (cookieHeader) {
          const match = cookieHeader.match(/(?:^|;)\s*session_token=([^;]+)/);
          if (match) {
            const token = match[1];
            if (token) {
              if (typeof fastify.getSession === 'function') {
                try { s = await fastify.getSession(token); } catch (e) { s = sessionModule._inMemory.getInMemorySession(token); }
              } else {
                s = sessionModule._inMemory.getInMemorySession(token);
              }
            }
          }
        }
      }
    }
    if (!s || !s.user) return null;
    // prefer login if present
    return (s.user && s.user.login) ? s.user.login : (s.user.id ? String(s.user.id) : null);
  }

  // Store key (requires CSRF)
  fastify.post('/ollama/store-key', async (request, reply) => {
    if (typeof fastify.csrfProtection === 'function') {
      const maybe = await fastify.csrfProtection(request, reply);
      if (reply.sent) return;
    }

    const login = await getAuthenticatedUserLogin(request);
    if (!login) {
      reply.code(401);
      return { status: 'error', message: 'Authentication required' };
    }

    const key = request.body && (request.body.ollama_api_key || request.body.api_key || request.body.key);
    if (!key || String(key).trim().length === 0) {
      reply.code(400);
      return { status: 'error', message: 'ollama_api_key is required' };
    }
    if (String(key).trim().length < 10) {
      reply.code(400);
      return { status: 'error', message: 'API key appears to be invalid (too short)' };
    }

    const [ok, msg] = storeKey(login, String(key).trim());
    if (ok) return { status: 'success', message: msg };
    reply.code(500);
    return { status: 'error', message: msg };
  });

  // Check if user has a key (authenticated)
  fastify.get('/ollama/check-key', async (request, reply) => {
    const login = await getAuthenticatedUserLogin(request);
    if (!login) {
      reply.code(401);
      return { status: 'error', message: 'Authentication required' };
    }
    const [has, masked] = checkKeyExists(login);
    if (has) return { status: 'success', has_key: true, masked_key: masked };
    return { status: 'success', has_key: false };
  });

  // Get decrypted API key (authenticated)
  fastify.get('/ollama/get-key', async (request, reply) => {
    const login = await getAuthenticatedUserLogin(request);
    if (!login) {
      reply.code(401);
      return { status: 'error', message: 'Authentication required' };
    }
    const [ok, apiKey, msg] = getKey(login);
    if (ok) return { status: 'success', has_key: true, api_key: apiKey };
    return { status: 'success', has_key: false, message: msg };
  });

  // Delete key (requires CSRF)
  fastify.delete('/ollama/delete-key', async (request, reply) => {
    if (typeof fastify.csrfProtection === 'function') {
      const maybe = await fastify.csrfProtection(request, reply);
      if (reply.sent) return;
    }
    const login = await getAuthenticatedUserLogin(request);
    if (!login) {
      reply.code(401);
      return { status: 'error', message: 'Authentication required' };
    }
    const [ok, msg] = deleteKey(login);
    if (ok) return { status: 'success', message: msg };
    reply.code(404);
    return { status: 'error', message: msg };
  });

  // List models (proxy to /api/tags)
  fastify.get('/ollama/list-models', async (request, reply) => {
    const login = await getAuthenticatedUserLogin(request);
    if (!login) {
      reply.code(401);
      return { status: 'error', message: 'Authentication required' };
    }
    const targetUrl = `${targetBase}/api/tags`;
    try {
      const headers = {};
      if (request.headers && request.headers.authorization) headers['Authorization'] = request.headers.authorization;
      const res = await fetch(targetUrl, { method: 'GET', headers });
      if (!res.ok) {
        reply.code(res.status);
        const txt = await res.text();
        return { status: 'error', message: txt };
      }
      const data = await res.json();
      return data;
    } catch (e) {
      request.log.warn('Ollama list-models error', e && e.message ? e.message : e);
      reply.code(502);
      return { status: 'error', message: 'Failed to reach Ollama server' };
    }
  });
}

module.exports = routes;
