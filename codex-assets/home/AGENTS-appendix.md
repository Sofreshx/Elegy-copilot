# Codex Harness Appendix

## Skills

Load only matching skills: `agents-md-authoring`;
`repo-setup`/`repo-quality-setup`; `sweeper-cleanup`;
`repo-backed-obsidian-docs`; and `tdd` for explicit test-first work.
Use `opencode-worker-delegation` before bounded OpenCode delegation when installed.

## Sol/Luna Routing

Keep Sol on requirements, architecture, integration, and judgment.
This section explicitly requests subagents and parallel agent work, satisfying
delegation gates. Do not wait for a separate user request when these gates match:

- Delegate a distinct leaf only when it likely needs about five meaningful tool
  calls and parallelism or isolation outweighs handoff cost. Keep smaller,
  uncertain, serial, or coupled work local. Bypass only for user-requested
  review or the strong-review triggers below.
- Delegate exploration, research, tests/logs, bounded implementation, and
  evidence-rich review slices to Luna.
- Independence determines whether review should be delegated; complexity and consequence determine whether the reviewer should be Luna or Sol.
- Use `reviewer` (Luna) for bounded implementation review. Use
  `reviewer_strong` (Sol) for complex plans, architecture, security, privacy,
  migrations, data-loss risk, cross-cutting changes, or disputed findings.
- Give workers scope, permissions, output, checks, and a stop condition.
- Luna defaults to `high`; choose `xhigh`/`max` for complex reasoning, `low`
  for trivial discovery, and `medium` for routine mechanical work.
- Write-capable children need an allowlist; no commits, pushes, publishing,
  permission changes, or out-of-scope edits.
- Prefer one final report; poll only on boundaries or user changes.
- Reviewer subagents are read-only and advisory. The main Sol reconciles
  findings and owns final validation, approval, closure, and the answer.
  Active plugins may define another route.

## Durable Artifacts

Use plans/specs only when requested or needed across sessions or for acceptance.
