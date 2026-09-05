#!/bin/bash
# Full redeploy: stop -> clean build -> start -> verify -> purge the edge cache.
#
# WHY THIS EXISTS (each step is here because skipping it broke prod at least once):
#
#  1. STOP BEFORE BUILDING. `next build` replaces .next, including the hashed
#     CSS/JS filenames, while a running server still holds the old manifest in
#     memory. Every stylesheet then 404s and the site renders as unstyled text.
#     Building under a live server is the single easiest way to break this app.
#
#  2. ONLY KILL OUR SERVER. This machine also runs `genewizard`, a *different*
#     Next.js app, under its own systemd unit and user. Matching on
#     "next-server" alone would take it down, so every candidate process is
#     confirmed by its working directory before being signalled.
#
#  3. PURGE CLOUDFLARE. The zone has a Cache Rule set to "ignore origin
#     cache-control, edge TTL 1 day" (see docs/SEO-RUNBOOK.md). Without a purge
#     the edge keeps serving the PREVIOUS build's HTML, which references asset
#     hashes that no longer exist -- the same unstyled page as failure 1, but
#     only for other people, so it is easy to miss when your own browser has
#     refetched. Observed in production: HTML served with age=78310s.
#
# Usage:
#   scripts/redeploy.sh                 # stop, clean build, start, verify
#   scripts/redeploy.sh --no-build      # restart only (e.g. to pick up a new .db)
#   scripts/redeploy.sh --no-purge      # skip the Cloudflare step
#
# Cloudflare purge runs automatically when CF_ZONE_ID and CF_API_TOKEN are set
# (put them in .env.local); otherwise the script prints what to do by hand.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
REPO="$(pwd -P)"
PORT="${PORT:-3000}"
DO_BUILD=1
DO_PURGE=1
PUBLIC_URL="${PUBLIC_URL:-https://explore.metascienceobservatory.org}"

for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --no-purge) DO_PURGE=0 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg"; exit 1 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die() { printf '\033[31m  FATAL: %s\033[0m\n' "$*"; exit 1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

# Pids of OUR app only. A candidate must match a SERVER command shape AND have
# this repo as its cwd -- that combination is what keeps genewizard safe.
#
# Self/ancestor exclusion is not paranoia: any shell whose command line merely
# MENTIONS "start-with-cache.sh" (this script's own invoking shell, a grep, an
# editor) matches a naive pattern, and if its cwd is the repo the script would
# kill its own caller. Observed while testing this file.
ancestors() {
  local pid=$$
  while [ -n "$pid" ] && [ "$pid" != "1" ] && [ "$pid" != "0" ]; do
    echo "$pid"
    pid="$(awk '{print $4}' "/proc/$pid/stat" 2>/dev/null)" || break
  done
}

our_pids() {
  local pid cwd cmd skip
  local excluded; excluded=" $(ancestors | tr '\n' ' ') "
  for pid in $(ps -eo pid= 2>/dev/null); do
    case "$excluded" in *" $pid "*) continue ;; esac
    # Processes exit between the ps listing and this read, and bash reports a
    # failed input redirection on ITS stderr before `2>/dev/null` on the command
    # can apply -- hence the existence test and the braced group.
    [ -r "/proc/$pid/cmdline" ] || continue
    cmd="$( { tr '\0' ' ' < "/proc/$pid/cmdline"; } 2>/dev/null )" || continue
    # Only real server processes: next-server itself, or a shell whose FIRST
    # word is the start script (not one that merely mentions it).
    case "$cmd" in
      "next-server"*|*"/bin/bash ./scripts/start-with-cache.sh"*|"sh -c ./scripts/start-with-cache.sh"*|*"node "*"/next start"*) ;;
      *) continue ;;
    esac
    # A shell running an inline -c program is never our server.
    case "$cmd" in *" -c source "*|*claude*) continue ;; esac
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null)" || continue
    [ "$cwd" = "$REPO" ] && echo "$pid"
  done
}

# ---------------------------------------------------------------------------
say "1/5  Stopping any running deployment"
PIDS="$(our_pids)"
if [ -z "$PIDS" ]; then
  echo "  nothing running for $REPO"
else
  echo "  stopping: $(echo "$PIDS" | tr '\n' ' ')"
  # TERM the whole tree first. Our start script traps this and shuts the server
  # down through its own cleanup path.
  for p in $PIDS; do kill -TERM "$p" 2>/dev/null; done
  for _ in $(seq 1 20); do
    [ -z "$(our_pids)" ] && break
    sleep 0.5
  done
  for p in $(our_pids); do
    warn "pid $p ignored SIGTERM; sending SIGKILL"
    kill -KILL "$p" 2>/dev/null
  done
fi

# The port must actually be free, or `next start` will fail to bind and we would
# "successfully" deploy a server that never listens (this produced a 502).
for _ in $(seq 1 20); do
  port_open || break
  sleep 0.5
done
if port_open; then
  die "port $PORT is still held by something outside this repo -- check before retrying"
fi
echo "  port $PORT free"

