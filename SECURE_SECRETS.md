**Secure Secrets: usage and migration**

This document describes the lightweight secrets abstraction used by the server and recommended deployment practices.

Overview
- The server prefers environment variables (`process.env`) for secrets.
- As a convenience during local development, the repository may contain `JayaAppSecrets/environment.env`. Avoid committing secrets into git.
- A pluggable adapter interface allows integrating a secrets provider (AWS Secrets Manager, Vault, etc.) later without widespread code changes. Set `SECRETS_PROVIDER` to the adapter name to enable.

Adapters
- `aws` — uses `@aws-sdk/client-secrets-manager` when installed. To enable:
  - `npm install @aws-sdk/client-secrets-manager`
  - Set `SECRETS_PROVIDER=aws` and provide AWS credentials via standard env vars (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION).

- `vault` — attempts to use `node-vault` when installed. To enable:
  - `npm install node-vault`
  - Set `SECRETS_PROVIDER=vault` and `VAULT_ADDR`, `VAULT_TOKEN`.

How the `secrets` module resolves values
1. `process.env[KEY]` (highest priority)
2. Provider adapter `getSecret(KEY)` if `SECRETS_PROVIDER` is configured and adapter initialized
3. Fallback to parsed `JayaAppSecrets/environment.env` file (if present)

Recommended actions before production
1. Remove `JayaAppSecrets/environment.env` from the repository and add it to `.gitignore`.
2. Rotate any credentials that were exposed in the file.
3. Store secrets in your deployment platform (e.g., GitHub Actions Secrets, host env vars, or a secrets manager).
4. Set a dedicated `OLLAMA_KEY_ENCRYPTION_KEY` (do not reuse `SESSION_SECRET`).
5. Use `ADMIN_API_KEY_HASH` (SHA-256 hex) instead of `ADMIN_API_KEY` where possible.

Usage examples
- Programmatic init (optional):
```js
const secrets = require('./src/secrets');
await secrets.initProvider('aws', { /* options */ });
const dbKey = await secrets.getSecret('SESSION_SECRET');
```

If you want, I can:
- Add CI checks to detect `JayaAppSecrets/environment.env` in commits.
- Implement an adapter for a specific provider (AWS/GCP/Azure) and wire it to startup.
- Add a startup production-mode check to fail if obvious secrets are missing.
