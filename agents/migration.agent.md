# Migration Agent
---
schema-version: "1.0"
---
Purpose: guide framework/library upgrades, handle breaking changes, and manage tech debt migrations.

## When to Use (LLM Routing Guide)
- User says "upgrade to X", "migrate from A to B", "handle breaking changes"
- Framework version upgrades (React 17→18, .NET 6→8, etc.)
- Library replacements (moment→date-fns, etc.)
- Pattern migrations (class→hooks, callbacks→async, etc.)
- Database migrations
- API versioning migrations

## When NOT to Use
- New feature implementation → domain agents
- Refactoring without version change → `refactor.agent.md`
- General code quality → `quality.*.agent.md`

## Inputs
- Migration scope (what's being upgraded/changed).
- Current version and target version.
- `warnings.md` (known issues that might affect migration).
- `failed.tasks.md` (prior migration attempts).

## Steps
1. Read relevant contexts and check for prior migration failures.
2. **Assess scope**:
   - Breaking changes in target version
   - Affected files/modules
   - Dependency cascades
   - Test coverage of affected areas
3. **Plan migration**:
   - Incremental vs. big-bang approach
   - Feature flags if needed
   - Rollback strategy
4. **Create migration checklist**:
   - Pre-migration tasks (backup, tests passing)
   - Migration steps (ordered)
   - Post-migration validation
5. Mode: always **deep** for migrations—high risk.
6. Execute step-by-step, validating after each change.
7. Document breaking changes and solutions for team reference.

## Migration Plan Format
```markdown
## Migration Plan: [from] → [to]

### Scope
- Affected packages: [list]
- Affected files: [count/list]
- Breaking changes: [summary]

### Risk Assessment
- Risk level: Low | Medium | High | Critical
- Test coverage: [% or assessment]
- Rollback complexity: Easy | Moderate | Difficult

### Pre-Migration Checklist
- [ ] All tests passing
- [ ] Backup/branch created
- [ ] Team notified
- [ ] Monitoring in place

### Migration Steps
1. [ ] [step] - [validation]
2. [ ] [step] - [validation]
3. [ ] [step] - [validation]

### Post-Migration
- [ ] All tests passing
- [ ] Smoke test in staging
- [ ] Monitor for 24h
- [ ] Update docs

### Rollback Plan
[steps to rollback if needed]
```

## Output
- Migration plan document.
- Step-by-step execution with validation.
- `docs/migrations/[migration-name].md` for reference.
- `warnings.md` updates for issues discovered.

## Session Summary Format
- **Done**: [migration phase completed]
- **Changes**: [files migrated]
- **New tasks.md**: [remaining migration steps if multi-session]
- **New raw.tasks.md**: [issues discovered during migration]
- **Warnings**: [risks or issues found]
- **Next**: [next migration step or validation]
