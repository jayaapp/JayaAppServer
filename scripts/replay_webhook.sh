#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Replaying sample PayPal webhook (mocked verification by default). Set RUN_PAYPAL_VERIFY_LIVE=1 to verify against PayPal API."
RUN_PAYPAL_VERIFY_LIVE=${RUN_PAYPAL_VERIFY_LIVE:-0}
RUN_PAYPAL_VERIFY_LIVE=$RUN_PAYPAL_VERIFY_LIVE NODE_ENV=test node tests/test_paypal_webhook_replay.js
