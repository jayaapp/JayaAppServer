JayaApp Server (Fastify)
=========================

This folder contains a Fastify-based backend for JayaApp, providing OAuth authentication and Ollama API key management in Node.js.

## Quick Start (Development)

1. Ensure `../JayaAppSecrets/environment.env` exists with required variables (see [SECRETS.md](SECRETS.md) for details).

2. Install dependencies:
   ```bash
   cd JayaAppServer
   npm install
   ```

3. Start server:
   ```bash
   npm run dev
   ```

4. Run tests:
   ```bash
   npm test
   ```

The server listens on port `3000` by default. Verify with `curl http://localhost:3000/health`.

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/login` | Get GitHub authorization URL (or redirect with `?redirect=true`) |
| GET | `/auth/callback` | OAuth callback — creates session, sets `session_token` cookie |
| GET | `/auth/user` | Returns logged-in user info and CSRF token |
| POST | `/auth/logout` | Clears session (requires CSRF token) |

### Ollama API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ollama/store-key` | Store encrypted Ollama API key |
| GET | `/api/ollama/get-key` | Retrieve decrypted API key |
| GET | `/api/ollama/check-key` | Check if user has stored key (returns masked version) |
| DELETE | `/api/ollama/delete-key` | Delete stored API key |
| POST | `/api/ollama/proxy-chat` | Proxy chat requests to Ollama cloud |
| GET | `/api/ollama/list-models` | List available Ollama models |

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Signs session tokens and CSRF tokens (min 32 chars) |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret |
| `FRONTEND_URL` | Comma-separated list of allowed frontend origins |

### Optional

| Variable | Description |
|----------|-------------|
| `JAYAAPP_DB_PATH` | Path to SQLite DB file (default: `./jayaapp_server.db`) |
| `REDIS_SOCKET_PATH` or `REDIS_URL` | Redis connection for sessions/rate-limiting |
| `OLLAMA_KEY_ENCRYPTION_KEY` | Encrypts Ollama keys (falls back to `SESSION_SECRET`) |

For complete configuration reference, see [SECRETS.md](SECRETS.md).

## Security

- **Sessions**: Uses Redis when available, falls back to in-memory (single-instance only).
- **CSRF**: State-changing endpoints require `X-CSRF-Token` header.
- **Rate limiting**: Configurable per-IP limits for general and AI endpoints.

For detailed security configuration and production recommendations, see [SECRETS.md](SECRETS.md).

## Deployment Notes (Native Modules)

This project uses `better-sqlite3`, a native Node addon.

### Recommended Approaches

1. **Build in CI**: Run `npm ci --production` in your CI/build pipeline (or Docker image matching production OS/Node). Deploy the resulting artifact.

2. **Build on target host**: Ensure build tools are present:
   ```bash
   # Debian/Ubuntu
   sudo apt update
   sudo apt install -y build-essential python3 pkg-config libsqlite3-dev
   npm install --build-from-source better-sqlite3
   ```

3. **Docker**: Build and run in a container matching your production environment.

## Project Structure

```
src/
├── index.js          # Server entry point
├── config.js         # Configuration loader
├── secrets.js        # Secrets abstraction (env/provider)
├── plugins/          # Fastify plugins (session, csrf, rate-limit, etc.)
├── routes/           # Route handlers (auth, ollama)
├── models/           # Database models (user, ollama_keys)
└── utils/            # Utilities (encryption)
tests/                # Test files
```
