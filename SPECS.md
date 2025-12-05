**JayaAppServer Specs**

**Purpose**: Provide a concise design and reference for the Node.js Fastify backend that replaces the original Python WSGI server. This file captures architecture, API surface, data model, environment variables, security considerations, operational notes, and migration guidance (including the Ollama key migration which is deferred until Ollama work).

**Runtime & Framework**:
- **Runtime**: Node.js (target >= `22.18.0`).
- **Framework**: Fastify (v4+). Use official `@fastify` plugins where available.

**Repository Layout (key paths)**
- **`package.json`**: npm manifest and scripts.
- **`src/index.js`**: Fastify bootstrap and plugin registration (app startup file for provider panel).
- **`src/config.js`**: Loads `../JayaAppSecrets/environment.env` (fallback to local `.env`) and normalizes configuration values.
- **`src/plugins/`**: Fastify plugins (e.g. `session.js`).
- **`src/routes/`**: Route definitions (e.g. `auth.js`).
- **`src/models/`**: DB layer and models (e.g. `db.js`, `user.js`).
- **`tests/`**: Minimal tests using Fastify's inject for the OAuth flow.
- **`SPECS.md`**: This document.

**High-Level Architecture**
- **API server**: Fastify app exposing REST endpoints for authentication, user info, donations, webhook receivers, and Ollama key management.
- **Session storage**: Primary: Redis (Unix socket or URL) when available; fallback: in-memory store for development. Plugin uses lazy connect and skips Redis if socket missing (dev-friendly).
- **Database**: SQLite by default (local file) for persistent entities (users, sponsorships, progress, GitHub issues). Implementation uses a pluggable approach so devs can use WASM SQLite (`sql.js`) locally if native bindings not available.
- **Payments**: PayPal (sandbox/live) and Stripe integration via respective SDKs; webhooks are verified by provider signatures.
- **Ollama key management**: Encrypted per-user API key storage (AES-GCM recommended). Migration of existing keys from Python storage deferred to Ollama module implementation.

**Primary API Surface (initial focus)**
- **Auth**
  - `GET /auth/login` — returns GitHub authorization URL and `state` or redirects (`?redirect=true`).
  - `GET /auth/callback` — OAuth callback; exchanges code for access token, fetches GitHub profile, persists user, creates session, sets secure cookie `session_token`.
  - `GET /auth/user` — returns current user, requires session cookie.
  - `POST /auth/logout` — invalidates session and clears cookie.

- **Donations (planned)**
  - `POST /donations/create` — create sponsorship and return payment order info.
  - `POST /donations/confirm` — confirm capture after payment provider callback.
  - `GET /donations/status/:id` — sponsorship status.

- **Webhooks**
  - `POST /webhooks/paypal` — PayPal notifications, verified using `PAYPAL_WEBHOOK_ID` + SDK.
  - `POST /webhooks/stripe` — Stripe signature verification using `STRIPE_WEBHOOK_SECRET`.

- **Ollama Keys**
  - `POST /api/ollama/store-key` — store encrypted key for authenticated user.
  - `GET /api/ollama/check-key` — whether user has a key (return masked key if present).
  - `GET /api/ollama/get-key` — return decrypted key (restricted and rate-limited).
  - `DELETE /api/ollama/delete-key` — delete key for user.

  - `POST /api/ollama/proxy-chat` — proxy endpoint for chat requests to Ollama models (used by frontend at `/api/ollama/proxy-chat`).
  - `GET /api/ollama/list-models` — list available Ollama models (used by frontend settings UI).


**Data Model (core tables)**
- **`users`**: `id TEXT PK`, `login`, `name`, `avatar_url`, `email`, `created_at`, `last_login`, `metadata JSON`.
- **`sponsorships`**: id, user_id, sponsor_type, target_identifier, amount_usd, currency, payment_provider, payment_provider_order_id, payment_provider_capture_id, message, status, created_at, completed_at, idempotency_key.
- **`language_progress`**, **`analysis_progress`**, **`github_issues`**: as used by donation DB (kept compatible with Python schema for future sync).
- **`ollama_keys`** (planned): `user_id`, `encrypted_key`, `nonce`, `updated_at` (migration-only target).

