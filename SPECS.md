**JayaAppServer Technical Reference**

This document provides technical architecture details, database schema, and deployment notes for the Node.js Fastify backend. For quick start and API documentation, see [README.md](README.md). For security configuration, see [SECURE_SECRETS.md](SECURE_SECRETS.md).

## Runtime & Framework

- **Runtime**: Node.js >= `22.18.0`
- **Framework**: Fastify v4+ with official `@fastify` plugins
- **Database**: SQLite via `better-sqlite3` (native addon)
- **Session storage**: Redis (preferred) or in-memory fallback

## Repository Layout

```
JayaAppServer/
├── package.json          # npm manifest and scripts
├── src/
│   ├── index.js          # Fastify bootstrap and plugin registration
│   ├── config.js         # Configuration loader
│   ├── secrets.js        # Secrets abstraction (env/adapters)
│   ├── plugins/
│   │   ├── session.js    # Session management (Redis/in-memory)
│   │   ├── csrf.js       # CSRF token generation/validation
│   │   ├── rateLimit.js  # General rate limiting
│   │   ├── aiRateLimit.js # AI endpoint rate limiting
│   │   ├── redis.js      # Redis client management
│   │   ├── raw_body.js   # Raw body capture for webhooks
│   │   ├── authenticate.js # Authentication decorator
│   │   └── perf.js       # Performance tracking hooks
│   ├── routes/
│   │   ├── auth.js       # OAuth endpoints
│   │   └── ollama.js     # Ollama key management and proxy
│   ├── models/
│   │   ├── db.js         # SQLite connection management
│   │   ├── user.js       # User persistence
│   │   └── ollama_keys.js # Encrypted key storage
│   └── utils/
│       └── ollama_keys_encryption.js # AES-GCM encryption
├── tests/                # Test files
├── README.md             # Quick start and API docs
├── SECURE_SECRETS.md     # Security configuration
└── SPECS.md              # This file
```

## Database Schema

### users
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- GitHub user ID
  login TEXT,                    -- GitHub username
  name TEXT,                     -- Display name
  avatar_url TEXT,               -- Profile image URL
  email TEXT,                    -- Email (may be null)
  created_at INTEGER,            -- Unix timestamp
  last_login INTEGER,            -- Unix timestamp
  metadata TEXT                  -- JSON blob of full GitHub user object
);
```

### ollama_keys
```sql
CREATE TABLE ollama_keys (
  user_id TEXT PRIMARY KEY,      -- GitHub login
  api_key_encrypted BLOB NOT NULL, -- AES-GCM encrypted key
  created_at INTEGER,            -- Unix timestamp
  updated_at INTEGER,            -- Unix timestamp
  last_used_at INTEGER           -- For cleanup of stale keys
);
CREATE INDEX idx_ollama_keys_last_used ON ollama_keys(last_used_at);
```

## Session Strategy

1. **Redis (preferred)**: When `REDIS_SOCKET_PATH` or `REDIS_URL` is configured and accessible, sessions are stored in Redis with 7-day TTL.

2. **In-memory fallback**: When Redis is unavailable, sessions are stored in a JavaScript Map. Suitable for development and single-instance deployments only.

3. **Session token**: UUID v4, stored in `session_token` cookie with:
   - `HttpOnly: true`
   - `SameSite: Lax`
   - `Secure: true` (in production)
   - `Path: /`

4. **Fixed expiry**: Sessions expire 7 days after creation (not sliding).

## Encryption (Ollama Keys)

Keys are encrypted using:
- **Key derivation**: PBKDF2 with SHA-256, 100,000 iterations
- **Salt**: SHA-256 hash of `ollama_key_${userId}`
- **Encryption**: AES-256-GCM with random 12-byte IV
- **Storage format**: `IV (12 bytes) || Auth Tag (16 bytes) || Ciphertext`

The master secret is `OLLAMA_KEY_ENCRYPTION_KEY` (falls back to `SESSION_SECRET`).

## Hosting Provider Setup

For shared hosting or PaaS providers with Node.js support:

1. **Application root**: Set to the `JayaAppServer` directory (containing `package.json`)

2. **Startup file**: `src/index.js`

3. **Node version**: 22.18.0 or later

4. **Environment variables**: 
   - If provider cannot read `../JayaAppSecrets/environment.env`, copy required values to provider's environment settings
   - Required: `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `FRONTEND_URL`

5. **Build step** (if needed):
   ```bash
   npm ci --production
   ```

6. **Native modules**: `better-sqlite3` requires compilation. Either:
   - Build in CI and deploy artifacts
   - Ensure build tools on host (`build-essential`, `python3`, `libsqlite3-dev`)

## Migration: Ollama Keys from Python Server

If migrating existing Ollama keys from the Python server:

1. **Verify encryption compatibility**: Both servers use PBKDF2 + AES-GCM with same parameters. Keys encrypted by Python can be decrypted by Node.js if:
   - Same master secret (`OLLAMA_KEY_ENCRYPTION_KEY` or `SESSION_SECRET`)
   - Same user ID used as salt component

2. **Export from Python DB**:
   ```bash
   sqlite3 ollama_keys.db "SELECT user_id, hex(api_key_encrypted) FROM user_api_keys;"
   ```

3. **Import to Node.js DB**:
   ```sql
   INSERT INTO ollama_keys (user_id, api_key_encrypted, created_at, updated_at)
   VALUES (?, x'...', strftime('%s','now'), strftime('%s','now'));
   ```

4. **Verify**: Test decryption with a sample user before removing Python DB.

## Testing

Tests use Fastify's `inject()` for HTTP simulation without network overhead.

```bash
npm test
```

Key test files:
- `test_oauth.js` - OAuth flow with mocked GitHub API
- `test_db.js` - User persistence
- `test_logout_csrf.js` - CSRF protection on logout
- `test_ollama_keys.js` - Key storage/retrieval/deletion
- `test_ai_rate_limit.js` - AI endpoint rate limiting
- `test_paypal_flow.js` - Donation creation/confirmation
- `test_paypal_webhook.js` - Webhook signature verification
- `test_idempotent_concurrent_create.js` - Idempotency handling
- `test_cookie_and_csrf_attrs.js` - Cookie security attributes

## Implementation Status

| Feature | Status |
|---------|--------|
| GitHub OAuth | ✅ Complete |
| Session management (Redis + fallback) | ✅ Complete |
| CSRF protection | ✅ Complete |
| Rate limiting (general + AI) | ✅ Complete |
| User persistence | ✅ Complete |
| Donations (PayPal) | ✅ Complete |
| Donations (Stripe) | ✅ Complete |
| Webhook verification | ✅ Complete |
| Ollama key encryption | ✅ Complete |
| Ollama proxy/list-models | ✅ Complete |
| Admin endpoints | ✅ Complete |
| Crowdsourcing/analysis endpoints | ⏸️ Deferred (frontend differs) |

---

*Last updated: December 2025*
