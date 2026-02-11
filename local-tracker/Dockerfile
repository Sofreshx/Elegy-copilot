# Build stage
FROM node:20-alpine AS builder

# Native build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS runtime

# Native build tools for better-sqlite3; git for GitMonitor
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite with correct ownership
RUN mkdir -p /app/data && chown nodejs:nodejs /app/data

# Switch to non-root user
USER nodejs

# WebSocket bridge + status dashboard
EXPOSE 9821 9822

# Health check against status port
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:9822/health || exit 1

# Start the service
CMD ["node", "dist/index.js"]
