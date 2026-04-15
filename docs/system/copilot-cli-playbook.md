---
created: 2024-01-15
updated: 2026-02-23
category: system
status: current
doc_kind: node
id: copilot-cli-playbook
summary: Default operating model for adopting Copilot CLI, including plan/fleet workflows, safety, and testing guidance.
tags: [copilot-cli, adoption, workflow, playbook, fleet, remote-control]
related: [agent-hooks, mcp-workflow, security-model]
---

# Copilot CLI Adoption Playbook

> **Audience:** Team members adopting Copilot CLI as the default operating model for AI-assisted development.
> 
> **Status:** GitHub Copilot CLI is **in public preview** and subject to change.
> 
> **Source:** https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli

## Purpose

This playbook defines the **default operating model** for adopting Copilot CLI across the team. It covers:
- The plan-first workflow: plan mode → fleet mode → custom agents as subagents
- Remote control via Discord with ACP-based approve/deny permissions
- MCP decision guide (default: none unless use case)
- Testing readiness (e2e/integration with Playwright, known-safe commands, hang prevention)
- Safety posture (allow basics, deny dangerous operations)

---

## Default Operating Model

### The Three-Phase Workflow

Our standard approach for Copilot CLI work is:

Useful maintenance helpers:
- orchestrator closure — the flagship orchestrator owns the “is anything left to do?” judgment and may use fast repo/status checks as evidence

**Phase 1: Plan-First (Copilot CLI Plan Mode)**
- Always start with `/plan [goal]` or Shift+Tab to enter plan mode
- Let Copilot analyze the problem space and propose a structured plan
- Review the plan before proceeding to implementation
- Use `/diff` and `/review` to validate changes before committing

**Phase 2: Fleet Mode for Parallel Execution**
- For multi-stream work, use `/fleet [prompt]` to enable parallel subagent execution
- Use `/tasks` to monitor and manage background tasks
- Each subagent runs with its own context window, keeping the main session focused

**Phase 3: Custom Agents as Subagents**
- Delegate specialized work to custom agents (security audits, documentation, testing)
- Agents run as subagents with separate contexts
- Explicitly invoke with `/agent [name]` or let Copilot infer from context

**Why This Order:**
- Planning first reduces wasted iterations and gives you a checkpoint
- Fleet mode parallelizes independent workstreams
- Custom agents provide domain expertise without polluting the main context

Sources:
- Plan mode: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
- Fleet mode and subagents: `copilot help commands` (local CLI help)
- Custom agents: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli

### Config Defaults

**User-Level Defaults (`~/.copilot/copilot-instructions.md`):**
```markdown
## Default Workflow
- Plan first: always start with `/plan` before coding
- Use `/diff` and `/review` before committing
- Run narrowest relevant validation (lint/tests/build)
- Ask before architecture changes

## Safety
- Never introduce secrets
- Avoid destructive commands unless explicitly requested
- No background processes or watch modes

## Quality
- Keep code consistent with existing patterns
- No new dependencies unless justified
```

**Repo-Level Instructions (`.github/copilot-instructions.md`):**
- Customize build/test commands per repo
- Add project-specific validation steps
- Define team coding standards

Initialize with: `copilot init`

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/add-custom-instructions

---

## Why Copilot CLI Over VS Code Agent Mode

### What CLI Wins At

Copilot CLI is better for:
- **Terminal-native workflows:** build/test/lint/git/containers
- **Permissioned execution:** explicit approvals or allowlists for tool execution
- **Multi-repo work:** start from parent folder, add directories as needed
- **Plan-driven workflows:** fast iteration with structured planning
- **Lighter weight:** no full IDE overhead for many tasks
- **Parallel execution:** fleet mode for independent workstreams

### What VS Code Still Wins At

VS Code agent mode is better for:
- Rich IDE context (open editors, diagnostics, quick-fix UI)
- Interactive refactors driven by language server
- Tight edit/preview loops for UI work
- Single integrated environment for edit/run/debug

### Quality Is About Workflow, Not Tool

Quality differences come from:
- The model you select (`/model`)
- How well your instructions are written
- Following "explore → plan → code → verify" workflow

Both CLI and VS Code support the same core capabilities: plan mode, code review, task agents, skills injection, and fleet mode.

