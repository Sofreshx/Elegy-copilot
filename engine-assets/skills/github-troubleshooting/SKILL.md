---
name: github-troubleshooting
description: "Inspect GitHub Actions runs, workflow jobs/logs, pull requests, issues, commits, branches, and release artifacts using the built-in CLI GitHub MCP tools or the configured workspace GitHub MCP lane. Triggers on: github actions, workflow run, job logs, CI failure, PR status, issue thread, release artifact, github troubleshooting."
---

# GitHub Troubleshooting Skill

Use this skill when the task is about understanding or troubleshooting GitHub state without asking the user to
copy/paste logs or metadata manually.

## When to Use

- GitHub Actions failures, workflow runs, job logs, or missing artifacts
- pull request status, changed files, reviews, and checks
- issue threads, labels, and backlog triage
- commit inspection, branch history, or release/download troubleshooting

## Host Routing

- **Copilot CLI sessions**: prefer the built-in `github-mcp-server` tools.
- **VS Code/workspace sessions**: prefer the configured GitHub MCP lane from `.vscode/mcp.json`.
- The CLI lane does **not** require the UI or workspace MCP patch flow.
- Always check availability first. If GitHub access is not configured, tell the user exactly how to enable it instead
  of continuing with a broken workflow.

## Default Safety Posture

- Keep GitHub access **read-only by default**.
- Do not assume write-capable automation is available.
- Never store tokens in repo files; use env-backed MCP config only.

## Recommended Flow

1. Identify the GitHub object type first: workflow run, job, artifact, PR, issue, commit, or branch.
2. Prefer targeted GitHub tools over generic web scraping when GitHub MCP is available.
3. For Actions failures:
   - inspect workflow runs
   - inspect failed jobs
   - fetch failed job logs
   - summarize root cause and next validation step
4. For PRs:
   - inspect PR details
   - inspect changed files, reviews, comments, statuses, and checks
5. For issues/backlog:
   - inspect issue state, comments, labels, and related items
6. If the task needs code changes after investigation, hand off to the appropriate implementation flow after the
   GitHub evidence is gathered.

## Output

- A concise summary of the GitHub evidence gathered
- The failing workflow/job/PR/issue identifiers when relevant
- The smallest next action needed to resolve or validate the issue
