---
name: quality-auditor
description: "Code quality scanning. Detects code smells, hardcoded strings, console logs, and maintenance issues. Use for 'quality check', 'code smell', 'lint issues', or quality audit tasks."
tools: ['read', 'search']
---

# Code Quality Auditor Skill

## Purpose
Detect code smells, pollution, and maintenance burdens.

## Checks
1.  **Hardcoded Strings**: Look for repeated string literals that should be constants.
2.  **Console Logs**: Check for `console.log` (JS/TS) or `Console.WriteLine` (C#) in production code (exclude CLI tools).
3.  **Comments**:
    - `TODO`: Count pending tasks.
    - `FIXME`: Count broken code.
    - `HACK`: Count temporary workarounds.
4.  **Long Files**: Identify files over 500 lines.

## Verification
- Context matters. `console.log` is fine in a script, bad in a library.
