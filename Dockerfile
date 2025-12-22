# Build stage - use Debian-based image (more reliable than Alpine for native modules)
# Pinned digest for reproducibility - update periodically with: docker pull node:20-slim
FROM node:20-slim@sha256:1b38aaddff63cd0d3a9b5b03863a71fd33ee62047dd2e915f494d96b4b9c18cc AS builder

WORKDIR /app

# Install dependencies for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the Next.js app
RUN npm run build

# Production stage
FROM node:20-slim@sha256:1b38aaddff63cd0d3a9b5b03863a71fd33ee62047dd2e915f494d96b4b9c18cc AS runner

WORKDIR /app

# Create non-root user for security
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy built assets from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Data directory will be mounted as volume
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the app
CMD ["node", "server.js"]
