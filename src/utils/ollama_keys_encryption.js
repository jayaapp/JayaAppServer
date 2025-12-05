const crypto = require('crypto');
const { Buffer } = require('buffer');
let Fernet = null;
try {
  Fernet = require('fernet');
} catch (err) {
  // optional, we'll fallback to a pure-Node AES-GCM implementation
  Fernet = null;
}
const config = require('../config');

function ensureMasterSecret() {
  const master = config.OLLAMA_KEY_ENCRYPTION_KEY || config.SESSION_SECRET || '';
  if (!master || String(master).length < 16) {
    throw new Error('OLLAMA_KEY_ENCRYPTION_KEY or SESSION_SECRET must be set and at least 16 characters long');
  }
  return String(master);
}

function deriveKey(masterSecret, userId) {
  // salt: sha256 of `ollama_key_${userId}` per Python implementation
  const salt = crypto.createHash('sha256').update(`ollama_key_${userId}`).digest();
  const key = crypto.pbkdf2Sync(Buffer.from(masterSecret, 'utf8'), salt, 100000, 32, 'sha256');
  return key; // raw Buffer
}

function encryptApiKey(apiKey, userId) {
  if (!apiKey) throw new Error('API key required');
  if (!userId) throw new Error('userId required');
  const master = ensureMasterSecret();
  if (Fernet) {
    const b64key = deriveKey(master, userId).toString('base64');
    const secret = new Fernet.Secret(b64key);
    const token = new Fernet.Token({ secret, time: Date.now() / 1000 });
    const encrypted = token.encode(apiKey);
    return Buffer.from(encrypted, 'utf8');
  }
  // Fallback: AES-256-GCM with random IV
  const key = deriveKey(master, userId); // 32 bytes
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(String(apiKey), 'utf8', 'base64');
  enc += cipher.final('base64');
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, Buffer.from(enc, 'base64')]);
  return payload;
}

function decryptApiKey(encryptedBlob, userId) {
  if (!encryptedBlob) throw new Error('Encrypted blob required');
  if (!userId) throw new Error('userId required');
  const master = ensureMasterSecret();
  if (Fernet) {
    const b64key = deriveKey(master, userId).toString('base64');
    const secret = new Fernet.Secret(b64key);
    const tokenStr = (Buffer.isBuffer(encryptedBlob)) ? encryptedBlob.toString('utf8') : String(encryptedBlob);
    const token = new Fernet.Token({ secret, token: tokenStr, ttl: 0 });
    const decrypted = token.decode();
    return decrypted;
  }
  // Fallback AES-256-GCM: first 12 bytes iv, next 16 bytes tag, rest ciphertext
  const buf = Buffer.isBuffer(encryptedBlob) ? encryptedBlob : Buffer.from(String(encryptedBlob), 'base64');
  if (buf.length < 12 + 16) throw new Error('Invalid encrypted blob');
  const key = deriveKey(master, userId);
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ciphertext = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let out = decipher.update(ciphertext, undefined, 'utf8');
  out += decipher.final('utf8');
  return out;
}

function maskApiKey(apiKey) {
  if (!apiKey || apiKey.length < 8) return '****';
  const prefix = apiKey.slice(0, 3);
  const suffix = apiKey.slice(-4);
  return `${prefix}...${suffix}`;
}

module.exports = { encryptApiKey, decryptApiKey, maskApiKey };
