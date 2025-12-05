const { getDb } = require('./db');
const { encryptApiKey, decryptApiKey, maskApiKey } = require('../utils/ollama_keys_encryption');

function initTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ollama_keys (
      user_id TEXT PRIMARY KEY,
      api_key_encrypted BLOB NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      updated_at INTEGER DEFAULT (strftime('%s','now')),
      last_used_at INTEGER
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ollama_keys_last_used ON ollama_keys(last_used_at);
  `);
}

initTable();

function storeKey(userId, apiKey) {
  if (!userId) return [false, 'userId required'];
  if (!apiKey || String(apiKey).length < 8) return [false, 'API key appears invalid'];
  try {
    const enc = encryptApiKey(apiKey, userId);
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
      INSERT INTO ollama_keys (user_id, api_key_encrypted, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET api_key_encrypted = excluded.api_key_encrypted, updated_at = excluded.updated_at
    `);
    stmt.run(userId, enc, now);
    return [true, 'API key stored successfully'];
  } catch (e) {
    return [false, String(e)];
  }
}

function getKey(userId) {
  if (!userId) return [false, null, 'userId required'];
  try {
    const db = getDb();
    const row = db.prepare('SELECT api_key_encrypted FROM ollama_keys WHERE user_id = ?').get(userId);
    if (!row) return [false, null, 'No API key found'];
    // Update last_used_at
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE ollama_keys SET last_used_at = ? WHERE user_id = ?').run(now, userId);
    const encrypted = row.api_key_encrypted;
    const apiKey = decryptApiKey(encrypted, userId);
    return [true, apiKey, 'API key retrieved'];
  } catch (e) {
    return [false, null, String(e)];
  }
}

function checkKeyExists(userId) {
  if (!userId) return [false, null];
  try {
    const db = getDb();
    const row = db.prepare('SELECT api_key_encrypted FROM ollama_keys WHERE user_id = ?').get(userId);
    if (!row) return [false, null];
    // try to decrypt to produce masked version
    const enc = row.api_key_encrypted;
    const apiKey = decryptApiKey(enc, userId);
    const masked = maskApiKey(apiKey);
    return [true, masked];
  } catch (e) {
    return [false, null];
  }
}

function deleteKey(userId) {
  if (!userId) return [false, 'userId required'];
  try {
    const db = getDb();
    const res = db.prepare('DELETE FROM ollama_keys WHERE user_id = ?').run(userId);
    if (res.changes > 0) return [true, 'API key deleted'];
    return [false, 'No API key found'];
  } catch (e) {
    return [false, String(e)];
  }

}

module.exports = { storeKey, getKey, checkKeyExists, deleteKey };
