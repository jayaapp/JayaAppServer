const { getDb } = require('./db');

function createOrUpdateUser(githubUser) {
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO users (id, login, name, avatar_url, email, created_at, last_login, metadata)
    VALUES (@id, @login, @name, @avatar_url, @email, @created_at, @last_login, @metadata)
    ON CONFLICT(id) DO UPDATE SET
      login=excluded.login,
      name=excluded.name,
      avatar_url=excluded.avatar_url,
      email=excluded.email,
      last_login=excluded.last_login,
      metadata=excluded.metadata
  `);

  const user = {
    id: String(githubUser.id),
    login: githubUser.login || '',
    name: githubUser.name || '',
    avatar_url: githubUser.avatar_url || '',
    email: githubUser.email || null,
    created_at: now,
    last_login: now,
    metadata: JSON.stringify(githubUser || {})
  };

  stmt.run(user);

  // Return the stored user object (fresh read)
  const row = db.prepare('SELECT id, login, name, avatar_url, email, created_at, last_login, metadata FROM users WHERE id = ?').get(user.id);
  if (row && row.metadata) row.metadata = JSON.parse(row.metadata);
  return row;
}

function getUserById(id) {
  const db = getDb();
  const row = db.prepare('SELECT id, login, name, avatar_url, email, created_at, last_login, metadata FROM users WHERE id = ?').get(String(id));
  if (!row) return null;
  if (row.metadata) row.metadata = JSON.parse(row.metadata);
  return row;
}

module.exports = { createOrUpdateUser, getUserById };
