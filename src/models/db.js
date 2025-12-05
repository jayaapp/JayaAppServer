const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const DB_FILE = process.env.JAYAAPP_DB_PATH || path.join(__dirname, '..', '..', 'jayaapp_server.db');

function init() {
  const dir = path.dirname(DB_FILE);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  const db = new Database(DB_FILE);

  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT,
      name TEXT,
      avatar_url TEXT,
      email TEXT,
      created_at INTEGER,
      last_login INTEGER,
      metadata TEXT
    );
  `);

  return db;
}

let _db = null;
function getDb() {
  if (!_db) _db = init();
  return _db;
}

module.exports = { getDb };
