#!/usr/bin/env bash
set -euo pipefail

# Run the PayPal sandbox integration test. Requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET
cd "$(dirname "$0")/.."
echo "Running PayPal sandbox test (NODE_ENV=test)"
NODE_ENV=test node tests/test_paypal_sandbox.js
