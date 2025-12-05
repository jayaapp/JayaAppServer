const fs = require('fs');
const path = require('path');

// Pluggable secrets provider abstraction.
// Behavior:
// - Prefer environment variables (process.env)
// - Optionally consult a provider adapter (AWS Secrets Manager, Vault, etc.) if configured
// - Fallback to a repo-level `JayaAppSecrets/environment.env` file

const secrets = {
  _fileMap: {},
  _adapter: null,

  // Load a dotenv-style file (KEY=VALUE per line) into internal map
  loadEnvFile(filePath) {
    try {
      if (!filePath) return;
      const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(abs)) return;
      const raw = fs.readFileSync(abs, { encoding: 'utf8' });
      const lines = raw.split(/\r?\n/);
      lines.forEach(l => {
        const line = l.trim();
        if (!line || line.startsWith('#')) return;
        const eq = line.indexOf('=');
        if (eq === -1) return;
        const k = line.slice(0, eq).trim();
        let v = line.slice(eq + 1).trim();
        // Strip surrounding quotes if present
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (k) secrets._fileMap[k] = v;
      });
    } catch (e) {
      // Do not throw; secrets loader is a convenience. Log only in debug scenarios.
      // eslint-disable-next-line no-console
      console.warn('secrets.loadEnvFile failed', e && e.message ? e.message : e);
    }
  },

  // Initialize: try to auto-load ../JayaAppSecrets/environment.env (repo layout)
  initAuto() {
    try {
      const candidate = path.join(__dirname, '..', '..', 'JayaAppSecrets', 'environment.env');
      this.loadEnvFile(candidate);
    } catch (e) {
      // ignore
    }
    // Also allow provider adapter to be initialized from env
    this._initProviderFromEnv();
  },

  // Internal: initialize an adapter if SECRETS_PROVIDER is set
  _initProviderFromEnv() {
    const provider = process.env.SECRETS_PROVIDER || null;
    if (!provider) return;
    try {
      // adapter modules are under ./secrets_adapters/<provider>.js
      // they should export an async `init(opts)` and `getSecret(key)` functions
      // attempt to require the adapter; if not present, leave adapter null and warn
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(path.join(__dirname, 'secrets_adapters', provider));
      if (mod && typeof mod.init === 'function') {
        const opts = {
          // allow passing provider-specific options via env var prefix
          prefix: `SECRETS_${provider.toUpperCase()}_`
        };
        // init may be async; call and store adapter object
        const maybe = mod.init(opts);
        if (maybe && typeof maybe.then === 'function') {
          // async init
          maybe.then((adapter) => { this._adapter = adapter; }).catch((e) => {
            // eslint-disable-next-line no-console
            console.warn('secrets: adapter init failed for', provider, e && e.message ? e.message : e);
          });
        } else {
          this._adapter = maybe;
        }
      }
    } catch (e) {
      // Adapter not installed or failed to load — don't throw, just warn.
      // eslint-disable-next-line no-console
      console.warn('secrets: failed to load adapter', provider, e && e.message ? e.message : e);
    }
  },

  // Optionally initialize programmatically with provider name and options
  async initProvider(providerName, opts = {}) {
    if (!providerName) return;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(path.join(__dirname, 'secrets_adapters', providerName));
      if (mod && typeof mod.init === 'function') {
        const adapter = await mod.init(opts);
        this._adapter = adapter;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('secrets.initProvider failed', providerName, e && e.message ? e.message : e);
    }
  },

  // Get secret value by key. Priority:
  // 1) process.env
  // 2) provider adapter (if initialized) via adapter.getSecret(key)
  // 3) loaded env file map
  async getSecret(key) {
    if (!key) return null;
    if (process.env[key] !== undefined && process.env[key] !== '') return process.env[key];
    // provider adapter may expose sync or async getSecret
    if (this._adapter && typeof this._adapter.getSecret === 'function') {
      try {
        const val = this._adapter.getSecret(key);
        if (val && typeof val.then === 'function') return await val;
        if (val !== undefined && val !== null && String(val) !== '') return val;
      } catch (e) {
        // adapter error — warn and continue to file fallback
        // eslint-disable-next-line no-console
        console.warn('secrets.adapter.getSecret error for', key, e && e.message ? e.message : e);
      }
    }
    if (this._fileMap && Object.prototype.hasOwnProperty.call(this._fileMap, key)) return this._fileMap[key];
    return null;
  }
};

// Auto-init on require
secrets.initAuto();

module.exports = secrets;
