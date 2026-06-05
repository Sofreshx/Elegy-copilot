---
created: 2026-06-03
updated: 2026-06-04
category: lexicon
status: current
doc_kind: node
id: networking-api-glossary
summary: Glossary of networking protocols, API styles, and communication patterns.
tags: [lexicon, networking, api]
---

# Networking & APIs

## Protocols

### HTTP (Hypertext Transfer Protocol)
**Definition:** The foundation protocol of the web, a request-response protocol using methods (GET, POST, PUT, DELETE, PATCH), status codes, headers, and bodies.
**Usage:** The universal protocol for web APIs and browser-server communication. Stateless by design — each request is independent. Distinguish from HTTPS (encrypted) and WebSocket (bidirectional).
**Related:** HTTPS (encrypted HTTP), REST (architectural style over HTTP), Status Code (response meaning), Method (operation type)
**Tags:** networking, protocol, http

### HTTPS (HTTP Secure)
**Definition:** HTTP over TLS/SSL encryption, protecting data in transit from eavesdropping, tampering, and impersonation.
**Usage:** Required for any production web service. All traffic should be HTTPS, with HTTP redirecting to HTTPS. Distinguish from HTTP (unencrypted) and TLS (the encryption layer).
**Related:** TLS (encryption protocol), SSL (predecessor to TLS), Certificate (identity verification), HSTS (enforce HTTPS)
**Tags:** networking, security, https

### WebSocket
**Definition:** A protocol providing full-duplex, persistent communication channels over a single TCP connection, enabling real-time data exchange.
**Usage:** Use for real-time features — chat, live updates, collaborative editing, streaming data. Distinguish from SSE (server-to-client only) and HTTP Polling (client-driven, higher latency).
**Related:** SSE (server-to-client only), Long Polling (HTTP-based real-time), SignalR/Socket.IO (WebSocket abstractions)
**Tags:** networking, protocol, websocket

### SSE (Server-Sent Events)
**Definition:** A protocol enabling servers to push events to clients over a single HTTP connection, using a standard text/event-stream format.
**Usage:** Use for server-to-client streaming when bidirectional communication isn't needed — live feeds, notifications, progress updates. Simpler than WebSocket (no bidirectional, auto-reconnect built-in).
**Related:** WebSocket (bidirectional), Long Polling (client-pull), Event Stream (the event format)
**Tags:** networking, protocol, sse

### TCP (Transmission Control Protocol)
**Definition:** A reliable, connection-oriented transport protocol ensuring ordered delivery of data between applications.
**Usage:** Use for most internet applications where data integrity matters. Guarantees delivery, ordering, and error checking. Distinguish from UDP (faster, no guarantees) — TCP is for reliability.
**Related:** UDP (faster, unreliable), IP (network layer), TLS (security over TCP), Handshake (connection establishment)
**Tags:** networking, protocol, tcp

### UDP (User Datagram Protocol)
**Definition:** A lightweight, connectionless transport protocol with minimal overhead, no delivery guarantees, and no ordering.
**Usage:** Use for real-time applications where speed matters more than reliability — streaming video, online gaming, VoIP, DNS lookups. Distinguish from TCP (reliable, ordered).
**Related:** TCP (reliable alternative), Multicast (one-to-many UDP), Packet Loss (UDP characteristic)
**Tags:** networking, protocol, udp

### DNS (Domain Name System)
**Definition:** A hierarchical naming system that translates human-readable domain names (example.com) to IP addresses.
**Usage:** Every web request uses DNS resolution. DNS caching at browser, OS, and network levels reduces lookup latency. Distinguish from IP Address (the resolved result) and Hosts File (local override).
**Related:** A Record (IPv4 address), CNAME (alias), TTL (DNS cache duration), Recursive Resolver (the lookup server)
**Tags:** networking, infrastructure, dns

### TLS (Transport Layer Security)
**Definition:** A cryptographic protocol providing privacy and data integrity between communicating applications, the foundation of HTTPS.
**Usage:** Use for all sensitive communications. TLS 1.3 is the current standard. Distinguish from SSL (deprecated predecessor) and HTTPS (HTTP over TLS).
**Related:** SSL (deprecated), Certificate (identity proof), Handshake (key exchange), mTLS (mutual authentication)
**Tags:** networking, security, tls

## API Styles

### REST (Representational State Transfer)
**Definition:** An architectural style for APIs using HTTP methods (GET, POST, PUT, DELETE, PATCH) to operate on resources identified by URLs, with stateless communication.
**Usage:** The dominant API style for web services. Resources, not actions, are the primary abstraction. Stateless, cacheable, layered. Distinguish from RPC (action-oriented) and GraphQL (client-specified queries).
**Related:** Resource (the noun), HTTP Method (the verb), HATEOAS (hypermedia), OpenAPI (specification format)
**Tags:** networking, api, rest

### GraphQL
**Definition:** A query language and runtime for APIs where clients specify exactly what data they need, enabling flexible, efficient data fetching.
**Usage:** Use for complex data requirements, multiple clients with different data needs, or when API evolution without versioning is important. Distinguish from REST (fixed response shapes, multiple endpoints) — GraphQL has one endpoint and client-specified queries.
**Related:** Query (read operation), Mutation (write operation), Schema (type definition), Resolver (data fetching logic)
**Tags:** networking, api, graphql

### gRPC
**Definition:** A high-performance RPC framework using Protocol Buffers for serialization, HTTP/2 for transport, supporting bidirectional streaming.
**Usage:** Use for internal service-to-service communication, microservices, or any scenario demanding high performance and strong typing. Distinguish from REST (JSON, HTTP/1.1) and GraphQL (query-focused, not RPC).
**Related:** Protocol Buffers (serialization format), HTTP/2 (transport), Streaming (bidirectional), Stub (generated client)
**Tags:** networking, api, grpc

