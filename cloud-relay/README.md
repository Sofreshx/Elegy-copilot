# Instruction Engine Cloud Relay Service

WebSocket relay service for cross-network communication between the mobile companion app and VS Code extension instances.

## Overview

The cloud relay enables:
- **Cross-network communication**: Mobile apps can reach VS Code instances behind NAT/firewalls
- **Message routing**: Routes messages between clients based on userId and clientId
- **Connection management**: Tracks online/offline status, heartbeats, and reconnection
- **JWT authentication**: Secure client authentication via GitHub OAuth tokens

## Architecture

```
┌────────┐      ┌───────────┐      ┌────────────┐
│ Mobile │◄────►│   Relay   │◄────►│ Extension  │
│  App   │      │  Service  │      │  (VS Code) │
└────────┘      └───────────┘      └────────────┘
```

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Start in development mode (no auth required)
npm run dev
```

### Docker

```bash
# Build and run
docker-compose up -d relay

# Or for development with hot reload
docker-compose --profile dev up relay-dev
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP/WebSocket port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `JWT_SECRET` | Secret for JWT verification | (required in production) |
| `JWT_ISSUER` | Expected JWT issuer | `instruction-engine-relay` |
| `JWT_AUDIENCE` | Expected JWT audience | `instruction-engine` |
| `REQUIRE_AUTH` | Require JWT authentication | `true` |
| `MAX_MESSAGE_SIZE` | Max message size in bytes | `1048576` (1MB) |

## API Endpoints

### HTTP

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health + metrics |
| `/health/ready` | GET | Kubernetes readiness probe |
| `/health/live` | GET | Kubernetes liveness probe |

### WebSocket

**Endpoint**: `ws://host:port/v1/ws`

**Authentication**: Pass JWT token as query parameter:
```
ws://host:port/v1/ws?token=<jwt>
```

Or authenticate after connection:
```json
{
  "jsonrpc": "2.0",
  "id": "auth-001",
  "method": "authenticate",
  "params": { "token": "<jwt>" }
}
```

## Protocol

See [relay-protocol.md](../.instructions/artefacts/relay-protocol.md) for the full protocol specification.

### Message Envelope

All messages use the relay envelope format:

```json
{
  "version": "1.0",
  "messageId": "uuid",
  "timestamp": "2026-02-01T12:00:00.000Z",
  "source": {
    "type": "mobile",
    "clientId": "mob-abc123",
    "userId": "github|12345"
  },
  "target": {
    "type": "extension",
    "clientId": "ext-def456"
  },
  "payload": {
    "jsonrpc": "2.0",
    "id": "req-001",
    "method": "get_status",
    "params": {}
  }
}
```

### Supported Commands

| Method | Description |
|--------|-------------|
| `list_clients` | List connected clients for current user |
| `get_client` | Get details about a specific client |
| `initialize` | Protocol version negotiation |

All other commands are routed to the target client.

## Deployment

### Production Checklist

- [ ] Set strong `JWT_SECRET` (use `openssl rand -base64 64`)
- [ ] Enable HTTPS via reverse proxy (nginx, Cloudflare, etc.)
- [ ] Configure rate limiting at proxy level
- [ ] Set up monitoring/alerting for `/health` endpoint
- [ ] Review firewall rules (only expose via proxy)

### Example Nginx Configuration

```nginx
upstream relay {
    server localhost:3000;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /v1/ws {
        proxy_pass http://relay;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://relay;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Development

### Project Structure

```
cloud-relay/
├── src/
│   ├── index.ts          # Entry point
│   ├── relay.ts          # WebSocket server + JWT auth
│   ├── connectionManager.ts  # Client tracking
│   ├── health.ts         # Health endpoints
│   └── types.ts          # TypeScript types
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run start` | Start production server |
| `npm run dev` | Start with ts-node (development) |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests |

## License

MIT
