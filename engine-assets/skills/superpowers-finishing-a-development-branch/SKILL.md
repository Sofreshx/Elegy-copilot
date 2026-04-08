---
name: superpowers-finishing-a-development-branch
description: Use when implementation is complete and dedicated validation evidence is ready, and you need to decide how to integrate the work - guides completion of development work by presenting structured options for merge, PR, or cleanup
---

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify closure evidence through validation governance → Present options → Execute choice → Clean up.

**Announce at start:** "I'm using the finishing-a-development-branch skill to complete this work."

## The Process

### Step 1: Review Validation Evidence

**Before presenting options, review the latest dedicated validation evidence and closure requirements:**

- Identify which validation layers were required for this work using:
  - `docs/system/validation-governance.md`
  - `docs/system/testing-quality-governance.md`
- Confirm the latest pass/fail signal came from a validation-specific lane or coordinator.
- Confirm any direct test command was executed by that validation lane as its narrow execution mechanism, not by an implementation/controller lane claiming closure on its own.
- If tests changed, confirm the evidence still preserves meaningful confidence rather than only showing green output from weakened coverage.
- Record any explicit coverage gaps or limitations that must be carried into closure.

**Never treat raw generic direct test commands plus green output as enough to finish** unless they were run inside the dedicated validation lane and returned as that lane's evidence.

**If required validation is missing, failing, or only backed by self-reported green output:**

```
Cannot finish yet. Validation evidence is not sufficient for closure:

- Required validation: <unit / integration / e2e / browser>
- Current evidence: <what actually exists>
- Gap: <missing runner evidence, failing results, or quality concern>

Route the required scope through the validation runner/coordinator before proceeding.
```

Stop. Don't proceed to Step 2.

**If required validation evidence is explicit and acceptable:** Continue to Step 2.

### Step 2: Determine Base Branch

```bash
# Try common base branches
git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null
```

Or ask: "This branch split from main - is that correct?"

### Step 3: Present Options

Present exactly these 4 options:

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

**Don't add explanation** - keep options concise.

### Step 4: Execute Choice

#### Option 1: Merge Locally

```bash
# Switch to base branch
git checkout <base-branch>

# Pull latest
git pull

# Merge feature branch
git merge <feature-branch>

# Request post-merge validation through the dedicated validation lane/coordinator
# using the narrowest required scope for the merged result

# If required post-merge validation passes
git branch -d <feature-branch>
```

Then: Cleanup worktree (Step 5)

#### Option 2: Push and Create PR

```bash
# Push branch
git push -u origin <feature-branch>

# Create PR
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-3 bullets of what changed>

## Validation Requirements
- <unit / integration / e2e requirement and why>

## Tested Coverage
- <dedicated validation-runner evidence actually executed>

## Coverage Gaps
- <none / explicit remaining gap or limitation>
EOF
)"
```

Then: Cleanup worktree (Step 5)

#### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

**Don't cleanup worktree.**

#### Option 4: Discard

**Confirm first:**

```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>
- Worktree at <path>

Type 'discard' to confirm.
```

Wait for exact confirmation.

If confirmed:

```bash
git checkout <base-branch>
git branch -D <feature-branch>
```

Then: Cleanup worktree (Step 5)

### Step 5: Cleanup Worktree

**For Options 1, 2, 4:**

Check if in worktree:

```bash
git worktree list | grep $(git branch --show-current)
```

If yes:

```bash
git worktree remove <worktree-path>
```

**For Option 3:** Keep worktree.

## Quick Reference

| Option           | Merge | Push | Keep Worktree | Cleanup Branch |
| ---------------- | ----- | ---- | ------------- | -------------- |
| 1. Merge locally | ✓     | -    | -             | ✓              |
| 2. Create PR     | -     | ✓    | ✓             | -              |
| 3. Keep as-is    | -     | -    | ✓             | -              |
| 4. Discard       | -     | -    | -             | ✓ (force)      |

## Common Mistakes

**Skipping validation review**

- **Problem:** Finish based on raw green output that bypassed the validation lane
- **Fix:** Always confirm required validation evidence and any coverage gaps before offering options

**Open-ended questions**

- **Problem:** "What should I do next?" → ambiguous
- **Fix:** Present exactly 4 structured options

**Automatic worktree cleanup**

- **Problem:** Remove worktree when might need it (Option 2, 3)
- **Fix:** Only cleanup for Options 1 and 4

**No confirmation for discard**

- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

## Red Flags

**Never:**

- Proceed with failing or missing required validation
- Treat implementer/controller-reported "tests passed" as closure evidence
- Merge without post-merge validation when the merged result still needs proof
- Delete work without confirmation
- Force-push without explicit request

**Always:**

- Verify required validation evidence before offering options
- Carry validation requirements, evidence, and gaps into the closure summary or PR body
- Present exactly 4 options
- Get typed confirmation for Option 4
- Clean up worktree for Options 1 & 4 only

## Integration

**Called by:**

- **subagent-driven-development** - After all tasks complete and final validation evidence is assembled
- **executing-plans** - After all tasks complete and closure consumes validation-runner evidence rather than raw green output

**Pairs with:**

- **using-git-worktrees** - Cleans up worktree created by that skill
