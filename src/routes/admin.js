const fp = require('fastify-plugin');
const donations = require('../models/donations');
const config = require('../config');
const crypto = require('crypto');

function secureCompare(a, b) {
  try {
    const A = Buffer.from(a);
    const B = Buffer.from(b);
    if (A.length !== B.length) return false;
    return crypto.timingSafeEqual(A, B);
  } catch (e) {
    return false;
  }
}

function isAdminAuthorized(request) {
  const provided = (request.headers['x-admin-key'] || request.headers['x_admin_key'] || '').toString();
  if (!provided) return false;
  // Plaintext key check
  if (config.ADMIN_API_KEY && config.ADMIN_API_KEY.length > 0) {
    return secureCompare(provided, config.ADMIN_API_KEY);
  }
  // Hashed key check (store hex SHA256 of the key in ADMIN_API_KEY_HASH)
  if (config.ADMIN_API_KEY_HASH && config.ADMIN_API_KEY_HASH.length > 0) {
    const hash = crypto.createHash('sha256').update(provided).digest('hex');
    return secureCompare(hash, config.ADMIN_API_KEY_HASH);
  }
  // If no admin config present, default to allow (dev convenience)
  return true;
}

async function routes(fastify, opts) {
  // Ensure table exists
  donations.initDonationsTable();

  fastify.get('/admin/donations/sponsorships', async (request, reply) => {
    try {
      // Admin authorization
      if (!isAdminAuthorized(request)) {
        return reply.code(401).send({ status: 'error', message: 'Unauthorized' });
      }

      const page = Math.max(1, parseInt(request.query.page || '1', 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(request.query.page_size || '50', 10)));
      const offset = (page - 1) * pageSize;

      const status = request.query.status || null;
      const campaign = request.query.campaign || null; // matches target_identifier

      const db = require('../models/db').getDb();

      const where = [];
      const params = {};
      if (status) {
        where.push('status = @status');
        params.status = status;
      }
      if (campaign) {
        where.push('target_identifier = @campaign');
        params.campaign = campaign;
      }

      const whereClause = where.length ? ('WHERE ' + where.join(' AND ')) : '';

      const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM sponsorships ${whereClause}`).get(params);
      const total = totalRow ? totalRow.total : 0;

      const rows = db.prepare(`SELECT * FROM sponsorships ${whereClause} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`).all(Object.assign({}, params, { limit: pageSize, offset }));

      return reply.send({ status: 'ok', total, page, page_size: pageSize, items: rows });
    } catch (err) {
      request.log && request.log.error && request.log.error('admin.sponsorships error', err && err.message ? err.message : err);
      return reply.code(500).send({ status: 'error', message: 'Failed to query sponsorships' });
    }
  });

  // CSV export: /admin/donations/sponsorships.csv
  fastify.get('/admin/donations/sponsorships.csv', async (request, reply) => {
    try {
      if (!isAdminAuthorized(request)) {
        return reply.code(401).send({ status: 'error', message: 'Unauthorized' });
      }

      const status = request.query.status || null;
      const campaign = request.query.campaign || null;
      const start = request.query.start_date || null;
      const end = request.query.end_date || null;

      const db = require('../models/db').getDb();
      const where = [];
      const params = {};
      if (status) {
        where.push('status = @status'); params.status = status;
      }
      if (campaign) {
        where.push('target_identifier = @campaign'); params.campaign = campaign;
      }
      if (start) {
        where.push('created_at >= @start'); params.start = start;
      }
      if (end) {
        where.push('created_at <= @end'); params.end = end;
      }

      const whereClause = where.length ? ('WHERE ' + where.join(' AND ')) : '';
      const rows = db.prepare(`SELECT * FROM sponsorships ${whereClause} ORDER BY created_at DESC`).all(params);

      // Stream CSV to the client to avoid building large in-memory buffers
      const cols = ['id','idempotency_key','user_id','user_email','sponsor_type','target_identifier','amount_usd','currency','payment_provider','payment_provider_order_id','payment_provider_capture_id','status','reserved_at','created_at','completed_at','message'];
      const escape = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="sponsorships_${Date.now()}.csv"`);

      // Stream rows using a Readable so Node can apply backpressure
      const { Readable } = require('stream');
      const iterator = (function* () {
        yield cols.join(',') + '\n';
        for (const r of rows) {
          const vals = cols.map(c => escape(r[c]));
          yield vals.join(',') + '\n';
        }
      })();

      const rs = new Readable({
        read() {
          const next = iterator.next();
          if (next.done) return this.push(null);
          this.push(next.value);
        }
      });

      reply.send(rs);
    } catch (err) {
      request.log && request.log.error && request.log.error('admin.sponsorships.csv error', err && err.message ? err.message : err);
      return reply.code(500).send({ status: 'error', message: 'Failed to export CSV' });
    }
  });
}

module.exports = fp(routes);