### RPC (Remote Procedure Call)
**Definition:** A communication paradigm where a program calls a function on a remote server as if it were local, abstracting network complexity.
**Usage:** The oldest API style, making remote calls look like local function calls. Distinguish from REST (resource-oriented) — RPC is action-oriented. Modern implementations: gRPC, JSON-RPC, XML-RPC.
**Related:** gRPC (modern RPC), REST (resource-oriented alternative), JSON-RPC (JSON-based RPC), Stub (local proxy)
**Tags:** networking, api, rpc

### SOAP
**Definition:** An XML-based protocol for structured information exchange in web services, with strict contracts (WSDL) and built-in error handling.
**Usage:** Legacy enterprise systems, banking, and scenarios requiring strict contracts and built-in security. Largely replaced by REST and GraphQL for modern APIs.
**Related:** WSDL (contract definition), XML (message format), Enterprise Bus (SOAP transport), REST (modern alternative)
**Tags:** networking, api, soap

### Webhook
**Definition:** An HTTP callback triggered by an event, where a server sends a POST request to a pre-registered URL when something happens.
**Usage:** Use for event notifications — "tell me when this happens" instead of "let me check if something happened." Distinguish from Polling (client checks periodically) — Webhooks push, eliminating polling overhead.
**Related:** Polling (the alternative), Event (what triggers the webhook), Payload (the event data), Secret (webhook authentication)
**Tags:** networking, api, webhook

## API Concepts

### Idempotency
**Definition:** The property of an operation where performing it multiple times has the same effect as performing it once — a guarantee for safe retries.
**Usage:** Essential for reliable systems over unreliable networks. Use idempotency keys to prevent duplicate processing. GET, PUT, and DELETE are idempotent; POST is not (unless designed). Distinguish from Safety (read-only, no side effects).
**Related:** Idempotency Key (request identifier), Safe Method (GET, read-only), Retry (needs idempotency), Side Effect (what we prevent)
**Tags:** networking, api, idempotency

### Rate Limiting
**Definition:** Controlling the rate of requests a client can make to an API within a time window, preventing abuse and ensuring fair usage.
**Usage:** Apply to all public APIs. Common algorithms: Token Bucket, Leaky Bucket, Sliding Window, Fixed Window. Return 429 (Too Many Requests) with Retry-After header.
**Related:** Throttling (broader rate control), Quota (total usage limit), 429 (status code), Retry-After (when to retry)
**Tags:** networking, api, rate-limiting

### Pagination
**Definition:** Splitting a large API response into smaller pages, allowing clients to iterate without overwhelming the server or client.
**Usage:** Use for any list endpoint that could return many results. Common strategies: cursor-based (stable, recommended), offset-based (simple, unstable with writes), page-based (typical for UI).
**Related:** Cursor (stable pagination token), Offset (position-based), Limit (page size), Keyset (cursor using sort columns)
**Tags:** networking, api, pagination

### Versioning
**Definition:** Managing API changes over time to avoid breaking existing clients — through URL (/v1/resource), header (Accept: v1), or query parameter.
**Usage:** Breaks are inevitable as APIs evolve. Choose a versioning strategy early. URL versioning is most visible and commonly used. Distinguish from Backward Compatibility (change without version bump).
**Related:** Backward Compatible (safe change), Breaking Change (requires version), Deprecation (sunset process), SemVer (versioning system)
**Tags:** networking, api, versioning

### OpenAPI
**Definition:** A specification format (formerly Swagger) for describing REST APIs in a machine-readable YAML or JSON document, enabling code generation, documentation, and testing.
**Usage:** Use as the single source of truth for API contracts. An OpenAPI spec can generate client SDKs, server stubs, docs, and tests. Distinguish from GraphQL Schema (different API style) and Protocol Buffers (gRPC style).
**Related:** Swagger (tooling), Codegen (generation), API Contract (the spec), Swagger UI (documentation viewer)
**Tags:** networking, api, openapi

### Serialization
**Definition:** Converting in-memory data structures to a format that can be transmitted over a network or stored — JSON, XML, Protocol Buffers, MessagePack.
**Usage:** Choose based on requirements: JSON (human-readable, universal), Protocol Buffers (compact, fast, typed), XML (verbose, legacy), MessagePack (compact JSON-like).
**Related:** Deserialization (reverse), JSON (common format), Protocol Buffers (typed format), Schema (shared type definition)
**Tags:** networking, api, serialization

### CORS (Cross-Origin Resource Sharing)
**Definition:** A browser security mechanism that controls which origins can access resources on a different origin, preventing unauthorized cross-site requests.
**Usage:** Configure on the server to allow specific origins. Browsers enforce CORS; other HTTP clients don't. Distinguish from CSP (Content Security Policy, prevents XSS) — CORS controls API access.
**Related:** Same-Origin Policy (default restriction), Preflight (OPTIONS check), Origin (request source), CSP (related security policy)
**Tags:** networking, security, cors

### HATEOAS (Hypermedia as the Engine of Application State)
**Definition:** A REST constraint where API responses include links to related actions, allowing clients to navigate the API dynamically without hardcoded URLs.
**Usage:** The most advanced REST maturity level (Richardson Maturity Model Level 3). Rarely implemented in practice. Distinguish from RPC (fixed endpoints) — HATEOAS makes the API discoverable.
**Related:** REST (the parent), Hypermedia (linked content), Richardson Maturity Model (REST levels), Discovery (client navigation)
**Tags:** networking, api, hateoas
