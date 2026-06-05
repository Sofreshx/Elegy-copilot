---
created: 2026-06-03
updated: 2026-06-04
category: lexicon
status: current
doc_kind: node
id: security-glossary
summary: Glossary of security concepts, authentication, authorization, and threat models.
tags: [lexicon, security]
---

# Security

## Authentication & Authorization

### Authentication
**Definition:** The process of verifying who a user is — proving identity through something they know (password), have (device, key), or are (biometric).
**Usage:** First step in access control: identify the user. Distinguish from Authorization (what the user can do) — Authentication answers "who are you?", Authorization answers "what can you do?".
**Related:** Authorization (what you can do), MFA (multi-factor), SSO (single sign-on), Session (authenticated state)
**Tags:** security, auth

### Authorization
**Definition:** The process of determining what an authenticated user is allowed to do — which resources they can access, which actions they can perform.
**Usage:** Second step after authentication: determine permissions. Distinguish from Authentication (who you are) — Authorization decides access levels.
**Related:** Authentication (who you are), RBAC (role-based access), ABAC (attribute-based access), Policy (authorization rules)
**Tags:** security, auth

### OAuth 2.0
**Definition:** An authorization framework that allows third-party applications to obtain limited access to a user's resources without exposing credentials, using tokens.
**Usage:** Use for delegating access — "this app can access your calendar." OAuth 2.0 is about authorization, not authentication. Flows: Authorization Code (most secure), PKCE (mobile), Client Credentials (machine-to-machine).
**Related:** OIDC (identity layer on top), JWT (token format), Authorization Code (the main flow), Scopes (permission boundaries)
**Tags:** security, auth, oauth

### OIDC (OpenID Connect)
**Definition:** An identity layer built on top of OAuth 2.0, providing authentication (verifying identity) in addition to authorization.
**Usage:** Use when you need both identity verification and delegated access. OIDC adds an ID token (JWT) containing user identity claims to the OAuth 2.0 flow. Distinguish from OAuth 2.0 (authorization only) — OIDC adds authentication.
**Related:** OAuth 2.0 (the base), ID Token (identity JWT), Claims (user attributes), Discovery (/.well-known/openid-configuration)
**Tags:** security, auth, oidc

### JWT (JSON Web Token)
**Definition:** A compact, self-contained token format for securely transmitting claims between parties, digitally signed (JWS) or encrypted (JWE).
**Usage:** Use for stateless authentication (the token contains the user info, no server-side session needed), API authorization (bearer token), or secure data exchange. Distinguish from Session Token (opaque, server-stored) — JWT is self-contained.
**Related:** Bearer Token (JWT usage), JWS (signed), JWE (encrypted), Claims (token content), Expiration (token lifetime)
**Tags:** security, auth, jwt

