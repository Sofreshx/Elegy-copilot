---
schema: task/v1
id: task-000414
title: "Implement artifact sync to repo/relay"
type: feature
status: done
priority: medium
owner: lolzi
skills: ["terraform"]
depends_on: ["task-000413"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Push agent results (plans, tasks, logs, generated code) back to the repository or relay service after cloud-based agent sessions complete. This ensures mobile users can view the artifacts produced by agent runs in Codespaces or GitHub Actions workflows.

Supports multiple sync strategies:
- **Commit to branch** - Push results directly to a feature branch
- **Create PR** - Auto-create pull request with agent changes
- **Push to relay** - Send artifacts to relay for mobile viewing (no repo commit)

The sync strategy should be configurable per session, with sensible defaults (e.g., read-only agents → relay only, feature creators → create PR).

**Related Files:**
- `.instructions/` - Task files, plans, logs to sync
- `.instructions-output/` - Session artifacts, reports
- Plan artefact: `.instructions/artefacts/mobile-companion-PLAN-artefact.md`
- Codespaces integration: `task-000413`

**Key Requirements:**
- Results committed to feature branch (configurable)
- Optional auto-create PR for agent changes
- Artifact metadata sent to relay service
- Mobile can view/download artifacts via relay
- Support for multiple file types (markdown, code, logs)

## Acceptance Criteria

- [ ] Results committed to feature branch (naming: `agent/{session_id}` or `agent/{agent_name}/{timestamp}`)
- [ ] Optional auto-create PR with agent summary in description
- [ ] Artifact metadata sent to relay (file list, sizes, timestamps)
- [ ] Mobile can view artifacts via relay API
- [ ] Support for markdown, code, logs, JSON files
- [ ] Git commit message includes session ID and agent name
- [ ] Error handling for merge conflicts or push failures
- [ ] Large file handling (warn if artifact > 10MB, skip if > 50MB)
- [ ] Diff preview available in mobile app

## Plan / Approach

1. **Implement artifact collection**:
   - Scan `.instructions/` and `.instructions-output/` for new/modified files
   - Filter by session ID or timestamp
   - Categorize by file type (tasks, plans, logs, code)

2. **Git operations**:
   - Create feature branch: `agent/{agent_name}/{session_id}`
   - Stage modified files
   - Commit with descriptive message (include session ID, agent, summary)
   - Push to origin

3. **PR creation (optional)**:
   - Use GitHub API: `POST /repos/{owner}/{repo}/pulls`
   - Title: `[Agent] {agent_name}: {brief_summary}`
   - Body: Session details, file list, acceptance criteria
   - Assign to user who triggered session

4. **Relay sync**:
   - POST artifact metadata to relay: `{ session_id, files: [{path, size, type, url}] }`
   - Upload file contents for preview (markdown, logs)
   - Generate presigned URLs for code files (if large)

5. **Mobile artifact viewer**:
   - Display file list grouped by type
   - Inline preview for markdown/logs
   - Syntax-highlighted code preview
   - Download button for all files

6. **Testing**:
   - Test branch creation and push
   - Test PR creation with valid/invalid inputs
   - Test relay sync with various file types
   - Test large file handling (skip, warn)
   - Test merge conflict scenario

## Attempts / Log

_No attempts yet_

## Failures

_None yet_

## Notes / Discoveries

**Branch Naming:**
- Pattern: `agent/{agent_name}/{session_id}`
- Example: `agent/executive2-planner/sess_20260201_143022`
- Cleanup: Delete branch after PR merged or 30 days

**Commit Messages:**
- Format: `[Agent] {agent_name}: {summary}\n\nSession: {session_id}\n{detailed_log}`
- Example: `[Agent] debugger: Fix null reference in PaymentService\n\nSession: sess_123\nFixed NullReferenceException by adding null check...`

**PR Template:**
- Title: `[Agent] {agent_name}: {summary}`
- Labels: `agent`, `automated`, priority label
- Body sections: Summary, Files Changed, Acceptance Criteria, Validation Steps
- Auto-assign to session initiator

**File Size Limits:**
- Warn if file > 10MB (likely log spam)
- Skip if file > 50MB (GitHub file size limit)
- Offer split/compression for large files

**Sync Strategies by Agent Type:**
- **Read-only agents** (debugger, code-explorer): Relay only (no commit)
- **Planning agents** (executive2-planner): Commit plans to `.instructions/`, relay summary
- **Code generators** (feature-creator): Create PR with code changes
- **Test agents** (test-runner): Commit test results, relay coverage report

**Merge Conflict Handling:**
- If push fails due to conflicts, create PR anyway (mark as "needs manual merge")
- Notify user via mobile push notification
- Provide diff view in mobile app

**Security:**
- Never commit secrets or API keys (scan before commit)
- Validate file paths (no directory traversal)
- Sanitize commit messages (no injection attacks)

## Next Steps

1. Implement artifact collection from `.instructions/` and `.instructions-output/`
2. Add Git operations (branch, commit, push)
3. Implement PR creation via GitHub API
4. Add relay sync for artifact metadata
5. Build mobile artifact viewer UI
6. Add integration tests for all sync strategies
7. Document sync strategies in mobile app settings
