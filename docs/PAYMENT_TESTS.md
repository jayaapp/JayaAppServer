PAYMENT TESTS
=============

This document explains how to run payment-related integration tests locally.

PayPal sandbox test
-------------------

- Prerequisites: ensure `JayaAppSecrets/environment.env` (or your environment) contains:
  - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_MODE=sandbox`.
- Run the test script:

```bash
cd /path/to/JayaAppServer
./scripts/run_paypal_sandbox.sh
```

Notes:
- The sandbox test performs a real `createOrder` call using the PayPal API and does not attempt to capture payments (payer approval is required for capture in normal flows).
- The test will skip if the required environment variables are not set.

Webhooks and replay
-------------------

- We recommend collecting real webhook payloads from the PayPal sandbox dashboard and saving them under `tests/sample_webhooks/` for replay tests. A future test runner can post them to `/webhooks/paypal` with the correct headers and validate verification via PayPal's `verify-webhook-signature` API.

Replay test (included)
----------------------

- A sample webhook payload for a capture-completed event is included at `tests/sample_webhooks/paypal_capture_completed.json`.
- Run the replay test (mocked verification by default):

```bash
cd /path/to/JayaAppServer
./scripts/replay_webhook.sh
```

- To run the replay test against PayPal's verification API (requires `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` and `PAYPAL_MODE` set), set `RUN_PAYPAL_VERIFY_LIVE=1` in your environment before running the script.

Stripe webhook replay
---------------------

- A sample Stripe webhook payload for `payment_intent.succeeded` is included at `tests/sample_webhooks/stripe_payment_intent_succeeded.json`.
- Run the replay script (mocked verification by default):

```bash
cd /path/to/JayaAppServer
node tests/test_stripe_webhook_replay.js
```

- To enable live verification against Stripe's signing secret, set `RUN_STRIPE_VERIFY_LIVE=1` and ensure `STRIPE_WEBHOOK_SECRET` is set in your env.

Stripe sandbox runtime
----------------------

- If you have Stripe test keys in `JayaAppSecrets/environment.env` (or env vars), you can run a short runtime test that creates a real PaymentIntent in Stripe's test mode.

```bash
cd /path/to/JayaAppServer
./scripts/run_stripe_sandbox.sh
```

The script will skip if `STRIPE_SECRET_KEY` is not set.


