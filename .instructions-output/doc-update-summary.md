# Documentation Update Summary

## Date: 2024-12-19

## Todo IDs Addressed
- `doc-cli-playbook` ✅
- `cli-config-defaults` ✅
- `fleet-adoption` ✅
- `mcp-decision-guide` ✅

## Changes Made

### 1. Created Comprehensive CLI Adoption Playbook
**File:** `docs/copilot-cli-playbook-new.md`  
**Status:** NEW - Current team playbook

**Sections Added:**
- **Default Operating Model**
  - Three-phase workflow: Plan-first → Fleet mode → Custom agents as subagents
  - Config defaults (user-level and repo-level instructions)
  - Why CLI over VS Code (and vice versa)

- **Remote Control: Discord + ACP-Based Permissions**
  - Architecture overview (CLI in ACP mode + Discord bot + session tracker)
  - Setup steps for running multiple remote sessions
  - Discord command reference
  - Safety considerations for sandbox environments
  - Tracking multiple concurrent sessions with approve/deny per session

- **MCP Decision Guide**
  - Default posture: "None unless use case"
  - When to use MCP (discovery, scoped updates) vs when not to (IaC, production)
  - Provider decision matrix (Supabase, Firebase, Vultr, Cloudflare)
  - Short decision flow diagram
  - Security defaults

- **Testing Readiness**
  - CLI workflow for E2E and integration tests
  - Known-safe test commands (allowlist)
  - Hang prevention (dangerous patterns vs safe patterns)
  - E2E environment setup
  - Command policy integration (references agent-hooks.md)
  - Baseline deny list and allow list (conceptual)

- **Safety Posture**
  - Default safety model (allow basics, deny dangerous)
  - Four permission layers (user approval, allowlists/denylists, agent hooks, sandbox)
  - YOLO mode guidance (use sparingly, in sandbox only)
  - Path permissions
  - Secrets management

- **Custom Agents and Skills**
  - Where agents live (repo-level vs user-level)
  - Four methods for using custom agents
  - Subagent behavior
  - Installation instructions

- **Practical Adoption Steps**
  - 4-phase rollout plan (individual trial → repo setup → remote control → team rollout)
  - Success criteria for each phase

- **Monitoring and Observability**
  - Session state tracking
  - Sharing sessions
  - Delegation to Copilot coding agent
  - Discord integration (custom)

- **Troubleshooting**
  - Common issues and solutions

- **Appendix**
  - Quick reference commands
  - Permission flags
  - Configuration file locations

### 2. Archived Original Q&A Document
**File:** `docs/copilot-cli-vs-vscode-agent.md`  
**Status:** ARCHIVED - Now redirects to new playbook

**Changes:**
- Updated frontmatter: `status: archived`
- Added redirect notice to new playbook
- Preserved original content for reference
- Clearly indicates superseded status

### 3. Created Minimal Archive Stub
**File:** `docs/copilot-cli-vs-vscode-agent-archive.md`  
**Status:** STUB - Placeholder for archive

## Key Design Decisions

### 1. Default Operating Model
- **Plan-first workflow** reduces wasted iterations
- **Fleet mode** for parallel execution of independent workstreams
- **Custom agents as subagents** for specialized work with separate contexts

### 2. Remote Control
- Based on ACP (Agent Client Protocol) server mode
- Discord as the remote interface (mobile-friendly)
- Session tracker maintains state for multiple concurrent sessions
- Approve/deny permissions per session
- Must run in sandbox (VM/container/Codespace)

### 3. MCP Posture
- **Default: None** unless there's a specific use case
- Only enable providers when needed, disable when done
- Good for: discovery, scoped updates, metadata operations
- Not good for: large changes (use Terraform), production mutations (manual review)
- Security defaults: non-prod projects, read-only tokens, project scoping

### 4. Testing Readiness
- Test commands must be non-interactive and bounded (no watch modes)
- Explicit allowlist of known-safe test commands
- Hang prevention rules (no watch, no interactive, no background)
- E2E environment must be scripted and reproducible
- Integration with agent hooks for command policy enforcement

### 5. Safety Posture
- Allow lots of basic commands by default (reads, status, lint, test, build)
- Deny dangerous operations (destructive, git remote writes, GitHub ops, production access)
- Four permission layers: user approval, allowlists/denylists, agent hooks, sandbox
- YOLO mode only in sandbox, with selective denies still in place
- Command policy details referenced in agent-hooks.md (not duplicated)

## Integration Points

### References to Other Docs
- `agent-hooks.md` - Command policy enforcement details
- `mcp-workflow.md` - Detailed MCP provider configuration
- `security-model.md` - Overall security model
- `agents-vs-skills.md` - When to use agents vs skills

### Cross-Links
- All references updated to point to new playbook
- Archive file provides clear redirect
- Related docs listed in frontmatter

## Files Modified

1. **Created:**
   - `docs/copilot-cli-playbook-new.md` (27,750 characters)
   - `docs/copilot-cli-vs-vscode-agent-archive.md` (314 characters)

2. **Updated:**
   - `docs/copilot-cli-vs-vscode-agent.md` (archived with redirect)

## Validation

### Frontmatter Compliance
✅ All files have required YAML frontmatter
✅ `created` dates preserved for existing files
✅ `updated` dates set to 2024-12-19
✅ `category` and `status` fields correct
✅ `tags` and `related` fields populated

### Content Coverage
✅ Default operating model (plan → fleet → agents)
✅ Remote control (Discord + ACP + multi-session tracking)
✅ MCP decision guide (default: none unless use case)
✅ Testing readiness (E2E, known-safe commands, hang prevention)
✅ Safety posture (allow basics, deny dangerous, conceptual policy)

### Link Safety (Best Effort)
✅ Internal links to agent-hooks.md, mcp-workflow.md, security-model.md
✅ External links to GitHub docs
✅ Archive file redirects to new playbook
✅ No broken relative links detected

## SQL Updates Required

```sql
-- Mark all four todos as done
UPDATE todos SET status='done' WHERE id IN (
  'doc-cli-playbook',
  'cli-config-defaults',
  'fleet-adoption',
  'mcp-decision-guide'
);
```

## Next Steps

1. **Team Review:**  
   Share `docs/copilot-cli-playbook-new.md` with team for feedback

2. **Pilot Testing:**  
   Follow Phase 1-2 adoption steps with 1-2 team members

3. **Remote Control POC:**  
   Build Discord bot bridge for ACP-based remote control

4. **Agent Installer:**  
   Create `scripts/install-cli-assets.sh` to sync agents/skills to user config

5. **Ongoing:**  
   Update playbook as CLI evolves (currently in preview)

---

**Documentation Agent:** Completed successfully  
**Status:** Ready for team adoption
