**Secure Secrets: usage and migration**

This document describes the lightweight secrets abstraction used by the server and recommended deployment practices.

## Overview

- The server prefers environment variables (`process.env`) for secrets.
- As a convenience during local development, the repository may contain `JayaAppSecrets/environment.env`. Avoid committing secrets into git.
- A pluggable adapter interface allows integrating a secrets provider (AWS Secrets Manager, Vault, etc.) later without widespread code changes. Set `SECRETS_PROVIDER` to the adapter name to enable.

## Required Secrets

The following secrets are required for full functionality:

| Variable | Purpose | Required |
|----------|---------|----------|
| `SESSION_SECRET` | Signs session tokens and CSRF tokens. Must be at least 32 characters. | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | Yes (for auth) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | Yes (for auth) |
| `OLLAMA_KEY_ENCRYPTION_KEY` | Encrypts user Ollama API keys at rest. Falls back to `SESSION_SECRET` if not set. | Recommended |

## Generating Secure Keys

### SESSION_SECRET / OLLAMA_KEY_ENCRYPTION_KEY

Generate a cryptographically secure random key (64 hex characters = 256 bits):

```bash
# Using openssl (recommended)
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Using /dev/urandom on Linux/macOS
head -c 32 /dev/urandom | xxd -p -c 64
```

## Adapters

- `aws` — uses `@aws-sdk/client-secrets-manager` when installed. To enable:
  - `npm install @aws-sdk/client-secrets-manager`
  - Set `SECRETS_PROVIDER=aws` and provide AWS credentials via standard env vars (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION).

- `vault` — attempts to use `node-vault` when installed. To enable:
  - `npm install node-vault`
  - Set `SECRETS_PROVIDER=vault` and `VAULT_ADDR`, `VAULT_TOKEN`.

## How the `secrets` module resolves values

1. `process.env[KEY]` (highest priority)
2. Provider adapter `getSecret(KEY)` if `SECRETS_PROVIDER` is configured and adapter initialized
3. Fallback to parsed `JayaAppSecrets/environment.env` file (if present)

## Recommended actions before production

1. Remove `JayaAppSecrets/environment.env` from the repository and add it to `.gitignore`.
2. Rotate any credentials that were exposed in the file.
3. Store secrets in your deployment platform (e.g., GitHub Actions Secrets, host env vars, or a secrets manager).
4. Set a dedicated `OLLAMA_KEY_ENCRYPTION_KEY` (do not reuse `SESSION_SECRET`).
5. Use `ADMIN_API_KEY_HASH` (SHA-256 hex) instead of `ADMIN_API_KEY` where possible.
6. Set `ENVIRONMENT=production` to enable production-mode behaviors.

## Environment Variables Reference

### Core Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `development` | Set to `production` for live deployment |
| `PORT` | `3000` | Server listening port |
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `FRONTEND_URL` | `http://localhost:8000` | Comma-separated list of allowed frontend origins for CORS |

### Redis (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_SOCKET_PATH` | — | Unix socket path for Redis connection |
| `REDIS_URL` | — | Alternative: Redis connection URL |

If neither is set, the server uses in-memory session storage (suitable for single-instance deployments).

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_REQUESTS` | `60` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW` | `60` | Window size in seconds |

### Security Headers

| Variable | Default | Description |
|----------|---------|-------------|
| `SECURITY_HEADERS_ENABLED` | `true` | Enable security headers (helmet) |
| `HSTS_MAX_AGE` | `31536000` | HSTS max-age in seconds (1 year) |

### Donations

| Variable | Default | Description |
|----------|---------|-------------|
| `DONATION_CHECKOUT_PROVIDER` | `PAYPAL` | Payment provider: `PAYPAL` or `STRIPE` |
| `DONATION_MIN_AMOUNT` | `1` | Minimum donation amount in USD |
| `DONATION_MAX_AMOUNT` | `10000` | Maximum donation amount in USD |
| `PAYPAL_MODE` | `sandbox` | PayPal environment: `sandbox` or `live` |

## Usage examples

Programmatic init (optional):
```js
const secrets = require('./src/secrets');
await secrets.initProvider('aws', { /* options */ });
const dbKey = await secrets.getSecret('SESSION_SECRET');
```

## Additional Security Recommendations

1. **Use HTTPS in production** — The server sets `secure: true` on cookies when `NODE_ENV=production`.

2. **Database file permissions** — Ensure `jayaapp_server.db` has restricted permissions (chmod 600).

3. **Monitor logs** — Security events are logged with `[SECURITY]` prefix for easy filtering.

4. **Rotate secrets periodically** — Especially after any suspected exposure.

5. **Use separate credentials per environment** — Don't share secrets between development, staging, and production.

---

If you want, I can:
- Add CI checks to detect `JayaAppSecrets/environment.env` in commits.
- Implement an adapter for a specific provider (AWS/GCP/Azure) and wire it to startup.
- Add a startup production-mode check to fail if obvious secrets are missing.
