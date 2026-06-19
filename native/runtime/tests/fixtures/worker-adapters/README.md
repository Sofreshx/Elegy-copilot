# Worker adapter conformance fixtures

Local fake protocols cover:

- Codex cold dispatch and logical-session resume.
- OpenCode ACP initialize, new/resume, update, and prompt completion ordering.
- Test-local variants cover malformed output, cancellation, timeout, and unavailable executables.

They do not invoke external model services.
