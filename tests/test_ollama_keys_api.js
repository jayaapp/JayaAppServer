const assert = require('assert');
const os = require('os');
const path = require('path');

process.env.JAYAAPP_DB_PATH = path.join(os.tmpdir(), `jayaapp_test_ollama_keys_${process.pid}_${Date.now()}.db`);
process.env.NODE_ENV = 'test';
// Ensure encryption master secret available
process.env.OLLAMA_KEY_ENCRYPTION_KEY = 'test_master_secret_which_is_long_enough_12345';

const build = require('../src/index');
const sessionModule = require('../src/plugins/session');
const donations = require('../src/models/donations');

async function run() {
  const app = await build();
  try {
    donations.initDonationsTable();
    // create in-memory session for user 'alice'
    const user = { login: 'alice', email: 'alice@example.com' };
    const s = sessionModule._inMemory.createInMemorySession({ login: user.login, email: user.email });
    const token = s.token;

    // Store key
    const keyValue = 'ollama_api_key_test_1234567890';
    const resStore = await app.inject({ method: 'POST', url: '/ollama/store-key', payload: { ollama_api_key: keyValue }, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    assert.strictEqual(resStore.statusCode, 200);
    const j1 = JSON.parse(resStore.payload);
    assert.strictEqual(j1.status, 'success');

    // Check key exists
    const resCheck = await app.inject({ method: 'GET', url: '/ollama/check-key', headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(resCheck.statusCode, 200);
    const j2 = JSON.parse(resCheck.payload);
    assert.strictEqual(j2.status, 'success');
    assert.strictEqual(j2.has_key, true);
    assert.ok(j2.masked_key && j2.masked_key.includes('...'));

    // Get decrypted key
    const resGet = await app.inject({ method: 'GET', url: '/ollama/get-key', headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(resGet.statusCode, 200);
    const j3 = JSON.parse(resGet.payload);
    assert.strictEqual(j3.status, 'success');
    assert.strictEqual(j3.has_key, true);
    assert.strictEqual(j3.api_key, keyValue);

    // Delete key
    const resDel = await app.inject({ method: 'DELETE', url: '/ollama/delete-key', headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(resDel.statusCode, 200);
    const j4 = JSON.parse(resDel.payload);
    assert.strictEqual(j4.status, 'success');

    // Check key gone
    const resCheck2 = await app.inject({ method: 'GET', url: '/ollama/check-key', headers: { authorization: `Bearer ${token}` } });
    assert.strictEqual(resCheck2.statusCode, 200);
    const j5 = JSON.parse(resCheck2.payload);
    assert.strictEqual(j5.status, 'success');
    assert.strictEqual(j5.has_key, false);

    await app.close();
    console.log('Ollama keys API test passed');
  } catch (err) {
    console.error('Ollama keys API test failed:', err);
    try { await app.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
