#!/usr/bin/env bash
set -euo pipefail

# Comprehensive local Redis test script for JayaAppServer
# - flushes Redis
# - runs the test suite with REDIS_URL
# - runs the AI limiter test
# - inspects Redis keys created by the plugins

REDIS_URL_DEFAULT="redis://127.0.0.1:6379"
REDIS_URL="${REDIS_URL:-$REDIS_URL_DEFAULT}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Using REDIS_URL=$REDIS_URL"

# Ensure redis-cli exists
if ! command -v redis-cli >/dev/null 2>&1; then
  echo "redis-cli not found in PATH; please install redis-tools or ensure redis-cli is available"
  exit 2
fi

echo "Running npm test with REDIS_URL and cleared REDIS_SOCKET_PATH..."
echo "Running AI limiter test standalone..."
echo "Inspecting Redis keys..."
echo "AI keys (pattern ai:*)"
echo "Rate limiter keys (pattern rl:*)"
echo "Session keys (pattern session:*)"
echo "Flushing Redis (FLUSHALL) -> this will remove all keys from the connected Redis instance"
redis-cli -u "$REDIS_URL" FLUSHALL

LOGDIR="tmp/redis-test-$(date +%s)"
mkdir -p "$LOGDIR"

TEST_FILES=(
  "tests/test_oauth.js"
  "tests/test_db.js"
  "tests/test_logout_csrf.js"
  "tests/test_ollama_keys.js"
  "tests/test_ai_rate_limit.js"
)

for tf in "${TEST_FILES[@]}"; do
  echo "\n=== Running $tf with Redis URL $REDIS_URL ==="
  LOGFILE="$LOGDIR/$(basename $tf).log"
  # ensure clean Redis state per test
  redis-cli -u "$REDIS_URL" FLUSHALL

  # run the test in a separate process so globals don't leak
  # use an isolated SQLite DB per test to avoid cross-test pollution
  export JAYAAPP_DB_PATH="$LOGDIR/db-$(basename $tf).sqlite"
  rm -f "$JAYAAPP_DB_PATH" || true
  if ! ( REDIS_SOCKET_PATH= REDIS_URL="$REDIS_URL" JAYAAPP_DB_PATH="$JAYAAPP_DB_PATH" NODE_ENV=test node "$tf" 2>&1 ) | tee "$LOGFILE"; then
    echo "Test $tf failed. See $LOGFILE for output." >&2
    echo "--- Last 200 lines of $LOGFILE ---"
    tail -n 200 "$LOGFILE" || true
    exit 1
  fi

  # show whether plugin connected in log
  grep -E "Redis session store connected|Redis rate limiter connected|Redis AI limiter connected" -n "$LOGFILE" || true

  # small pause to let Redis keys propagate
  sleep 0.2
done

echo "All test files ran successfully. Logs are in $LOGDIR"

# Inspect Redis keys produced by plugins after the entire suite
echo "\nInspecting Redis keys (sample)..."
echo "AI keys (pattern ai:*)"
redis-cli -u "$REDIS_URL" --scan --pattern 'ai:*' | sed -n '1,200p' || true

echo "Rate limiter keys (pattern rl:*)"
redis-cli -u "$REDIS_URL" --scan --pattern 'rl:*' | sed -n '1,200p' || true

echo "Session keys (pattern session:*)"
redis-cli -u "$REDIS_URL" --scan --pattern 'session:*' | sed -n '1,200p' || true

echo "Redis integration test script finished. Logs: $LOGDIR"

exit 0
