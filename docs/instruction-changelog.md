# Instruction Changelog

Track all changes to the agentic instruction system for auditability and rollback.

## Format
```
## [version] - YYYY-MM-DD
### Changed
- [file]: [what changed]
### Added
- [new file/section]
### Fixed
- [issue addressed]
### Removed
- [deprecated content]
```

---

## [1.0.0] - 2025-12-28
### Added
- Initial instruction system with kernel, meta-agents, and domain agents
- Task pipeline (raw.tasks → tasks → execution)
- Stack detection matrix for onboarding
- Agent template schema with schema-version tracking
- Merge strategy for safe updates
- Free-form mode for ad-hoc requests
- Copilot integration guidance
- Instruction drift detection agent
- General-purpose agents (assistant, code-review, design, debug, refactor, docs, testing, security)
