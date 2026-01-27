#!/bin/bash
# Start Next.js server and warm the cache

PORT=${PORT:-3000}

# Cleanup function to kill the server on exit
cleanup() {
  echo ""
  echo "Shutting down server (PID: $SERVER_PID)..."
  if [ -n "$SERVER_PID" ]; then
    kill $SERVER_PID 2>/dev/null
    wait $SERVER_PID 2>/dev/null
  fi
  exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

echo "Starting Next.js server on port $PORT..."
next start -p $PORT &
SERVER_PID=$!

# Wait for server to be ready (using node fetch instead of curl)
echo "Waiting for server to start..."
for i in {1..30}; do
  if node -e "fetch('http://localhost:$PORT/api/cache/warm').then(() => process.exit(0)).catch(() => process.exit(1))" 2>/dev/null; then
    echo "Server is ready!"
    break
  fi
  sleep 1
done

# Warm the cache using node fetch
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
"
echo ""
echo "Cache warming complete!"
echo "Press Ctrl+C to stop the server"

# Keep the server running
wait $SERVER_PID
