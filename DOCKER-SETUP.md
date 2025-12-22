# Docker Setup for SciSciNet Dashboard

## Prerequisites

1. Docker and Docker Compose installed
2. Cloudflare tunnel already configured (`cloudflared tunnel create sciscinet-dashboard`)

## Quick Start

### Option 1: App Only (run cloudflared separately)

```bash
# Build and start the container
docker compose up -d sciscinet-dashboard

# Run cloudflared separately (like you do now)
cloudflared tunnel run sciscinet-dashboard
```

### Option 2: App + Cloudflared together

```bash
# Start both containers
docker compose up -d
```

## Commands

```bash
# Build the image
docker compose build

# Start in background
docker compose up -d

# View logs (follow mode - Ctrl+C to exit without stopping container)
docker compose logs -f sciscinet-dashboard

# Stop containers
docker compose down
```

## Updating After Code Changes

When you've made code changes and need to redeploy:

```bash
# Standard update (rebuild and restart)
docker compose down && docker compose build && docker compose up -d

# If you changed package.json or need a clean rebuild
docker compose down && docker compose build --no-cache && docker compose up -d
```

### Quick Reference

| Scenario | Command |
|----------|---------|
| Code changes only | `docker compose down && docker compose build && docker compose up -d` |
| package.json changed | `docker compose down && docker compose build --no-cache && docker compose up -d` |
| Just restart (no rebuild) | `docker compose restart sciscinet-dashboard` |
| Stop everything | `docker compose down` |
| Check if running | `docker compose ps` |

### Viewing Logs During Update

```bash
# Rebuild and follow logs immediately
docker compose down && docker compose build && docker compose up -d && docker compose logs -f sciscinet-dashboard
```

## Configuration

### Cloudflare Tunnel Config

Update your `~/.cloudflared/config.yml` to point to the Docker container:

```yaml
tunnel: sciscinet-dashboard
credentials-file: /home/dan/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: xyz.metascienceobservatory.org
    service: http://localhost:3000
  - service: http_status:404
```

### Resource Limits

Edit `docker-compose.yml` to adjust:
- `memory: 4G` - max memory (increase if you have more RAM)
- `cpus: '2'` - max CPU cores

## Security Features

1. **Non-root user**: App runs as `nextjs` user (UID 1001)
2. **No privilege escalation**: `no-new-privileges:true`
3. **Resource limits**: Prevents memory/CPU exhaustion
4. **Isolated filesystem**: Only `/app/data` is mounted

## Troubleshooting

### Container won't start
```bash
# Check logs
docker compose logs sciscinet-dashboard

# Common issue: database not found
# Make sure ./data/journals.db exists
ls -la data/
```

### Permission denied on data folder
```bash
# Fix ownership (container runs as UID 1001)
sudo chown -R 1001:1001 data/
```

### Rebuild after package.json changes
```bash
docker compose build --no-cache
docker compose up -d
```

## Development vs Production

For development, continue using:
```bash
npm run dev
```

For production with Docker:
```bash
docker compose up -d
```
