---
name: quality-auditor
description: "Code quality scanning. Detects code smells, hardcoded strings, console logs, and maintenance issues. Use this when asked to check code quality, find code smells, audit lint issues, or scan for quality problems."
---

# Code Quality Auditor Skill

## Purpose
Detect code smells, pollution, and maintenance burdens across the codebase.

## When NOT to Use
- For security-specific issues → use `security` or `secrets-auditor`
- For performance bottlenecks → use `performance-auditer`
- For language-specific patterns → use `csharp-expert` (alias: `quality-csharp`)

## Checks

### Critical
1.  **Dead Code**: Unused imports, unreachable code, commented-out blocks
2.  **Hardcoded Secrets**: Connection strings, API keys in code (not env vars)

### High
3.  **Hardcoded Strings**: Repeated string literals that should be constants
4.  **Console Logs**: `console.log` (JS/TS) or `Console.WriteLine` (C#) in production code
5.  **Magic Numbers**: Unexplained numeric literals (except 0, 1, -1)
6.  **Long Files**: Files over 500 lines (consider splitting)

### Medium
7.  **Comments Debt**:
    - `TODO`: Count pending tasks
    - `FIXME`: Count broken code
    - `HACK`: Count temporary workarounds
8.  **Inconsistent Naming**: Mixed casing styles within same file
9.  **Deep Nesting**: Functions with >4 levels of indentation

### Low
10. **Missing Docs**: Public APIs without documentation
11. **Large Functions**: Functions over 50 lines

## Verification
- Context matters: `console.log` is fine in CLI tools, bad in libraries
- Exclude: test files, generated code, vendor folders
- Check `.gitignore` patterns to avoid scanning build outputs