Sources:
- CLI vs VS Code comparison: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
- Model selection: https://docs.github.com/en/copilot/reference/cli-command-reference

---

## Remote Control: Discord + ACP-Based Permissions

### Overview

Run Copilot CLI sessions remotely and control them via Discord, with approve/deny permissions for each tool execution. This enables:
- Monitoring multiple active CLI sessions from your phone
- Sending prompts remotely
- Approving or denying tool calls per session
- Tracking session state and progress

### Architecture

**Components:**
1. **Copilot CLI in ACP server mode** (`copilot --acp --port 3000`)
2. **Discord bot** that bridges Discord messages to ACP sessions
3. **Session tracker** that maintains state for multiple concurrent sessions
4. **Permission middleware** that enforces approve/deny rules per session

**ACP (Agent Client Protocol):**
- Copilot CLI exposes session updates via ACP
- Streaming chunks, tool permission requests, and results flow over ACP
- Standard protocol enables custom clients/UIs

Source: https://docs.github.com/en/copilot/reference/acp-server

### Setup Steps

**1. Start Copilot CLI in ACP Mode**

```bash
# In your sandbox VM or container
copilot --acp --port 3000 --allow-all-tools
```

**2. Configure Discord Bot**

```javascript
// Bot receives messages from Discord and forwards to ACP
const discordBot = new DiscordBot({
  token: process.env.DISCORD_BOT_TOKEN,
  channelId: process.env.DISCORD_CHANNEL_ID
});

discordBot.on('message', async (msg) => {
  // Extract session ID from message or create new session
  const sessionId = extractSessionId(msg) || createSession();
  
  // Forward prompt to ACP
  await acpClient.sendPrompt(sessionId, msg.content);
});
```

**3. Handle Tool Approvals**

```javascript
// ACP client receives tool permission requests
acpClient.on('toolPermissionRequest', async (sessionId, tool) => {
  // Post to Discord for approval
  const approval = await discordBot.requestApproval(sessionId, tool);
  
  // Send approval/denial back to ACP
  await acpClient.respondToPermission(sessionId, approval);
});
```

**4. Track Multiple Sessions**

```javascript
// Session tracker maintains state
const sessionTracker = {
  activeSessions: new Map(),
  
  createSession: (userId, channelId) => {
    const sessionId = generateId();
    activeSessions.set(sessionId, {
      userId,
      channelId,
      startedAt: Date.now(),
      pendingApprovals: []
    });
    return sessionId;
  },
  
  getSession: (sessionId) => activeSessions.get(sessionId)
};
```

### Discord Commands

```
/copilot start [prompt]     - Start new CLI session with prompt
/copilot prompt [id] [msg]  - Send prompt to existing session
/copilot approve [id]       - Approve pending tool execution
/copilot deny [id]          - Deny pending tool execution
/copilot sessions           - List active sessions
/copilot status [id]        - Get session status
/copilot stop [id]          - Stop session
```

### Safety Considerations

**Run in Sandbox:**
- Use dedicated VM, container, or GitHub Codespace
- Isolate from production credentials and real repos
- Assume ACP endpoint is sensitive—protect it (VPN, auth)

**Default Posture:**
- Require approval for all tool executions by default
- Use allowlists sparingly (basic commands only)
- Deny dangerous operations (see Safety Posture section)

**Session Isolation:**
- Each session runs in its own working directory
- Limit path permissions per session
- Avoid shared state between sessions

**Audit Everything:**
- Log all prompts, tool calls, and approval decisions
- Track who initiated each session
- Monitor for suspicious patterns

Source: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli#risk-mitigation

---

## MCP Decision Guide

### Default Posture: None Unless Use Case

**Rule:** Do not enable MCP providers by default. Only enable specific providers when you have a clear use case.

**Why:**
- MCP providers add surface area (more tools, more permissions)
- Each provider requires secrets/credentials management
- Not all work needs external service integration
- Prefer local tools and filesystem operations when possible

### When to Use MCP

**Good Use Cases:**
- **Discovery:** Need to inspect Supabase schemas or Vultr instance metadata
- **Scoped updates:** Small, targeted changes to Firebase auth rules or Supabase RLS policies
- **Metadata operations:** Read-only queries for planning or documentation
- **Agent-driven exploration:** Let an agent discover available resources

