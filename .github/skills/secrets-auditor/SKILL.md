---
name: secrets-auditor
description: "Secret and credential detection. Scans for exposed API keys, passwords, and sensitive data. Use this when asked to check for secrets, scan for credentials, audit security, or detect exposed sensitive data. Triggers on:"secrets", "credentials", "leaked", "api key", "secret scanning"."
---

# Secrets Auditor Skill

## Purpose
Detect potential secrets, API keys, and credentials committed to the codebase.

## Checks
1.  **Environment Files**: Check if `.env` files are present and not ignored.
2.  **Keywords**: Search for:
    - `API_KEY`
    - `SECRET`
    - `PASSWORD`
    - `TOKEN`
    - `Bearer `
    - `ghp_` (GitHub tokens)
3.  **Hardcoded Values**: Look for high-entropy strings assigned to the above keywords in code files (ignore `.example` or `.template` files).

## Verification
- If a match is found, verify it is not a placeholder (e.g., "your-key-here").