# ---------------------------------------------------------------------------
if [ "$DO_BUILD" = "1" ]; then
  say "2/5  Clean build"
  # Remove .next outright: a stale entry from a previous build can survive an
  # incremental rebuild and get served afterwards.
  rm -rf .next
  if ! npm run build; then
    die "build failed -- server NOT restarted, previous .next already removed.
       Fix the build and re-run; the site stays down until then."
  fi
  [ -f .next/BUILD_ID ] || die "build reported success but .next/BUILD_ID is missing"
  CSS_COUNT="$(ls .next/static/css/ 2>/dev/null | wc -l)"
  [ "$CSS_COUNT" -gt 0 ] || die "build produced no CSS assets"
  echo "  BUILD_ID $(cat .next/BUILD_ID)  ($CSS_COUNT css asset(s))"
else
  say "2/5  Skipping build (--no-build)"
  [ -f .next/BUILD_ID ] || die "no existing build to serve (.next/BUILD_ID missing)"
fi

# ---------------------------------------------------------------------------
say "3/5  Starting server on port $PORT"
mkdir -p logs
LOG="logs/server-$(date +%Y%m%d_%H%M%S).log"
# setsid so the server survives this script exiting and gets its own process
# group; start-with-cache.sh does the same for next-server itself.
PORT="$PORT" setsid ./scripts/start-with-cache.sh > "$LOG" 2>&1 &
echo "  log: $LOG"

for i in $(seq 1 90); do
  port_open && { echo "  listening after ${i}s"; break; }
  sleep 1
done
port_open || die "server did not start within 90s -- see $LOG"

# ---------------------------------------------------------------------------
say "4/5  Verifying the origin"
FAIL=0
for path in / /trends /papers; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$PORT$path")"
  printf '  %-10s HTTP %s\n' "$path" "$CODE"
  [ "$CODE" = "200" ] || FAIL=1
done

# The check that actually catches the unstyled-page failure: take the CSS URL
# the rendered HTML asks for and confirm the server can serve it.
CSS_REF="$(curl -s --max-time 30 "http://127.0.0.1:$PORT/" | grep -oE '/_next/static/css/[a-z0-9]+\.css' | head -1)"
if [ -n "$CSS_REF" ]; then
  CSS_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$PORT$CSS_REF")"
  printf '  %-10s HTTP %s  (%s)\n' "css" "$CSS_CODE" "$CSS_REF"
  [ "$CSS_CODE" = "200" ] || FAIL=1
else
  warn "no stylesheet referenced in the homepage HTML"
  FAIL=1
fi
[ "$FAIL" = "0" ] || warn "origin verification FAILED -- inspect $LOG before purging"

# ---------------------------------------------------------------------------
say "5/5  Cloudflare edge cache"
if [ "$DO_PURGE" = "0" ]; then
  warn "skipped (--no-purge). The edge will serve the PREVIOUS build's HTML for up to a day."
elif [ -f .env.local ] && grep -q '^CF_ZONE_ID=' .env.local 2>/dev/null; then
  # shellcheck disable=SC1091
  CF_ZONE_ID="$(grep '^CF_ZONE_ID=' .env.local | cut -d= -f2- | tr -d '"'"'"' ')"
  CF_API_TOKEN="$(grep '^CF_API_TOKEN=' .env.local | cut -d= -f2- | tr -d '"'"'"' ')"
  if [ -n "${CF_ZONE_ID:-}" ] && [ -n "${CF_API_TOKEN:-}" ]; then
    echo "  purging zone $CF_ZONE_ID ..."
    RESP="$(curl -s -X POST \
      "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
      -H "Authorization: Bearer $CF_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}')"
    if echo "$RESP" | grep -q '"success":true'; then
      echo "  purged."
      sleep 5
      PUB_CSS="$(curl -s --max-time 30 "$PUBLIC_URL/" | grep -oE '/_next/static/css/[a-z0-9]+\.css' | head -1)"
      if [ "$PUB_CSS" = "$CSS_REF" ]; then
        echo "  edge now serves the current build ($PUB_CSS)"
      else
        warn "edge still serving $PUB_CSS, origin has $CSS_REF (may take a moment to propagate)"
      fi
    else
      warn "purge failed: $RESP"
    fi
  else
    warn "CF_ZONE_ID/CF_API_TOKEN incomplete in .env.local"
  fi
else
  cat <<EOF
  !! NOT PURGED -- do this now, or visitors get the previous build's HTML
     referencing CSS files that no longer exist (an unstyled page).

     Dashboard: Cloudflare -> metascienceobservatory.org -> Caching
                -> Configuration -> Purge Everything

     Or set CF_ZONE_ID and CF_API_TOKEN in .env.local and re-run to automate it.

     Verify afterwards:
       curl -s $PUBLIC_URL/ | grep -oE '/_next/static/css/[a-z0-9]+\.css' | head -1
       # expect: $CSS_REF
EOF
fi

say "Done"
echo "  build : $(cat .next/BUILD_ID 2>/dev/null)"
echo "  log   : $LOG"
echo "  stop  : press Ctrl+C in the server's terminal, or"
echo "          kill -INT \$(pgrep -f 'bash ./scripts/start-with-cache.sh')"