**Poor Use Cases:**
- **Large infrastructure changes:** Use Terraform instead
- **Production data mutations:** Use manual, reviewed workflows
- **Repeatable deployments:** Use IaC (Infrastructure as Code)
- **Bulk operations:** Use dedicated tools or scripts

### MCP Provider Decision Matrix

| Provider | Use For | Don't Use For |
|----------|---------|---------------|
| **Supabase** | Schema inspection, RLS policy review | Production data mutations |
| **Firebase** | Auth rule discovery, Firestore schema | Large config changes |
| **Vultr** | Instance details, resource discovery | VPC creation, load balancers |
| **Cloudflare** | N/A (use Terraform/wrangler) | Deployments |

### Enabling MCP Providers

Only enable when needed for current task:

```bash
# Via Skill Installer sidebar (VS Code)
Operations → MCP Providers → Enable [Provider]

# Store secrets outside repo
~/.config/instruction-engine/mcp.env
```

Disable when done:
```bash
Operations → MCP Providers → Disable [Provider]
```

**Security Defaults:**
- Non-production projects only
- Read-only tokens when possible
- Project-level scoping (not account-level)
- Manual approval for tool calls
- Never commit tokens to repo

### Short Decision Flow

```
Need external service integration?
├─ No → Use local tools, skip MCP
└─ Yes
   ├─ Discovery/metadata only? → Enable MCP with read-only token
   ├─ Small, scoped change? → Enable MCP, review before approve
   ├─ Large/repeatable change? → Use Terraform/IaC instead
   └─ Production impact? → Manual workflow, not MCP
```

**For more MCP details, see:** [mcp-workflow.md](./mcp-workflow.md)

---

## Testing Readiness

### CLI Workflow for E2E and Integration Tests

Copilot CLI can drive test execution, but requires proper setup to avoid hangs and ensure safe command execution.

### Basic Test Commands (Known-Safe)

**Copy/paste: known-safe, non-interactive test commands (designed to pass our hook deny rules):**

```bash
# Playwright (non-UI / headless)
npx playwright test --headed=false
npx playwright test --project=chromium --headed=false

# Vitest (non-interactive)
npx vitest run --reporter=verbose
npm test -- --run --reporter=verbose

# Jest (non-interactive)
npx jest --watch=false --ci

# .NET (avoid restore prompts/hangs)
dotnet test YourProject.Tests.csproj --no-restore --logger trx
```

**Key safety requirement:** All test commands must be **non-interactive** and **bounded** (no watch modes, no hanging processes).
If you are running via an agent tool (e.g., `run_in_terminal`), set a non-zero `timeout` and never use background execution.

### Hang Prevention

**Dangerous patterns to avoid:**

```bash
# ❌ Watch modes (never exit)
npm test -- --watch
jest --watch
playwright test --ui

# ❌ Interactive modes
npm run test:interactive
npx playwright test --debug

# ❌ Background processes
npm start &
node server.js &

# ❌ Unbounded waits
tail -f logs.txt
watch "npm test"
```

**Safe patterns:**

```bash
# ✅ One-shot tests with timeout
npm test -- --timeout=30000
npx playwright test --max-failures=5

# ✅ Explicit non-watch mode
jest --watch=false

# ✅ Explicit headless mode
playwright test --headed=false
```

### Copilot CLI Test Workflow

**Step 1: Add test commands to repo instructions**

`.github/copilot-instructions.md`:
```markdown
## Validation Commands
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- E2E tests: `npx playwright test --headed=false`
- Lint: `npm run lint`
- Build: `npm run build`

## Test Safety
- All test commands run in non-interactive mode
- No watch modes or background processes
- Tests have explicit timeouts
```

**Step 2: Use plan mode for test-driven work**

```bash
# In Copilot CLI
/plan Fix the login validation bug and verify with tests

# Copilot will:
# 1. Analyze the bug
# 2. Propose changes
# 3. Run tests automatically (from instructions)
# 4. Iterate on failures
```

**Step 3: Review test output and approve**

- Copilot asks permission to run shell commands
- Review the command before approving
- Check for watch modes or dangerous patterns
- Approve if safe

**Step 4: Use fleet mode for parallel test suites**

```bash
# Run multiple test suites in parallel
/fleet Run unit tests, integration tests, and E2E tests in parallel

# Monitor with /tasks
/tasks
```

