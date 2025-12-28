# Example Session Transcript

This shows a complete pipeline cycle from user idea to done task.

---

## 1. User adds idea to raw.tasks.md

**User prompt:**
> "Add a user profile update endpoint"

**raw.tasks.md entry added:**
```
- [ ] ID: temp-001 | Title: Add user profile update endpoint | Source: user | Notes: need PUT /users/:id endpoint
```

---

## 2. Run Task Creator

**User prompt:**
> "Run task creator"

**Agent reads:** `raw.tasks.md`, `warnings.md`, `failed.tasks.md`, `contexts/project.patterns.md`

**Agent output:**

### Session Summary
- **Done**: Processed temp-001 from raw.tasks.md
- **Changes**: 
  - Updated [tasks.md](../tasks.md) with T-001
  - Removed temp-001 from raw.tasks.md
- **New tasks.md**: 
  | ID | Title | Priority | Agent | Mode | Status | Notes |
  |----|-------|----------|-------|------|--------|-------|
  | T-001 | Add PUT /users/:id profile update endpoint | P1 | feature.creator.agent.md | auto | pending | Validate auth, update user model fields |
- **New raw.tasks.md**: None
- **Warnings**: None
- **Next**: Run task-priority-planner to confirm ordering, or execute T-001 directly with feature.creator.agent

---

## 3. Run Task Runner (Execute T-001)

**User prompt:**
> "Execute T-001"

**Agent reads:** `tasks.md` (T-001), `warnings.md`, `contexts/project.patterns.md`, `agents/feature.creator.agent.md`

**Mode selection:** auto → shallow (no prior failures, localized endpoint addition)

**Agent actions:**
1. Created `src/Features/Users/UpdateProfileEndpoint.cs`
2. Updated `src/Features/Users/UserService.cs` with `UpdateProfile` method
3. Added `tests/Features/Users/UpdateProfileTests.cs`

**Agent output:**

### Session Summary
- **Done**: Implemented PUT /users/:id endpoint with validation and tests
- **Changes**: 
  - Created [src/Features/Users/UpdateProfileEndpoint.cs](../src/Features/Users/UpdateProfileEndpoint.cs)
  - Modified [src/Features/Users/UserService.cs](../src/Features/Users/UserService.cs)
  - Created [tests/Features/Users/UpdateProfileTests.cs](../tests/Features/Users/UpdateProfileTests.cs)
- **New tasks.md**: None
- **New raw.tasks.md**: 
  - `temp-002 | Add profile image upload support | Source: T-001 | Notes: discovered during implementation, needs S3/blob context`
- **Warnings**: None
- **Next**: Mark T-001 as done. Run task-creator to process temp-002, or continue with next priority task.

---

## 4. User confirms completion

**User prompt:**
> "Mark T-001 done and continue"

**Agent updates:** `tasks.md` → T-001 status = done

**Agent output:**

### Session Summary
- **Done**: Marked T-001 complete
- **Changes**: Updated [tasks.md](../tasks.md)
- **New tasks.md**: None
- **New raw.tasks.md**: None (temp-002 pending)
- **Warnings**: None
- **Next**: Run task-creator to process temp-002 (profile image upload)

---

## 5. Example of a Failed Task

**Scenario:** T-002 fails because blob storage context is missing.

**Agent output:**

### Session Summary
- **Done**: Attempted T-002 but blocked
- **Changes**: None (rolled back)
- **New tasks.md**: None
- **New raw.tasks.md**: 
  - `temp-003 | Document blob storage patterns | Source: T-002 failure | Notes: need contexts/blob.context.md before proceeding`
- **Warnings**: Added entry to [warnings.md](../warnings.md):
  ```
  - Date: 2025-12-28
  - Area: Storage
  - Severity: warning
  - Finding: No blob storage context defined; T-002 blocked
  - Impact: Cannot implement file upload features
  - Suggested follow-up: Create contexts/blob.context.md
  ```
- **Next**: Run onboarding agent to detect blob patterns, or manually create blob.context.md, then retry T-002 in deep mode.

**failed.tasks.md entry:**
```
- Task ID: T-002
- Date: 2025-12-28
- Agent(s): feature.creator.agent.md
- Mode: auto (shallow)
- What happened: Attempted to implement profile image upload
- Why it failed: Missing blob storage context; unclear which provider (S3, Azure Blob, GCS)
- Next steps: Create contexts/blob.context.md, then retry with deep mode
```

---

## Key Takeaways

1. **Pipeline flows naturally**: raw → structured → executed → done/failed
2. **Agents spawn follow-up work**: Discovered tasks go to `raw.tasks.md`
3. **Failures are documented**: `failed.tasks.md` captures why and what's next
4. **Auto-chain is optional**: User can follow suggestions or redirect
5. **Context gaps surface early**: Missing contexts become `raw.tasks.md` items or warnings
