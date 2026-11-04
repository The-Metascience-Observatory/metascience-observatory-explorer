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
#
# WHY the short grace period and the second-Ctrl+C escalation (2026-10-29): on
# SIGTERM, Next's production handler calls `server.close()` and waits for every
# keep-alive connection to go idle before exiting; only the dev server calls
# `closeAllConnections()` (node_modules/next/dist/server/lib/start-server.js).
# cloudflared holds a pool of keep-alive connections to the origin and keeps
# feeding crawler traffic down them, so under any real load that wait never
# ends: the listener is already closed (the site is DOWN), the process keeps
# serving on the old sockets and logging into the pane, and the drain is
# pointless. The 2026-10-28 instance sat in that state for 13 hours after a
# second Ctrl+C killed this script -- the previous version disarmed its traps
# first, so the second Ctrl+C aborted cleanup before the SIGKILL fallback ran,
# and the setsid'd server never saw the terminal's signal at all. Now a second
# Ctrl+C force-kills immediately, and the grace is 3s because nothing useful
# happens during it (journals.db is read-only; cache.db/analytics.db are WAL).
cleanup() {
  echo ""
  echo "Shutting down server... (press Ctrl+C again to force-kill)"
  # A second Ctrl+C or a TERM during shutdown must escalate, not abort.
  trap 'force_kill' SIGINT SIGTERM
  trap - EXIT
  # Stop an in-flight cache warm first so it can't keep issuing requests.
  if [ -n "${PROBE_PID:-}" ]; then kill -TERM "$PROBE_PID" 2>/dev/null; fi
  if [ -n "${WARM_PID:-}" ]; then kill -TERM "$WARM_PID" 2>/dev/null; fi
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM -- -"$SERVER_PID" 2>/dev/null || kill -TERM "$SERVER_PID" 2>/dev/null
    # Give it 3s to flush; under load the keep-alive drain never finishes, so
    # do not wait longer -- the listener is already closed at this point.
    for _ in $(seq 1 6); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "Server still draining keep-alive connections after 3s; sending SIGKILL."
      kill -KILL -- -"$SERVER_PID" 2>/dev/null || kill -KILL "$SERVER_PID" 2>/dev/null
    fi
  fi
  echo "Server stopped."
  exit 0
}

force_kill() {
  trap - SIGINT SIGTERM EXIT
  echo ""
  echo "Force-killing server..."
  if [ -n "${SERVER_PID:-}" ]; then
    kill -KILL -- -"$SERVER_PID" 2>/dev/null || kill -KILL "$SERVER_PID" 2>/dev/null
  fi
  echo "Server killed."
  exit 130
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

# Bind to loopback. cloudflared's ingress targets http://localhost:$PORT (see
# DOCKER-SETUP.md), so the tunnel is unaffected, but the origin stops being
# reachable from the LAN. That matters because middleware.ts derives the client
# IP from cf-connecting-ip, which anyone able to reach the origin directly can
# set freely — defeating the rate limits and the blocklist in one header.
#
# Override with HOST=0.0.0.0 to reach the dev box from another machine.
HOST=${HOST:-127.0.0.1}

echo "Starting Next.js server on $HOST:$PORT..."
setsid "$NEXT_BIN" start -p "$PORT" -H "$HOST" &
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