### E2E Test Environment Setup

**Prerequisites:**
- E2E environment is scripted and reproducible
- Services are running (or can be started deterministically)
- Test data is seeded and isolated
- Ports are available and not conflicting

**Example setup script (illustrative only):**

This repo does not ship `scripts/start-e2e-env.sh` / `scripts/stop-e2e-env.sh` because E2E environment setup is project-specific.
For browser automation defaults and routing, see [e2e-setup-guide.md](./e2e-setup-guide.md).

```bash
#!/bin/bash
# scripts/start-e2e-env.sh

# Start local services
docker-compose -f docker-compose.test.yml up -d

# Wait for health
./scripts/wait-for-services.sh

# Seed test data
npm run seed:test

echo "E2E environment ready"
```

**Integration with Copilot CLI:**

```markdown
## E2E Testing
Before running E2E tests:
1. Run `./scripts/start-e2e-env.sh`
2. Run either:
  - Agent-driven UI smoke checks through `@test-runner` when the orchestrator selects browser coverage, or
  - Scripted regression suite: `npx playwright test --headed=false`
3. After tests (if applicable): `./scripts/stop-e2e-env.sh`
```

### Command Policy Integration

For more detailed command policy, see [agent-hooks.md](./agent-hooks.md).

**Baseline deny list (conceptual):**
- Destructive file operations (`rm -rf`, `del /s`, etc.)
- Git operations that modify remote (`git push`, `git force-push`)
- GitHub CLI operations (`gh pr merge`, `gh release create`)
- Production access (cloud CLIs, SSH to prod)
- Package installations (unless explicitly approved)
- System modifications (installs, `sudo`, registry changes)

**Baseline allow list:**
- Read-only file operations
- Local test commands (defined in repo instructions)
- Build commands
- Lint/format commands
- Git read operations (`git status`, `git diff`, `git log`)

**Hook-based enforcement:**
Agent hooks can enforce these policies at the tool execution level. See `.github/templates/hooks.*.json` and `scripts/hooks/` for implementation.

---

## Safety Posture

### Default Safety Model

**Allow lots of basic commands by default:**
- File read operations
- Git status/diff/log (read-only)
- Test/lint/build commands
- Directory navigation
- Safe analysis tools (grep, find, cat, etc.)

**Deny dangerous operations:**
- **Destructive filesystem:** `rm -rf`, `del /s /q`, `format`, `dd`
- **Git remote writes:** `git push`, `git push --force`, `git push --delete`
- **GitHub operations:** `gh pr merge`, `gh release create`, `gh secret set`
- **Production access:** Cloud CLI write operations, SSH to production
- **System changes:** `sudo`, installs, registry edits, service modifications
- **Background processes:** `&` jobs, `nohup`, `screen`, `tmux` spawning
- **Interactive/watch modes:** `--watch`, `--ui`, `--debug`, interactive shells

### Permission Layers

**Layer 1: User Approval (Interactive)**
- Copilot CLI asks before running tools
- Review command before approving
- Deny if suspicious or dangerous

**Layer 2: Allowlists/Denylists (Configured)**
```bash
# Allow basic tools, deny dangerous ones
copilot --allow-tool 'shell(git)' \
        --deny-tool 'shell(git push)' \
        --deny-tool 'shell(rm)'
```

**Layer 3: Agent Hooks (Automated)**
- Pre-tool-use hooks intercept commands
- Enforce policy rules automatically
- Log all executions
- See [agent-hooks.md](./agent-hooks.md)

**Layer 4: Sandbox (Environment)**
- Run in disposable VM/container/Codespace
- Isolate from real credentials and repos
- Limit blast radius of mistakes

Source: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli#risk-mitigation

### YOLO Mode (Use Sparingly)

**What it is:**
```bash
copilot --yolo  # or /yolo in interactive mode
```
Enables all tools, paths, and URLs without approval.

**When to use:**
- Inside a sandbox environment only
- For exploratory work on disposable repos
- When you're actively monitoring and can kill the process

**When NOT to use:**
- On your main development machine
- With production credentials available
- On repos you care about
- Unattended (remote sessions)

**YOLO + deny list pattern:**
Even in YOLO mode, you can still deny specific commands:

