# ADR 4: JWT + Refresh Token Rotation vs. Server-Side Sessions

## Status
Accepted

## Context
When running multiple API server instances behind a load balancer, traditional server-side memory sessions require sticky sessions or a central session store query on every single HTTP request, creating an architectural database bottleneck.

## Decision
I chose short-lived stateless JWT access tokens (15-minute expiry) paired with long-lived single-use refresh tokens (7-day expiry) stored hashed in PostgreSQL with strict rotation and reuse detection.

## Consequences
- **Stateless Horizontal Scaling**: Any app server instance can verify an incoming request's access token cryptographically without hitting the database or Redis, maximizing request throughput.
- **Leak Protection & Revocation**: Refresh tokens are stored using SHA-256 hashes, ensuring that a database dump does not expose active user credentials. If an attacker reuses an old refresh token, our reuse detection logic flags the token family as compromised and invalidates all associated tokens immediately.
- **Trade-off**: Access tokens cannot be revoked instantly prior to their 15-minute TTL without checking a Redis revocation blocklist. Given the 15-minute window, this security-performance trade-off is optimal for this architecture.
