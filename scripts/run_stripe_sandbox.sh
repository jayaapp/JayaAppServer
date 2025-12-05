#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Running Stripe sandbox test (NODE_ENV=test)"
NODE_ENV=test node tests/test_stripe_sandbox.js
