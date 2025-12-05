JayaApp Server (Fastify)
=========================

This folder contains a minimal Fastify-based backend for JayaApp. The goal is to replicate the Python server's functionality (OAuth, donations, Ollama keys) in Node.js and to iterate incrementally.

Quick start (development)

1. Ensure `../JayaAppSecrets/environment.env` exists and contains required env variables (see example below).
2. Install dependencies:

```bash
cd JayaAppServer
npm install
```

3. Start server:

```bash
npm run dev
```

The server listens on port `3000` by default and exposes a `/health` endpoint.

Environment

- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`
- `FRONTEND_URL` (comma-separated list)
- Other variables are read from `../JayaAppSecrets/environment.env` if present.

Important environment variables

- `JAYAAPP_DB_PATH` — optional path to SQLite DB file (tests set this to a tmp file).
- `SESSION_SECRET` — HMAC/secret used for session cookies and encryption fallbacks.
- `REDIS_URL` or `REDIS_SOCKET_PATH` — when set, the Redis plugin will attempt to connect and sessions/rate-limiting will use Redis. Absent Redis, an in-memory fallback is used (suitable for local dev and tests only).
- `ADMIN_API_KEY` — admin header value expected by `/admin` endpoints. Alternatively `ADMIN_API_KEY_HASH` may contain the SHA256(hex) of the key to avoid storing plaintext in env.
- `OLLAMA_KEY_ENCRYPTION_KEY` — master secret used to encrypt Ollama API keys at rest. If not provided, `SESSION_SECRET` is used as a fallback (not recommended for production).
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe API key and webhook signing secret. `STRIPE_WEBHOOK_SECRET` is required for webhook signature verification.
- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MODE` — PayPal credentials and webhook id. `PAYPAL_MODE` may be `sandbox` or `live`.

Security and webhooks

- Webhook signature verification is enforced for Stripe and PayPal. Ensure `STRIPE_WEBHOOK_SECRET` and `PAYPAL_WEBHOOK_ID` (and PayPal credentials) are configured in production so webhook handlers can verify requests.
- The server expects raw request bodies for webhook verification. Do not place additional middleware that transforms the body before the server (or ensure the raw body is preserved).
- Avoid leaking sensitive values in logs (webhook payloads, secrets, full API keys). Rotate keys periodically and use a secrets manager when possible.

OAuth endpoints

- `GET /auth/login` — get a GitHub authorization URL (or redirect with `?redirect=true`).
- `GET /auth/callback` — OAuth callback. Creates a session and sets `session_token` cookie.
- `GET /auth/user` — returns the logged-in user (requires session cookie).
- `POST /auth/logout` — clears the session.

Notes

- This scaffold uses a simple in-memory session store for development. For production, configure Redis and replace the session plugin.
- Ollama key migration will be implemented later and is deferred until the Ollama module is built.

Admin API Key
--------------

The server exposes admin endpoints (for example the reconciliation and CSV export endpoints under `/admin`) that can be protected with an `ADMIN_API_KEY`.

- `ADMIN_API_KEY` is not present by default in the example `../JayaAppSecrets/environment.env` attachment. Add it there or set it in your environment to enable admin-key protection.
- The server expects the key to be supplied as an HTTP header named `x-admin-key` when calling protected endpoints.

Generation and example
----------------------

Generate a strong random token (recommended: 32 bytes or more). Examples:

```bash
# 32 bytes, hex (64 chars)
openssl rand -hex 32

# 32 bytes, base64 (readable, ~43 chars)
openssl rand -base64 32

# Node.js one-liner (hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then add the token to `../JayaAppSecrets/environment.env` (do NOT commit this file to git):

```
ADMIN_API_KEY=your_generated_token_here
```

Security recommendations
------------------------

- Store the key in a secure secrets manager (Vault, cloud secret manager, or CI secrets) where possible.
- If you keep it in `environment.env`, protect the file with filesystem permissions (`chmod 600`) and avoid committing it to source control.
- Rotate the key periodically and consider allowing a short overlap window when rolling to a new key.
- Log and rate-limit admin endpoints to detect and mitigate brute-force or misuse attempts.
- For stronger handling, you can store a hash/HMAC of the key server-side and compare hashes instead of keeping plaintext in the environment (requires a small code change).

Usage example
-------------

Call the CSV export endpoint with the admin header:

```bash
curl -H "x-admin-key: $ADMIN_API_KEY" \
	"http://localhost:3000/admin/donations/sponsorships.csv?status=completed" \
	-o sponsorships.csv
```

If `ADMIN_API_KEY` is not set the admin endpoints are not protected by the header check in development, but it's recommended to configure a key before deploying to any shared environment.

Deployment notes (native modules)
 - This project uses `better-sqlite3`, a native Node addon. In many environments the package provides prebuilt binaries for common Node versions and platforms. If a prebuilt binary is not available for your Node ABI, npm will attempt to compile from source.
 - Preferred deployment approaches:
	 - Build artifacts in CI: run `npm ci --production` in your CI/build pipeline (or in a Docker image matching your production OS/Node). Package the resulting image/artifact and deploy that. This avoids needing build tools on the target host.
	 - If you must install on the target host, ensure system build tools and SQLite headers are present (Debian/Ubuntu example):
		 ```bash
		 sudo apt update
		 sudo apt install -y build-essential python3 pkg-config libsqlite3-dev
		 npm install --build-from-source better-sqlite3
		 ```
	 - You can also build prebuilt binaries on a compatible host and host them behind an HTTP mirror; use `npm_config_binary_host_mirror` to point the installer to your mirror.
 - If you want to avoid native modules in development, consider running the app inside the same Docker image used for production, or enable a JS fallback (not implemented by default).