### SSO (Single Sign-On)
**Definition:** An authentication scheme allowing a user to log in once and access multiple applications without re-entering credentials.
**Usage:** Use for enterprise environments and multi-application ecosystems. Implemented via protocols like SAML, OIDC, or CAS. Distinguish from Password Manager (fills credentials, doesn't authenticate) — SSO uses identity federation.
**Related:** SAML (SSO protocol), OIDC (SSO protocol), Identity Provider (IdP), Service Provider (SP), Federation (trust relationship)
**Tags:** security, auth, sso

### MFA (Multi-Factor Authentication)
**Definition:** An authentication method requiring two or more verification factors — something you know (password), something you have (phone), something you are (fingerprint).
**Usage:** Use to significantly reduce account takeover risk. If one factor is compromised, the attacker still needs the other(s). Distinguish from 2FA (two factors, subset of MFA).
**Related:** 2FA (two-factor), TOTP (time-based one-time password), Backup Code (fallback), Phishing-resistant (hardware-based MFA)
**Tags:** security, auth, mfa

## Web Security

### XSS (Cross-Site Scripting)
**Definition:** A vulnerability where an attacker injects malicious scripts into web pages viewed by other users, bypassing the same-origin policy.
**Usage:** Prevent by: sanitizing user input, using Content Security Policy (CSP), encoding output based on context (HTML, JS, URL), and avoiding dangerous APIs (innerHTML, eval).
**Related:** CSP (Content Security Policy), HTML Encoding (output sanitization), Stored XSS (persistent), Reflected XSS (in request), DOM-based XSS (client-side)
**Tags:** security, web, xss

### CSRF (Cross-Site Request Forgery)
**Definition:** An attack that tricks a user into performing an unwanted action on an authenticated web application by sending a forged request from a different site.
**Usage:** Prevent by: CSRF tokens (anti-forgery), SameSite cookies (Strict/Lax), or checking Origin/Referer headers. Modern frameworks include CSRF protection by default.
**Related:** SameSite (cookie attribute), CSRF Token (anti-forgery), Idempotency (safe methods), CORS (related cross-origin mechanism)
**Tags:** security, web, csrf

### SQL Injection
**Definition:** A vulnerability where an attacker inserts malicious SQL statements into application queries, potentially reading, modifying, or deleting database data.
**Usage:** Prevent exclusively by using parameterized queries/prepared statements — never concatenate user input into SQL. ORMs and query builders typically prevent SQLi when used correctly.
**Related:** Parameterized Query (the fix), ORM (prevention layer), Blind SQLi (inferential), Stored Procedure (not inherently safe)
**Tags:** security, web, sql-injection

### CSP (Content Security Policy)
**Definition:** A browser security header that restricts which sources of content (scripts, styles, images) are allowed to execute, preventing XSS and data injection attacks.
**Usage:** Use as a defense-in-depth layer against XSS. Define allowed sources via policy directives. Start with report-only mode before enforcing. Distinguish from CORS (controls API access) — CSP controls resource loading.
**Related:** XSS (the threat), Report-Only (non-blocking mode), Nonce (one-time script allowance), SRI (script integrity)
**Tags:** security, web, csp

### SameSite
**Definition:** A cookie attribute controlling when cookies are sent in cross-site requests — Strict (same site only), Lax (same site + top-level GET), None (all, requires Secure).
**Usage:** Set SameSite=Lax as the default for session cookies to prevent CSRF. SameSite=None with Secure for cross-site integrations. Distinguish from HttpOnly (prevents JS access) and Secure (HTTPS only).
**Related:** CSRF (the threat), Cookie (the attribute), HttpOnly (JS access restriction), Secure (HTTPS only)
**Tags:** security, web, samesite

### HSTS (HTTP Strict Transport Security)
**Definition:** A security header that forces browsers to communicate with the server only over HTTPS, preventing downgrade attacks and cookie hijacking.
**Usage:** Set on all production HTTPS sites. Include preload directive for browser hardcoded HTTPS list. Distinguish from HTTPS Redirect (can be intercepted) — HSTS is enforced before the first request.
**Related:** HTTPS (the protocol), TLS Downgrade (the threat), Preload (browser hardcoded list), Upgrade-Insecure-Requests (CSP directive)
**Tags:** security, web, hsts

## Cryptography

### Encryption
**Definition:** The process of encoding data so only authorized parties can decode it, using an algorithm and a key.
**Usage:** Two types: symmetric (same key for encrypt/decrypt — AES, ChaCha20) for bulk data; asymmetric (public/private key — RSA, ECC) for key exchange and signatures. Distinguish from Hashing (one-way, no key).
**Related:** Symmetric Encryption (shared key), Asymmetric Encryption (key pair), AES (symmetric standard), RSA (asymmetric standard), TLS (uses both)
**Tags:** security, cryptography, encryption

### Hashing
**Definition:** A one-way function that converts data into a fixed-size digest, with the same input always producing the same output, and no practical way to reverse it.
**Usage:** Use for password storage (with salt), data integrity verification, and fingerprinting. Distinguish from Encryption (reversible) — Hashing is one-way.
**Related:** Salt (random per-password), SHA-256 (hash function), bcrypt/Argon2 (password hashing), Collision (two inputs, same hash)
**Tags:** security, cryptography, hashing

### Salting
**Definition:** Adding a unique, random string to each password before hashing, ensuring identical passwords produce different hashes.
**Usage:** Always use when hashing passwords. Prevents rainbow table attacks and makes it harder to detect shared passwords across users. Distinguish from Peppering (application-wide secret, not stored with hash).
**Related:** Hashing (the process), Rainbow Table (attack prevented by salt), bcrypt (includes salt), Pepper (site-wide secret)
**Tags:** security, cryptography, salting

### Certificate
**Definition:** A digital document that binds a public key to an identity (domain, organization), signed by a trusted Certificate Authority (CA).
**Usage:** Use for TLS/SSL (HTTPS), code signing, document signing, and email encryption. Browsers trust certificates signed by recognized CAs. Distinguish from Self-Signed (not trusted by browsers, for internal use).
**Related:** CA (Certificate Authority), TLS (uses certificates), Chain of Trust (CA hierarchy), Let's Encrypt (free CA)
**Tags:** security, cryptography, certificate

## Threat Modeling

### Threat Modeling
**Definition:** A structured approach to identifying, documenting, and mitigating security threats in a system, typically performed during design.
**Usage:** Use early in design to find security issues before they're expensive to fix. Common frameworks: STRIDE (Microsoft), PASTA, Attack Trees. Distinguish from Penetration Testing (attacks the running system) — Threat Modeling is design-time.
**Related:** STRIDE (threat categories), Attack Surface (exposed points), Mitigation (the fix), Risk Assessment (likelihood + impact)
**Tags:** security, threat-modeling

### STRIDE
**Definition:** A threat classification framework: Spoofing (fake identity), Tampering (modify data), Repudiation (deny action), Information Disclosure (leak data), Denial of Service (disrupt service), Elevation of Privilege (gain unauthorized access).
**Usage:** Use as a checklist during threat modeling to ensure all threat types are considered. Each threat category maps to a security property (Authentication, Integrity, Non-repudiation, Confidentiality, Availability, Authorization).
**Related:** Threat Modeling (the process), Attack Surface (entry points), CIA Triad (Confidentiality, Integrity, Availability)
**Tags:** security, threat-modeling, stride

### Zero Trust
**Definition:** A security model that assumes no entity (inside or outside the network) is trustworthy by default, requiring verification for every access request.
**Usage:** Apply to modern, perimeter-less architectures (cloud, remote work). Every request must be authenticated, authorized, and encrypted. Distinguish from Perimeter Security (trusts inside network) — Zero Trust trusts nothing.
**Related:** Least Privilege (access principle), Micro-segmentation (network isolation), BeyondCorp (Google's zero trust), IAM (identity management)
**Tags:** security, zero-trust

### Least Privilege
**Definition:** A security principle where a user, process, or system is granted only the minimum permissions necessary to perform its function.
**Usage:** Apply to all access control decisions. Start with no access, grant only what's needed. Reduces blast radius of compromised accounts. Distinguish from Need to Know (information access, not action access).
**Related:** Zero Trust (broader model), RBAC (implementation), Blast Radius (what's at risk), Just-in-Time (temporary elevation)
**Tags:** security, least-privilege

### Defense in Depth
**Definition:** A security strategy using multiple layers of defense so that if one layer fails, another layer is in place to stop the attack.
**Usage:** Apply at all levels — network firewalls, application security, authentication, encryption, monitoring, access controls. No single security measure is sufficient alone.
**Related:** Layered Security (same concept), Security Controls (the layers), Belt and Suspenders (redundant protections)
**Tags:** security, defense-in-depth

### Vulnerability
**Definition:** A weakness in a system that could be exploited by an attacker to compromise security — a bug, misconfiguration, or design flaw.
**Usage:** Identify via scanning, testing, and threat modeling. Severity is typically rated using CVSS (Common Vulnerability Scoring System). Distinguish from Exploit (code that takes advantage of a vulnerability) and Threat (the potential attacker).
**Related:** CVE (Common Vulnerabilities and Exposures), CVSS (severity score), Zero-Day (unpatched vulnerability), Patch (the fix)
**Tags:** security, vulnerability
