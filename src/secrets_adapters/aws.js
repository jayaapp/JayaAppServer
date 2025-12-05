/*
 * Optional AWS Secrets Manager adapter.
 * This adapter is intentionally optional: it will try to require the AWS SDK at runtime.
 * If the SDK is not installed, `init` resolves to a lightweight adapter that throws
 * a helpful error when used.
 */

const DEFAULT_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

async function init(opts = {}) {
  // Try to dynamically load AWS SDK v3 client for Secrets Manager
  try {
    // Use dynamic import to avoid adding a hard dependency
    // eslint-disable-next-line global-require
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    const region = process.env.AWS_REGION || DEFAULT_REGION;
    const client = new SecretsManagerClient({ region });

    return {
      getSecret: async (key) => {
        if (!key) return null;
        try {
          const name = process.env[`SECRETS_AWS_NAME`] || key;
          const cmd = new GetSecretValueCommand({ SecretId: name });
          const res = await client.send(cmd);
          if (res && res.SecretString) return res.SecretString;
          if (res && res.SecretBinary) return Buffer.from(res.SecretBinary).toString('utf8');
          return null;
        } catch (e) {
          // not found or access denied
          // eslint-disable-next-line no-console
          console.warn('aws-secrets adapter getSecret error', e && e.message ? e.message : e);
          return null;
        }
      }
    };
  } catch (e) {
    // SDK not installed — return adapter that errors with helpful message when used
    // eslint-disable-next-line no-console
    console.warn('AWS Secrets Manager adapter was requested but @aws-sdk/client-secrets-manager is not installed. Install it or unset SECRETS_PROVIDER.');
    return {
      getSecret: async () => { throw new Error('AWS Secrets Manager adapter requires @aws-sdk/client-secrets-manager. Install it to use this feature.'); }
    };
  }
}

module.exports = { init };