```bash
copilot --yolo \
        --deny-tool 'shell(git push)' \
        --deny-tool 'shell(rm)' \
        --deny-tool 'shell(gh)'
```

This gives you "fast and loose, but not stupid" mode.

### Path Permissions

**Restrict working directory:**
```bash
# Start CLI from the repo you want to work in
cd ~/projects/my-repo
copilot

# Copilot is scoped to this directory by default
```

**Deny temp directory access (optional):**
```bash
copilot --disallow-temp-dir
```

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli#setting-path-permissions

### Secrets Management

**Never let Copilot:**
- Read `.env*` files (use agent hooks to block edits)
- Commit secrets to git
- Print secrets to stdout/logs
- Store secrets in code

**Safe practices:**
- Use GitHub Secrets for CI
- Use OS keychain for local secrets
- Use environment variables set outside the repo
- Use secret scanning tools in pre-commit hooks

See also: [security-model.md](./security-model.md)

---

## Custom Agents and Skills

### Where Agents Live

**Repo-level agents:**
`.github/agents/*.agent.md`

**User-level agents:**
`~/.copilot/agents/*.agent.md`

**Precedence:** User-level agents override repo-level agents with the same name.

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli

### Using Custom Agents

**Method 1: Explicit selection**
```bash
/agent code-reviewer
Review all authentication code in src/auth/
```

**Method 2: Let Copilot infer**
```bash
# If agent description includes trigger words
Review the security of our auth implementation
```

**Method 3: Programmatic**
```bash
copilot --agent code-reviewer --prompt "Check src/"
```

### Subagent Behavior

When a custom agent runs:
- It runs as a **subagent** with its own context window
- The main session stays focused on the original task
- Subagent results are summarized back to main session
- Fleet mode can run multiple subagents in parallel

### Installing Agents and Skills

**Recommended: installer script (keeps instruction-engine out of daily workspace)**

PowerShell (Windows):
```powershell
pwsh -File scripts/cli-install.ps1 --cli --force
```

bash (macOS/Linux):
```bash
./scripts/cli-install.sh --cli --force
```

To also set up VS Code discovery + install VS Code-only prompt files:
```powershell
pwsh -File scripts/cli-install.ps1 --all --force
```

This installs to `~/.copilot/{agents,skills,copilot-instructions.md}` and (for VS Code) `~/.copilot/prompts`.

Note: VS Code prompt files are VS Code-only; Copilot CLI uses skills + instructions instead.

### Inspecting effective prompts / context

Built-in Copilot CLI system prompts are not shipped as editable files. The parts you control are:
- `~/.copilot/agents/*.agent.md`
- `~/.copilot/skills/*/SKILL.md`
- instruction files (repo + user-level)

To inspect what VS Code actually sent (system prompt + user message + context + tool calls):
- Open **Chat Debug View** (`Developer: Show Chat Debug View`)
- Use **Chat customization diagnostics** (Chat view → right-click → Diagnostics)

### LSP (Code Intelligence) for Copilot CLI

Copilot CLI supports Language Server Protocol (LSP) for richer code intelligence. Copilot CLI does **not** bundle language servers; install them separately and configure them.

Install examples:
```bash
# TypeScript
npm install -g typescript typescript-language-server

# C# (alternative to csharp-ls)
dotnet tool install -g omnisharp

# Rust
# Install rust-analyzer (via rustup / package manager) and ensure `rust-analyzer` is on PATH
```

User-level config file: `~/.copilot/lsp-config.json`

Example:
```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileExtensions": {
        ".ts": "typescript",
        ".tsx": "typescript"
      }
    },
    "csharp": {
      "command": "omnisharp",
      "args": ["--languageserver"],
      "fileExtensions": {
        ".cs": "csharp"
      }
    },
    "rust": {
      "command": "rust-analyzer",
      "args": [],
      "fileExtensions": {
        ".rs": "rust"
      }
    }
  }
}
```

Verify in Copilot CLI:
- Start `copilot` and run `/lsp` to see configured server status.

---

## Practical Adoption Steps

### Phase 1: Individual Trial (Week 1-2)

**Goal:** Get comfortable with CLI basics

1. Install Copilot CLI: `npm install -g @github/copilot`
2. Authenticate: start `copilot` and run `/login` (or use `copilot login`)
3. Try plan mode: `copilot` then `/plan Create a simple Express API`
4. Add user-level instructions: Edit `~/.copilot/copilot-instructions.md`
5. Practice approve/deny workflow with shell commands
6. Experiment with `/diff`, `/review`, `/share`

