---
created: 2026-02-23
updated: 2026-06-01
category: system
status: archived
doc_kind: node
id: agent-hooks
summary: Retired. How to use opt-in Copilot agent hooks in this repo, including safety and hang-prevention policies.
tags: [hooks, safety, retired]
---

# Agent Hooks Guide (retired)

The hook rules system has been retired as of 2026-06-01 as part of the
elegy-copilot harness meta-cleanup. elegy-copilot is a meta-harness that
installs skills and assets; it does not operate as an agent harness and
should not define hook policies.

If you need hook enforcement, that is a harness responsibility (e.g.
Copilot coding agent's own hook system, or a per-repo `.github/hooks/`
configuration maintained separately).