**Session Strategy**
- By default, the plugin attempts to connect to Redis when `REDIS_SOCKET_PATH` or `REDIS_URL` is configured and the socket file exists. Connection is lazy; failures fall back to in-memory sessions.
- Sessions are represented as UUID tokens stored in Redis with TTL (7 days) or in memory with expiration.
- Cookie: `session_token`, `HttpOnly`, `SameSite=Lax`, `Secure` in production.

**Configuration & Environment**
- Primary env file location: `../JayaAppSecrets/environment.env` (loaded by `src/config.js`).
- Key variables (must be set in production):
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
  - `SESSION_SECRET` (cookie signing / HMAC secrets)
  - `FRONTEND_URL` (comma-separated origins)
  - `REDIS_SOCKET_PATH` or `REDIS_URL` (optional)
  - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`, `PAYPAL_WEBHOOK_ID`
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - `OLLAMA_KEY_ENCRYPTION_KEY` (32-byte base64/hex) — used when Ollama module implemented
  - `LOG_LEVEL`, `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW`, `SECURITY_HEADERS_ENABLED`, `HSTS_MAX_AGE`

**Security Considerations**
- Enforce HTTPS in production and set HSTS based on `HSTS_MAX_AGE`.
- Use `fastify-helmet` for security headers when `SECURITY_HEADERS_ENABLED`.
- CORS restricted to `FRONTEND_URLS` loaded from env.
- CSRF protection: HMAC-style tokens tied to session; require `X-CSRF-Token` header for state-changing requests.
- Webhook verification: verify signatures for PayPal/Stripe webhooks using provider secrets.
- Ollama keys: encrypt at rest with dedicated key; never log raw keys.

**Testing & Dev Notes**
- Tests use Fastify `inject` to simulate requests; the OAuth test mocks GitHub API responses via a global `fetch` mock.
- The session plugin is resilient: it does not fail tests when deployment Redis socket path exists in env but is not present locally — it checks for the socket file and skips Redis if missing.
- Native modules: `better-sqlite3` is a native addon and may require system build tools on local dev; the project supports using an in-memory/`sql.js` fallback approach if native compilation is not possible in dev.

**Migration notes**
- Only one migration is required from the Python server for the rewrite: **Ollama keys**. All other data can be kept or recreated; donation and user data migration is optional and can be performed later.
- Ollama migration plan (deferred until Ollama module):
  1. Inspect Python `ollama_keys_database.py` / `ollama_keys_encryption.py` to identify storage and encryption scheme.
 2. Export keys and decrypt using the same secret (if encrypted with `SESSION_SECRET` or other key).
 3. Re-encrypt keys using `OLLAMA_KEY_ENCRYPTION_KEY` (AES-GCM) and insert into Node DB `ollama_keys` table.
 4. Verify migration with sample decrypt checks and remove old copies after validation.

**Operational / Provider panel notes**
- Set `Application root` to the directory containing `package.json` (e.g. the `JayaAppServer` folder). Set `Application startup file` to `src/index.js`.
- Ensure env variables from `../JayaAppSecrets/environment.env` are available to the process (provider must allow referencing parent path or each key must be set in provider UI). If the provider cannot read relative files, copy required env values into the provider settings.
- Use Node `22.18.0` (provider recommended). If you build assets or use TypeScript, ensure `start` points to compiled JS (`dist/index.js`).

**Roadmap / Next Milestones**
- Implement persistent user storage (done in DB model); verify production SQLite vs dev fallback.
- Implement CSRF tokens and rate-limiting.
- Implement donation flow + payment SDKs + webhooks.
- Implement Ollama key management and migration script.
- Add monitoring (`/metrics` Prometheus) + structured logs (pino) + performance analytics persistence if needed.

**Contact / Debugging Tips**
- To run locally:
  - `cd JayaAppServer && npm install`
  - `npm run dev` (or `npm start`)
  - Set `NODE_ENV=development` and ensure `../JayaAppSecrets/environment.env` exists.
- To run tests:
  - `npm test` (the test suite uses mocked GitHub calls and an in-memory session fallback).

**Change Log**
- This document tracks decisions and will be updated as the rewrite progresses. Keep this file next to `README.md` in `JayaAppServer/`.