Optional: configure LSP for richer code intelligence (see below).

**Success criteria:**
- Can run plan → implement → review workflow
- Comfortable with approval UI
- Have personal user-level instructions working

### Phase 2: Repo Setup (Week 3)

**Goal:** Prepare one repo for team use

1. Run `copilot init` in repo
2. Customize `.github/copilot-instructions.md`:
   - Add test commands
   - Add validation steps
   - Add safety rules
3. Add custom agents to `.github/agents/`
4. Test fleet mode with parallel tasks
5. Document repo-specific workflow

**Success criteria:**
- Repo instructions guide Copilot correctly
- Team members can clone and use CLI immediately
- Custom agents work as expected

### Phase 3: Remote Control Setup (Week 4-5)

**Goal:** Enable Discord-based remote control

1. Set up sandbox VM or Codespace
2. Start Copilot CLI in ACP mode
3. Build Discord bot bridge
4. Test approve/deny flow from phone
5. Add session tracking for multiple sessions
6. Document emergency stop procedures

**Success criteria:**
- Can start/monitor CLI sessions remotely
- Approval flow works from Discord
- Multiple concurrent sessions tracked correctly

### Phase 4: Team Rollout (Week 6+)

**Goal:** Get team using CLI daily

1. Share playbook with team
2. Conduct training session
3. Pair program with CLI for first few tasks
4. Gather feedback and iterate
5. Update instructions based on lessons learned
6. Document common patterns and pitfalls

**Success criteria:**
- 80%+ of team using CLI for terminal workflows
- Shared agent/skill library growing
- Reduced local machine load (for those using VMs)
- Positive feedback on productivity

---

## Monitoring and Observability

### Session State

Copilot CLI stores session state locally:

```
~/.copilot/session-state/{session-id}/
├── events.jsonl        # All events (prompts, tool calls, results)
├── workspace.yaml      # Session config
├── plan.md            # Current plan
└── ...
```

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices

### Dashboard (local-only)
This repo includes a small local dashboard for inspecting Copilot CLI state and installed assets.

- Preferred runtime: the packaged Elegy Copilot desktop app, which starts the local backend automatically
- Raw server fallback: `node copilot-ui/server.js` (or `scripts/cli-ui.ps1` / `./scripts/cli-ui.sh`)
- Observes: `~/.copilot/session-state/` + `~/.copilot/agents/` + `~/.copilot/skills/` + `~/.copilot` config files
- Actions: refresh, sync/update assets, delete/remove assets (**guarded**)
- Safety: local-only, **no auth** — don’t expose the port beyond localhost

### Sharing Sessions

```bash
# Create shareable gist
/share gist

# Get URL for phone viewing
```

### Delegation to Copilot Coding Agent

For long-running work, delegate to GitHub:

```bash
# Delegate creates a draft PR
/delegate Implement the user settings page

# Or prefix with &
& Add pagination to the API
```

Monitor PR from GitHub Mobile.

Source: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli#delegate-tasks-to-copilot-coding-agent

### Discord Integration (Custom)

Build a bridge that:
- Tails `events.jsonl` files
- Posts updates to Discord channel
- Enables remote prompt sending
- Handles approval requests

This is custom plumbing, not a first-party feature.

---

## Troubleshooting

### CLI Hangs on Command

**Symptoms:** CLI seems frozen, no output

**Causes:**
- Interactive/watch mode command
- Background process waiting for input
- Long-running process with no output

**Solutions:**
1. Ctrl+C to cancel
2. Review command before approving
3. Add timeouts to test commands
4. Use `--watch=false` flags explicitly

### Tool Permission Denied

**Symptoms:** "Permission denied" or "Tool not allowed"

**Causes:**
- Tool not in allowlist
- Deny rule blocking tool
- Path permission issue

**Solutions:**
1. Review deny rules: `copilot help permissions`
2. Add tool to allowlist: `--allow-tool 'shell(command)'`
3. Check working directory permissions

### Agent Not Found

**Symptoms:** "Agent not found" when using `/agent`

**Causes:**
- Agent file not in expected location
- Agent file has incorrect format/extension
- User-level agent overriding repo-level

