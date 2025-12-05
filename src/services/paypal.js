const config = require('../config');

async function getAccessToken() {
  const clientId = config.PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID;
  const clientSecret = config.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_CLIENT_SECRET;
  const mode = config.PAYPAL_MODE || 'sandbox';
  const apiBase = mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    timeout: 30000
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal token error: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

function getApiBase() {
  const mode = config.PAYPAL_MODE || 'sandbox';
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function createOrder({ amount, currency = 'USD', description = 'JayaApp Sponsorship', custom_id = null }) {
  const token = await getAccessToken();
  const apiBase = getApiBase();
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [{ amount: { currency_code: currency, value: Number(amount).toFixed(2) }, description }]
  };
  if (custom_id) payload.purchase_units[0].custom_id = custom_id;

  const res = await fetch(`${apiBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 30000
  });
  const text = await res.text();
  if (res.status === 201) {
    return JSON.parse(text);
  }
  throw new Error(`PayPal createOrder failed: ${res.status} ${text}`);
}

async function captureOrder(orderId) {
  const token = await getAccessToken();
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    timeout: 30000
  });
  const text = await res.text();
  if (res.status === 201) return JSON.parse(text);
  throw new Error(`PayPal captureOrder failed: ${res.status} ${text}`);
}

async function verifyWebhookSignature(headers, bodyRaw) {
  // Use PayPal verify webhook signature API
  const token = await getAccessToken();
  const apiBase = getApiBase();
  const webhookId = config.PAYPAL_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new Error('PAYPAL_WEBHOOK_ID not configured');
  }

  const verificationPayload = {
    transmission_id: headers['paypal-transmission-id'] || headers['PAYPAL-TRANSMISSION-ID'] || headers['Paypal-Transmission-Id'],
    transmission_time: headers['paypal-transmission-time'] || headers['PAYPAL-TRANSMISSION-TIME'] || headers['Paypal-Transmission-Time'],
    cert_url: headers['paypal-cert-url'] || headers['PAYPAL-CERT-URL'] || headers['Paypal-Cert-Url'],
    auth_algo: headers['paypal-auth-algo'] || headers['PAYPAL-AUTH-ALGO'] || headers['Paypal-Auth-Algo'],
    transmission_sig: headers['paypal-transmission-sig'] || headers['PAYPAL-TRANSMISSION-SIG'] || headers['Paypal-Transmission-Sig'],
    webhook_id: webhookId,
    webhook_event: JSON.parse(bodyRaw.toString('utf8'))
  };

  const res = await fetch(`${apiBase}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(verificationPayload),
    timeout: 30000
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PayPal webhook verify API failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.verification_status === 'SUCCESS';
}

module.exports = { createOrder, captureOrder, verifyWebhookSignature };
