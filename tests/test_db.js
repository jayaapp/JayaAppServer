const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async function run() {
  const DB_PATH = path.join(__dirname, 'test_jayaapp.db');
  // Ensure a clean DB file
  try { fs.unlinkSync(DB_PATH); } catch (e) {}

  // Point the models to the test DB
  process.env.JAYAAPP_DB_PATH = DB_PATH;

  const { createOrUpdateUser, getUserById } = require('../src/models/user');

  // Create a user
  const inUser = { id: '99999', login: 'dbtester', name: 'DB Tester', avatar_url: '', email: 'dbtester@example.com' };
  const stored = createOrUpdateUser(inUser);
  assert.strictEqual(stored.id, String(inUser.id));
  assert.strictEqual(stored.login, inUser.login);
  assert.strictEqual(stored.email, inUser.email);

  // Update the same user
  const updatedInput = { ...inUser, name: 'DB Tester 2', email: 'db2@example.com' };
  const updated = createOrUpdateUser(updatedInput);
  assert.strictEqual(updated.name, 'DB Tester 2');
  assert.strictEqual(updated.email, 'db2@example.com');

  // getUserById
  const fetched = getUserById(inUser.id);
  assert.strictEqual(fetched.id, String(inUser.id));
  assert.strictEqual(fetched.login, inUser.login);

  console.log('DB persistence tests passed');

  // cleanup
  try { fs.unlinkSync(DB_PATH); } catch (e) {}
  process.exit(0);
})().catch(err => {
  console.error('DB test failed:', err);
  process.exit(1);
});