**Solutions:**
1. Check agent file exists: `.github/agents/name.agent.md`
2. Verify YAML frontmatter is correct
3. Check user-level agents: `~/.copilot/agents/`
4. Restart CLI to reload agent definitions

### ACP Connection Issues

**Symptoms:** Cannot connect to ACP server

**Causes:**
- Port already in use
- Firewall blocking port
- ACP server not started

**Solutions:**
1. Check port availability: `lsof -i :3000` (macOS/Linux)
2. Use different port: `--port 3001`
3. Check firewall rules
4. Verify CLI is running in ACP mode: `--acp`

---

## Reference Links

### Official Documentation
- Copilot CLI Guide: https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli
- CLI Best Practices: https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-best-practices
- Command Reference: https://docs.github.com/en/copilot/reference/cli-command-reference
- Custom Agents: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
- ACP Server: https://docs.github.com/en/copilot/reference/acp-server
- Security & Risk Mitigation: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli#risk-mitigation

### Internal Documentation
- [agent-hooks.md](./agent-hooks.md) - Command policy enforcement
- [mcp-workflow.md](./mcp-workflow.md) - MCP provider integration
- [security-model.md](./security-model.md) - Overall security model
- [agents-vs-skills.md](./agents-vs-skills.md) - When to use agents vs skills

---

## Open Questions / Future Work

- **Fleet mode maturity:** `/fleet` is available and evolving; treat as preview and validate behavior after CLI updates
- **ACP authentication:** Best practices for securing ACP endpoints in production
- **Multi-session tracking:** Optimal patterns for managing 5+ concurrent sessions
- **Installer ergonomics:** Improve profile detection/patching for VS Code Profiles (if needed)
- **Discord bot template:** Reference implementation for remote control
- **Metrics and analytics:** What to track for productivity and safety insights

---

## Appendix: Quick Reference Commands

### Essential CLI Commands

```bash
# Interactive mode
copilot

# Plan mode
/plan [goal]
# or
copilot -p "Create an API endpoint for user profiles"

# Review changes
/diff
/review

# Fleet mode
/fleet [prompt with multiple workstreams]
/tasks  # Monitor tasks

# Agent selection
/agent [name]

# Share session
/share gist

# Delegation
/delegate [task]
# or prefix prompt with &
& Implement feature X

# Help
/help
copilot --help
```

### Permission Flags

```bash
# Allow all (YOLO)
copilot --yolo

# Allow specific tools
copilot --allow-tool 'shell(git)' --deny-tool 'shell(git push)'

# Limit available tools
copilot --available-tools shell,file_write,file_read

# Disable parallel execution
copilot --disable-parallel-tools-execution

# Disallow temp directory
copilot --disallow-temp-dir

# ACP server mode
copilot --acp --port 3000
```

### Configuration Files

```
~/.copilot/copilot-instructions.md      # User-level instructions
~/.copilot/agents/*.agent.md            # User-level agents
~/.copilot/skills/*/SKILL.md            # User-level skills
~/.copilot/prompts/*.prompt.md          # VS Code-only prompt files (installed globally)
~/.copilot/lsp-config.json              # Copilot CLI LSP (user-level)
~/.copilot/session-state/               # Session storage

.github/copilot-instructions.md         # Repo instructions
.github/agents/*.agent.md               # Repo agents
.github/skills/*/SKILL.md               # Repo skills
.github/lsp.json                        # Copilot CLI LSP (repo-level)
```

---

## Workflow Commands (Gateway)

The `/workflow` command supports discovery, execution, inspection, and history:

| Subcommand | Description | Example |
|---|---|---|
| `list` | List all available workflow templates | `/workflow list` |
| `run <name>` | Execute a workflow by name | `/workflow run deploy-prod` |
| `inspect <name>` | Show workflow definition and steps | `/workflow inspect deploy-prod` |
| `history <name>` | View recent run history for a workflow | `/workflow history deploy-prod --limit 5` |

- **inspect** shows version, description, and step DAG (including dependencies).
- **history** requires the `workflowHistory` module to be enabled in router deps. Returns entries in reverse chronological order.

---

**Last Updated:** 2026-02-28  
**Maintained By:** Instruction Engine Team  
**Status:** Living document - update as CLI evolves
