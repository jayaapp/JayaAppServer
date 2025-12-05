const { getDb } = require('./db');

function initDonationsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sponsorships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      user_email TEXT,
      sponsor_type TEXT NOT NULL,
      target_identifier TEXT,
      amount_usd DECIMAL(10,2) NOT NULL,
      currency TEXT DEFAULT 'USD',
      payment_provider TEXT DEFAULT 'paypal',
      payment_provider_order_id TEXT UNIQUE,
      payment_provider_capture_id TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now')),
      reserved_at INTEGER,
      completed_at INTEGER,
      idempotency_key TEXT UNIQUE
    );
  `);

  // Ensure legacy DBs get the reserved_at column
  try {
    const info = db.prepare("PRAGMA table_info('sponsorships')").all();
    const hasReserved = info.some(r => r.name === 'reserved_at');
    if (!hasReserved) {
      db.prepare('ALTER TABLE sponsorships ADD COLUMN reserved_at INTEGER').run();
    }
  } catch (e) {
    // ignore
  }
}

function addSponsorship({ user_id, user_email, sponsor_type, target_identifier, amount_usd, currency = 'USD', payment_provider = 'paypal', payment_provider_order_id = null, message = null, idempotency_key = null }) {
  const db = getDb();
  // Attempt idempotent insert if idempotency_key provided to avoid duplicates on retries.
  if (idempotency_key) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO sponsorships (user_id, user_email, sponsor_type, target_identifier, amount_usd, currency, payment_provider, payment_provider_order_id, message, status, idempotency_key)
      VALUES (@user_id, @user_email, @sponsor_type, @target_identifier, @amount_usd, @currency, @payment_provider, @payment_provider_order_id, @message, 'pending', @idempotency_key)
    `);
    const info = insert.run({ user_id, user_email, sponsor_type, target_identifier, amount_usd, currency, payment_provider, payment_provider_order_id, message, idempotency_key });
    if (info.changes && info.lastInsertRowid) return info.lastInsertRowid;
    // If the insert was ignored because the idempotency_key already exists, return the existing row id
    const existing = db.prepare(`SELECT id FROM sponsorships WHERE idempotency_key = ?`).get(idempotency_key);
    return existing ? existing.id : null;
  }

  const stmt = db.prepare(`
    INSERT INTO sponsorships (user_id, user_email, sponsor_type, target_identifier, amount_usd, currency, payment_provider, payment_provider_order_id, message, status, idempotency_key)
    VALUES (@user_id, @user_email, @sponsor_type, @target_identifier, @amount_usd, @currency, @payment_provider, @payment_provider_order_id, @message, 'pending', @idempotency_key)
  `);
  const info = stmt.run({ user_id, user_email, sponsor_type, target_identifier, amount_usd, currency, payment_provider, payment_provider_order_id, message, idempotency_key });
  return info.lastInsertRowid;
}

function completeSponsorship(payment_provider_order_id, payment_provider_capture_id) {
  const db = getDb();
  const update = db.prepare(`
    UPDATE sponsorships SET status = 'completed', payment_provider_capture_id = @capture, completed_at = strftime('%s','now')
    WHERE payment_provider_order_id = @order AND status = 'pending'
  `);
  const info = update.run({ capture: payment_provider_capture_id, order: payment_provider_order_id });
  return info.changes > 0;
}

function setOrderIdForIdempotencyKey(idempotency_key, orderId) {
  const db = getDb();
  const update = db.prepare(`
    UPDATE sponsorships SET payment_provider_order_id = @order WHERE idempotency_key = @key AND (payment_provider_order_id IS NULL OR payment_provider_order_id = '')
  `);
  const info = update.run({ order: orderId, key: idempotency_key });
  return info.changes > 0;
}

function setOrderIdForSponsorshipId(sponsorshipId, orderId) {
  const db = getDb();
  const update = db.prepare(`
    UPDATE sponsorships SET payment_provider_order_id = @order WHERE id = @id
  `);
  const info = update.run({ order: orderId, id: sponsorshipId });
  return info.changes > 0;
}

function tryReserveSponsorshipByIdempotencyKey(idempotency_key) {
  const db = getDb();
  const update = db.prepare(`
    UPDATE sponsorships SET reserved_at = strftime('%s','now') WHERE idempotency_key = @key AND (payment_provider_order_id IS NULL OR payment_provider_order_id = '') AND (reserved_at IS NULL)
  `);
  const info = update.run({ key: idempotency_key });
  return info.changes > 0;
}

function getSponsorshipByIdempotencyKey(key) {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM sponsorships WHERE idempotency_key = ?`);
  return stmt.get(key);
}

function getSponsorshipByOrder(orderId) {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM sponsorships WHERE payment_provider_order_id = ?`);
  return stmt.get(orderId);
}

function getSponsorshipByCaptureId(captureId) {
  const db = getDb();
  const stmt = db.prepare(`SELECT * FROM sponsorships WHERE payment_provider_capture_id = ?`);
  return stmt.get(captureId);
}

module.exports = {
  initDonationsTable,
  addSponsorship,
  completeSponsorship,
  setOrderIdForIdempotencyKey,
  setOrderIdForSponsorshipId,
  tryReserveSponsorshipByIdempotencyKey,
  getSponsorshipByIdempotencyKey,
  getSponsorshipByOrder
  , getSponsorshipByCaptureId
};

