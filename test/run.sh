#!/usr/bin/env bash
# Runs the unit tests, then the API integration tests end to end:
#   0. runs the unit tests (dates, schedule, location, map points)
#   1. generates random test keys into a temporary env file
#   2. resets a separate local D1 (.wrangler/test-state) and applies schema.sql
#   3. starts `wrangler dev` on a free port and runs test/api.test.mjs
#   4. repeats with VIEW_PUBLIC=true to test public viewing
#   5. stops wrangler and removes temporary files
#
# Usage (from anywhere):  bash test/run.sh
# Only some API tests:    TEST_PATTERN='^stop:' bash test/run.sh
# Your own .dev.vars and .wrangler/state are not touched.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PERSIST=".wrangler/test-state"
TMPDIR_RUN="$(mktemp -d)"
ENV_FILE="$TMPDIR_RUN/test.env"
LOG_FILE="$TMPDIR_RUN/wrangler.log"
WRANGLER_PID=""

free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'
}

rand_key() {
  node -e 'console.log("k_"+require("crypto").randomBytes(24).toString("hex"))'
}

stop_wrangler() {
  if [ -n "$WRANGLER_PID" ] && kill -0 "$WRANGLER_PID" 2>/dev/null; then
    # Kill the whole process group (wrangler spawns workerd children).
    kill -- "-$WRANGLER_PID" 2>/dev/null || kill "$WRANGLER_PID" 2>/dev/null || true
    for _ in $(seq 1 50); do
      kill -0 "$WRANGLER_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 -- "-$WRANGLER_PID" 2>/dev/null || true
  fi
  WRANGLER_PID=""
}

cleanup() {
  stop_wrangler
  rm -rf "$TMPDIR_RUN"
}
trap cleanup EXIT INT TERM

echo "==> Running unit tests"
node --test --test-reporter=spec test/dates.test.mjs test/schedule.test.mjs test/location.test.mjs test/map-points.test.mjs
KEYS_JSON="{\"alice\":\"$(rand_key)\",\"bob\":\"$(rand_key)\"}"
printf 'API_KEYS=%s\n' "$KEYS_JSON" > "$ENV_FILE"

echo "==> Resetting local test database in $PERSIST"
rm -rf "$PERSIST"
npx wrangler d1 execute itinerary-db --local --persist-to "$PERSIST" --file schema.sql >/dev/null

run_pass() {
  local view_public="$1"
  local port inspector
  port="$(free_port)"
  inspector="$(free_port)"
  echo "==> Starting wrangler dev on port $port (VIEW_PUBLIC=$view_public)"
  set -m
  npx wrangler dev --ip 127.0.0.1 --port "$port" --inspector-port "$inspector" \
    --persist-to "$PERSIST" --env-file "$ENV_FILE" \
    --var "VIEW_PUBLIC:$view_public" --show-interactive-dev-session=false \
    >"$LOG_FILE" 2>&1 &
  WRANGLER_PID=$!
  set +m

  local ready=""
  for _ in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:$port/api" >/dev/null 2>&1; then ready=1; break; fi
    if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then break; fi
    sleep 0.5
  done
  if [ -z "$ready" ]; then
    echo "wrangler dev did not start. Log:"
    cat "$LOG_FILE"
    exit 1
  fi

  local status=0
  BASE_URL="http://127.0.0.1:$port" TEST_API_KEYS="$KEYS_JSON" TEST_VIEW_PUBLIC="$view_public" \
    node --test --test-reporter=spec ${TEST_PATTERN:+"--test-name-pattern=$TEST_PATTERN"} test/api.test.mjs || status=$?
  stop_wrangler
  if [ "$status" -ne 0 ]; then
    echo "==> Tests FAILED (VIEW_PUBLIC=$view_public). wrangler log:"
    cat "$LOG_FILE"
    exit "$status"
  fi
}

run_pass false
run_pass true
echo "==> All test passes succeeded."
