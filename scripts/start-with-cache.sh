#!/bin/bash
# Start Next.js server and warm the cache

PORT=${PORT:-3000}

# Cleanup: stop the server and every process it spawned.
#
# WHY setsid + why the old version silently failed: `next start &` does NOT create
# a new process group, so the previous `kill -- -$SERVER_PID` addressed a group
# that never existed. It failed silently (2>/dev/null), the fallback `kill $SERVER_PID`
# missed the separate `next-server` child that `next start` spawns, and the script
# then blocked forever in `wait` -- which is why Ctrl+C appeared to do nothing.
# Running the server under `setsid` makes it a process-group leader, so
# `kill -- -$SERVER_PID` reaches the whole tree including next-server and its
# SQLite worker threads.
cleanup() {
  # Disarm first: a second Ctrl+C during shutdown must not re-enter this.
  trap - SIGINT SIGTERM EXIT
  echo ""
  echo "Shutting down server..."
  # Stop an in-flight cache warm first so it can't keep issuing requests.
  if [ -n "${PROBE_PID:-}" ]; then kill -TERM "$PROBE_PID" 2>/dev/null; fi
  if [ -n "${WARM_PID:-}" ]; then kill -TERM "$WARM_PID" 2>/dev/null; fi
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM -- -"$SERVER_PID" 2>/dev/null || kill -TERM "$SERVER_PID" 2>/dev/null
    # Give it up to 10s to close listeners and flush; then stop being polite.
    for _ in $(seq 1 20); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "Server did not exit within 10s; sending SIGKILL."
      kill -KILL -- -"$SERVER_PID" 2>/dev/null || kill -KILL "$SERVER_PID" 2>/dev/null
    fi
  fi
  echo "Server stopped."
  exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM EXIT

# Resolve the binary explicitly. `next` is only on PATH when this script is
# invoked through `npm run start`; setsid exec's via PATH, so relying on it made
# direct invocation fail with "setsid: failed to execute next".
NEXT_BIN="$(dirname "$0")/../node_modules/.bin/next"
if [ ! -x "$NEXT_BIN" ]; then
  NEXT_BIN="$(command -v next)" || { echo "FATAL: cannot find the next binary"; exit 1; }
fi

echo "Starting Next.js server on port $PORT..."
setsid "$NEXT_BIN" start -p "$PORT" &
SERVER_PID=$!

# Wait for server to be ready (using node fetch instead of curl)
echo "Waiting for server to start..."
# Each probe runs in the BACKGROUND with `wait`, for the same reason as the cache
# warm below: a foreground child defers trap delivery, and this probe calls
# /api/cache/warm -- an expensive endpoint, not a cheap health check -- so it can
# block for minutes. That is the window where Ctrl+C used to appear dead.
for i in {1..30}; do
  node -e "fetch('http://localhost:$PORT/api/cache/warm').then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null &
  PROBE_PID=$!
  if wait "$PROBE_PID" 2>/dev/null; then
    echo "Server is ready!"
    PROBE_PID=""
    break
  fi
  PROBE_PID=""
  sleep 1
done

# Warm the cache using node fetch.
#
# Run it in the BACKGROUND and `wait` on it. Bash defers trap handlers while a
# FOREGROUND child runs, and this call takes minutes (it warms searches over
# 250M papers) -- so with a foreground call, Ctrl+C during warming is queued and
# appears to do nothing. `wait` is interruptible, so traps fire immediately.
echo "Warming search cache..."
node -e "
fetch('http://localhost:$PORT/api/cache/warm')
  .then(r => r.json())
  .then(data => {
    console.log('Duration:', data.duration);
    console.log('Papers cached:', data.results?.papers?.cached || 0);
    console.log('Persons cached:', data.results?.persons?.cached || 0);
    console.log('Journals cached:', data.results?.journals?.cached || 0);
    console.log('Affiliations cached:', data.results?.affiliations?.cached || 0);
  })
  .catch(e => console.error('Cache warming failed:', e.message));
" &
WARM_PID=$!
wait "$WARM_PID" 2>/dev/null
echo ""
echo "Cache warming complete!"
echo "Press Ctrl+C to stop the server"

# Keep the server running
wait $SERVER_PID
