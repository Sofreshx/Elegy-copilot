# Security Model

This document describes the security architecture of the Mobile Companion system.

## Overview

The Mobile Companion uses a layered security approach:

1. **Authentication** - GitHub OAuth for identity
2. **Authorization** - JWT tokens with scoped permissions
3. **Transport Security** - TLS encryption for all connections
4. **Data Protection** - Encrypted storage for sensitive data

## Authentication Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Mobile PWA     │     │  Cloud Relay    │     │    GitHub       │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         │  1. Login Request     │                       │
         │──────────────────────>│                       │
         │                       │  2. OAuth Redirect    │
         │                       │──────────────────────>│
         │                       │                       │
         │                       │  3. Authorization     │
         │                       │<──────────────────────│
         │                       │                       │
         │  4. JWT Token         │                       │
         │<──────────────────────│                       │
         │                       │                       │
```

### Token Lifecycle

1. **Access Token**: Short-lived (1 hour), used for API requests
2. **Refresh Token**: Long-lived (7 days), used to obtain new access tokens
3. **Session Token**: Tied to VS Code session, expires when session ends

### Token Storage

| Platform | Storage Method |
|----------|---------------|
| Mobile PWA | IndexedDB (encrypted) |
| VS Code | SecretStorage API |
| Cloud Relay | Redis (encrypted at rest) |

## Authorization

### Permission Scopes

| Scope | Description | Risk Level |
|-------|-------------|------------|
| `session:read` | View session status | Low |
| `session:write` | Control sessions | Medium |
| `idea:read` | View ideas | Low |
| `idea:write` | Create/edit ideas | Low |
| `agent:invoke` | Execute agents | High |
| `workflow:dispatch` | Trigger GitHub Actions | High |

### Role-Based Access

| Role | Scopes |
|------|--------|
| Viewer | `session:read`, `idea:read` |
| Editor | Viewer + `session:write`, `idea:write` |
| Admin | Editor + `agent:invoke`, `workflow:dispatch` |

## Transport Security

### WebSocket Connection

- **Local**: Uses `ws://` on localhost only
- **Remote**: Requires `wss://` with valid TLS certificate
- **Heartbeat**: Regular pings to detect stale connections

### Certificate Requirements

For production relay deployments:
- Valid TLS certificate (Let's Encrypt recommended)
- TLS 1.2 or higher
- Strong cipher suites only

## Data Protection

### Sensitive Data Classification

| Data Type | Classification | Protection |
|-----------|---------------|------------|
| OAuth tokens | Secret | Encrypted storage, no logging |
| Session logs | Internal | Sanitized, size-limited |
| User preferences | Internal | Local encryption |
| Ideas/drafts | User | IndexedDB with encryption |

### Data at Rest

- **IndexedDB**: Encrypted using Web Crypto API
- **VS Code**: Uses platform SecretStorage
- **Relay**: Redis with encryption at rest

### Data in Transit

- All API calls over HTTPS
- WebSocket connections over WSS (production)
- Message payloads encrypted with session key

## Threat Model

### Attack Vectors

| Threat | Mitigation |
|--------|-----------|
| Token theft | Short expiry, secure storage, no localStorage |
| Man-in-the-middle | TLS required for remote, cert pinning optional |
| Session hijacking | Session binding to device/browser |
| XSS | CSP headers, input sanitization |
| CSRF | SameSite cookies, origin validation |

### Trust Boundaries

```
┌────────────────────────────────────────────────────────────────┐
│                      Trusted Zone                               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   VS Code    │<-->│ Local Auth   │<-->│   User Device    │  │
│  │  Extension   │    │   Service    │    │   (same machine) │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
└────────────────────────────────────────────────────────────────┘
                              │
                        TLS Boundary
                              │
┌────────────────────────────────────────────────────────────────┐
│                    Semi-Trusted Zone                            │
│  ┌──────────────┐    ┌──────────────┐                          │
│  │ Cloud Relay  │<-->│   Mobile     │                          │
│  │   (TLS)      │    │   PWA        │                          │
│  └──────────────┘    └──────────────┘                          │
└────────────────────────────────────────────────────────────────┘
                              │
                      GitHub OAuth Boundary
                              │
┌────────────────────────────────────────────────────────────────┐
│                    External Services                            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │   GitHub     │    │   GitHub     │    │     GitHub       │  │
│  │   OAuth      │    │   Actions    │    │   Codespaces     │  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Security Best Practices

### For Users

1. **Use strong GitHub password** with 2FA enabled
2. **Don't share connection QR codes** publicly
3. **Disconnect unused sessions** regularly
4. **Review OAuth permissions** periodically

### For Deployments

1. **Use random ports** (`skillInstaller.ws.port: 0`)
2. **Enable TLS** for any remote access
3. **Rotate JWT secrets** periodically
4. **Monitor for unusual activity**
5. **Keep dependencies updated**

### For Development

1. **Never commit secrets** to repository
2. **Use environment variables** for sensitive config
3. **Sanitize all user input**
4. **Log securely** (no tokens/passwords)

## Incident Response

### If tokens are compromised:

1. Revoke GitHub OAuth tokens immediately
2. Rotate `skillInstaller.ws.secret`
3. Clear all active sessions
4. Review session logs for unauthorized access

### If relay is compromised:

1. Take relay offline
2. Invalidate all refresh tokens
3. Notify affected users
4. Audit access logs
5. Deploy fresh instance with new secrets

## Compliance Notes

- **GDPR**: User data stored locally by default; relay stores minimal session data
- **SOC 2**: Encryption at rest and in transit; access logging
- **HIPAA**: Not designed for PHI; consult compliance team before use in healthcare

## Security Contacts

Report security issues to: security@[your-domain]

Please do not disclose security vulnerabilities publicly until they have been addressed.
