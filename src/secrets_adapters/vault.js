/*
 * Optional HashiCorp Vault adapter stub.
 * This adapter does not add a Vault client dependency by default; it attempts to
 * require a 'node-vault' or similar package if available. If absent, it will
 * provide a helpful error when used.
 */

async function init(opts = {}) {
  try {
    // eslint-disable-next-line global-require
    const vault = require('node-vault');
    const endpoint = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
    const token = process.env.VAULT_TOKEN || '';
    const client = vault({ endpoint, token });
    return {
      getSecret: async (key) => {
        if (!key) return null;
        try {
          const mount = process.env.VAULT_MOUNT || 'secret';
          const path = `${mount}/${key}`;
          const res = await client.read(path);
          if (res && res.data) return res.data.value || res.data;
          return null;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('vault adapter getSecret error', e && e.message ? e.message : e);
          return null;
        }
      }
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Vault adapter requested but `node-vault` is not installed. Install it or unset SECRETS_PROVIDER.');
    return {
      getSecret: async () => { throw new Error('Vault adapter requires `node-vault`. Install it to use this feature.'); }
    };
  }
}

module.exports = { init };
