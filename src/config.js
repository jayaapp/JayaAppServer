const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load environment file from ../JayaAppSecrets/environment.env if present (dotenv still used
// for backwards compatibility; secrets module will also read that file as a fallback)
const envPath = path.join(__dirname, '..', '..', 'JayaAppSecrets', 'environment.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

// Use the secrets provider abstraction for sensitive fallbacks
const secrets = require('./secrets');

function getEnv(key, defaultValue) {
  return process.env[key] !== undefined ? process.env[key] : defaultValue;
}

const FRONTEND_URLS_RAW = getEnv('FRONTEND_URL', 'http://localhost:8000');
const FRONTEND_URLS = FRONTEND_URLS_RAW.split(',').map(s => s.trim()).filter(Boolean);

const config = {
  GITHUB_CLIENT_ID: getEnv('GITHUB_CLIENT_ID', ''),
  GITHUB_CLIENT_SECRET: getEnv('GITHUB_CLIENT_SECRET', ''),
  // Prefer secrets.getSecret for sensitive values but fall back to envs (existing behavior preserved)
  SESSION_SECRET: secrets.getSecret('SESSION_SECRET') || getEnv('SESSION_SECRET', ''),
  FRONTEND_URLS,
  FRONTEND_URL: FRONTEND_URLS[0] || '',
  REDIS_SOCKET_PATH: getEnv('REDIS_SOCKET_PATH', ''),
  LOG_LEVEL: getEnv('LOG_LEVEL', 'info'),
  RATE_LIMIT_REQUESTS: parseInt(getEnv('RATE_LIMIT_REQUESTS', '60'), 10),
  RATE_LIMIT_WINDOW: parseInt(getEnv('RATE_LIMIT_WINDOW', '60'), 10),
  SECURITY_HEADERS_ENABLED: getEnv('SECURITY_HEADERS_ENABLED', 'true') === 'true',
  HSTS_MAX_AGE: parseInt(getEnv('HSTS_MAX_AGE', '31536000'), 10),
  OLLAMA_KEY_ENCRYPTION_KEY: secrets.getSecret('OLLAMA_KEY_ENCRYPTION_KEY') || getEnv('OLLAMA_KEY_ENCRYPTION_KEY', ''),
  // TrueHeart user service URL for token validation
  TRUEHEART_USER_URL: getEnv('TRUEHEART_USER_URL', 'https://trueheartapps.com/user')
};

// Optional list of additional sensitive keys (comma-separated) to be used by runtime
// for log redaction and other protections. Typically you won't set this; defaults
// are handled in code where necessary.
config.SENSITIVE_KEYS = (getEnv('SENSITIVE_KEYS', '') || '').split(',').map(s => s.trim()).filter(Boolean);


// Basic validation (do not exit in development mode)
if (!config.SESSION_SECRET) {
  console.error('[CONFIG] WARNING: SESSION_SECRET is not set. Set it in ../JayaAppSecrets/environment.env');
}
if (!config.GITHUB_CLIENT_ID || !config.GITHUB_CLIENT_SECRET) {
  console.error('[CONFIG] WARNING: GitHub OAuth credentials are not set. OAuth will not work until they are provided.');
}

module.exports = config;
