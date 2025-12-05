const fp = require('fastify-plugin');
const paypal = require('../services/paypal');
const donations = require('../models/donations');
  const stripeService = require('../services/stripe');
const campaignsService = require('../services/campaigns');
const config = require('../config');

async function routes(fastify, opts) {
  // ensure table exists
  donations.initDonationsTable();

  fastify.post('/donations/create', async (request, reply) => {
    try {
      const body = request.body || {};
      const { sponsor_type, target_identifier, amount, currency = 'USD', message, idempotency_key, provider = 'paypal' } = body;
      if (!sponsor_type || !amount) {
        return reply.code(400).send({ status: 'error', message: 'Invalid request' });
      }

      // Validate amount with min/max limits (matching Python reference)
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return reply.code(400).send({ status: 'error', message: 'Amount must be a positive number' });
      }
      if (amountNum < config.DONATION_MIN_AMOUNT) {
        return reply.code(400).send({ status: 'error', message: `Amount must be at least $${config.DONATION_MIN_AMOUNT.toFixed(2)}` });
      }
      if (amountNum > config.DONATION_MAX_AMOUNT) {
        return reply.code(400).send({ status: 'error', message: `Amount cannot exceed $${config.DONATION_MAX_AMOUNT.toFixed(2)}` });
      }

      // Validate and sanitize message (matching Python reference)
      let sanitizedMessage = message ? String(message).trim() : null;
      if (sanitizedMessage) {
        if (sanitizedMessage.length > 500) {
          return reply.code(400).send({ status: 'error', message: 'Message too long (max 500 characters)' });
        }
        // Basic HTML/script tag prevention
        if (/<|>|script/i.test(sanitizedMessage)) {
          return reply.code(400).send({ status: 'error', message: 'Invalid characters in message' });
        }
      }

      const prov = (provider || 'paypal').toString().toLowerCase();
      const userId = (request.session && request.session.user && request.session.user.login) || 'anonymous';
      const userEmail = (request.session && request.session.user && request.session.user.email) || null;

      let sponsorshipId = null;
      if (idempotency_key) {
        // Reserve or find existing sponsorship row
        sponsorshipId = donations.addSponsorship({ user_id: userId, user_email: userEmail, sponsor_type, target_identifier, amount_usd: amount, currency, payment_provider: prov === 'stripe' ? 'stripe' : 'paypal', payment_provider_order_id: null, message: sanitizedMessage, idempotency_key });
        const reserved = donations.tryReserveSponsorshipByIdempotencyKey(idempotency_key);
        if (!reserved) {
          // Poll for existing order id set by another worker
          const maxRetries = 10;
          let found = null;
          for (let i = 0; i < maxRetries; i++) {
            const existing = donations.getSponsorshipByIdempotencyKey(idempotency_key);
            if (existing && existing.payment_provider_order_id) {
              found = existing;
              break;
            }
            await new Promise(r => setTimeout(r, 50));
          }
          if (found) return reply.send({ status: 'ok', sponsorship_id: found.id, order_id: found.payment_provider_order_id, approval_url: null, existing: found });
        }
      }

      // Create provider-specific order/payment
      let order = null;
      let orderId = null;
      if (prov === 'stripe') {
        // Create a Checkout Session for parity with the draft server
        const successUrl = `${config.FRONTEND_URL}/?donation=success`;
        const cancelUrl = `${config.FRONTEND_URL}/?donation=cancelled`;
        const metadata = {};
        if (idempotency_key) metadata.idempotency_key = idempotency_key;
        const sess = await stripeService.createCheckoutSession({ amount, currency, description: `JayaApp donation ${sponsor_type}`, success_url: successUrl, cancel_url: cancelUrl, metadata });
        order = sess;
        orderId = sess.id;
      } else {
        order = await paypal.createOrder({ amount, currency, description: `JayaApp donation ${sponsor_type}`, custom_id: idempotency_key });
        orderId = order.id || order.order_id || (order.data && order.data.id);
      }

      // Persist sponsorship
      if (idempotency_key) {
        donations.setOrderIdForIdempotencyKey(idempotency_key, orderId);
        const updated = donations.getSponsorshipByIdempotencyKey(idempotency_key);
        sponsorshipId = updated ? updated.id : sponsorshipId;
      } else {
        sponsorshipId = donations.addSponsorship({ user_id: userId, user_email: userEmail, sponsor_type, target_identifier, amount_usd: amount, currency, payment_provider: prov === 'stripe' ? 'stripe' : 'paypal', payment_provider_order_id: orderId, message: sanitizedMessage, idempotency_key: null });
      }

      const result = { status: 'ok', sponsorship_id: sponsorshipId, order_id: orderId, raw: order };
      if (prov === 'stripe') {
        result.checkout_url = order.url || order.checkout_url || order.session_url || null;
        result.client_secret = order.client_secret || null;
      } else {
        const links = order.links || [];
        const approval = links.find(l => l.rel === 'approve') || links.find(l => l.rel === 'approval_url');
        result.approval_url = approval ? approval.href : null;
      }
      return reply.send(result);
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error('donations.create error', err && err.message ? err.message : err);
        if (err && err.stack) request.log.error(err.stack);
      }
      return reply.code(500).send({ status: 'error', message: err && err.message ? err.message : 'Failed to create donation order' });
    }
  });

  fastify.post('/donations/confirm', async (request, reply) => {
    try {
      const { order_id } = request.body || {};
      if (!order_id) return reply.code(400).send({ status: 'error', message: 'Missing order_id' });
      // Determine provider by looking up sponsorship row
      const row = donations.getSponsorshipByOrder(order_id);
      if (row && row.payment_provider === 'stripe') {
        // For Stripe, verify Checkout Session completed
        const sess = await stripeService.verifySessionCompleted(order_id);
        if (sess && sess.paid) {
          const ok = donations.completeSponsorship(order_id, sess.charge_id || sess.payment_intent || null);
          return reply.send({ status: ok ? 'ok' : 'warning', method: 'stripe', session: sess, updated: ok });
        }
        return reply.send({ status: 'error', message: 'Stripe session not paid', session: sess });
      }

      // Default to PayPal capture flow
      const capture = await paypal.captureOrder(order_id);
      // Extract capture id
      let captureId = null;
      if (capture && capture.purchase_units && capture.purchase_units[0] && capture.purchase_units[0].payments && capture.purchase_units[0].payments.captures && capture.purchase_units[0].payments.captures[0]) {
        captureId = capture.purchase_units[0].payments.captures[0].id;
      }
      // mark completed in DB
      const ok = donations.completeSponsorship(order_id, captureId);
      return reply.send({ status: ok ? 'ok' : 'warning', capture, updated: ok });
    } catch (err) {
      request.log && request.log.error && request.log.error('donations.confirm error', err && err.message ? err.message : err);
      return reply.code(500).send({ status: 'error', message: 'Failed to capture order' });
    }
  });

  // List donation campaigns with progress
  fastify.get('/donations/campaigns', async (request, reply) => {
    try {
      const list = campaignsService.getCampaigns();
      return reply.send({ status: 'ok', campaigns: list });
    } catch (err) {
      request.log && request.log.error && request.log.error('donations.campaigns error', err && err.message ? err.message : err);
      return reply.code(500).send({ status: 'error', message: 'Failed to load campaigns' });
    }
  });

  // PayPal webhook endpoint
  fastify.post('/webhooks/paypal', { config: { rawBody: true } }, async (request, reply) => {
    try {
      const raw = request.rawBody || request.bodyRaw || (request.raw && request.raw.body);
      const bodyRaw = raw || Buffer.from(JSON.stringify(request.body || {}));
      const headers = {};
      // Copy relevant headers lowercased
      for (const k of Object.keys(request.headers || {})) headers[k.toLowerCase()] = request.headers[k];

      const verified = await paypal.verifyWebhookSignature(headers, bodyRaw);
      if (!verified) {
        request.log && request.log.warn && request.log.warn('PayPal webhook verification failed');
        return reply.code(400).send({ status: 'error', message: 'Invalid signature' });
      }

      const event = typeof bodyRaw === 'string' ? JSON.parse(bodyRaw) : JSON.parse(bodyRaw.toString('utf8'));
      const eventType = event.event_type || (event.event && event.event.type);

      // Handle capture completed events
      if (eventType === 'PAYMENT.CAPTURE.COMPLETED' || eventType === 'PAYMENT.CAPTURE.DONE') {
        const resource = event.resource || event.data || {};
        const orderId = resource.supplementary_data && resource.supplementary_data.related_ids && resource.supplementary_data.related_ids.order_id || resource.order_id || (resource.parent_payment);
        const captureId = resource.id || (resource.capture_id);
        if (orderId) {
          donations.completeSponsorship(orderId, captureId || null);
        }
      }

      // Respond 200
      return reply.send({ status: 'ok' });
    } catch (err) {
      if (request.log && request.log.error) {
        request.log.error('webhooks.paypal error', err && err.message ? err.message : err);
        if (err && err.stack) request.log.error(err.stack);
      }
      return reply.code(500).send({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  });

  // Stripe webhook endpoint
  fastify.post('/webhooks/stripe', { config: { rawBody: true } }, async (request, reply) => {
    try {
      const raw = request.rawBody || request.bodyRaw || (request.raw && request.raw.body);
      const bodyRaw = raw || Buffer.from(JSON.stringify(request.body || {}));
      const headers = {};
      for (const k of Object.keys(request.headers || {})) headers[k.toLowerCase()] = request.headers[k];

      const verified = await stripeService.verifyWebhookSignature(headers, bodyRaw);
      if (!verified) {
        request.log && request.log.warn && request.log.warn('Stripe webhook verification failed');
        return reply.code(400).send({ status: 'error', message: 'Invalid signature' });
      }

      const event = typeof bodyRaw === 'string' ? JSON.parse(bodyRaw) : JSON.parse(bodyRaw.toString('utf8'));
      const eventType = event.type || event.event_type;

      // Handle checkout.session.completed event (Stripe Checkout flow)
      if (eventType === 'checkout.session.completed') {
        const resource = event.data && event.data.object ? event.data.object : {};
        const sessionId = resource.id;
        const paymentIntent = resource.payment_intent;
        if (sessionId && paymentIntent) {
          donations.completeSponsorship(sessionId, paymentIntent);
        }
      }

      // Handle PaymentIntent success and failure
      if (eventType === 'payment_intent.succeeded' || eventType === 'payment_intent.payment_failed') {
        const resource = event.data && event.data.object ? event.data.object : event.resource || {};
        const orderId = resource.id; // PaymentIntent id
        const chargeId = resource.charges && resource.charges.data && resource.charges.data[0] && resource.charges.data[0].id;
        if (orderId && eventType === 'payment_intent.succeeded') {
          donations.completeSponsorship(orderId, chargeId || null);
        }
        if (orderId && eventType === 'payment_intent.payment_failed') {
          // mark failed (update status)
          const db = require('../models/db').getDb();
          db.prepare("UPDATE sponsorships SET status = 'failed' WHERE payment_provider_order_id = ?").run(orderId);
        }
      }

      // Handle charge.refunded events — update sponsorship status to 'refunded'
      if (eventType === 'charge.refunded' || eventType === 'charge.refund.updated') {
        const resource = event.data && event.data.object ? event.data.object : event.resource || {};
        const chargeId = resource.id || (resource.charge && resource.charge.id) || null;
        if (chargeId) {
          const rowByCharge = donations.getSponsorshipByCaptureId(chargeId);
          if (rowByCharge) {
            const db = require('../models/db').getDb();
            db.prepare("UPDATE sponsorships SET status = 'refunded' WHERE id = ?").run(rowByCharge.id);
          }
        }
      }

      // Handle charge.succeeded events — mark completed if we can match by charge id
      if (eventType === 'charge.succeeded') {
        const resource = event.data && event.data.object ? event.data.object : event.resource || {};
        const chargeId = resource.id || null;
        if (chargeId) {
          const rowByCharge = donations.getSponsorshipByCaptureId(chargeId);
          if (rowByCharge) {
            const db = require('../models/db').getDb();
            db.prepare("UPDATE sponsorships SET status = 'completed', payment_provider_capture_id = ? , completed_at = strftime('%s','now') WHERE id = ?").run(chargeId, rowByCharge.id);
          }
        }
      }

      return reply.send({ status: 'ok' });
    } catch (err) {
      request.log && request.log.error && request.log.error('webhooks.stripe error', err && err.message ? err.message : err);
      return reply.code(500).send({ status: 'error', message: err && err.message ? err.message : String(err) });
    }
  });
}

module.exports = fp(routes);
