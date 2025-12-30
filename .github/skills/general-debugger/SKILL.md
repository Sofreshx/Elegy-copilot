---
name: general-debugger
schema-version: "1.0"
description: "Debugger Skill: General debugging strategies."
---

# General Debugger Skill

## Purpose
Standard debugging procedures applicable to any language.

## Strategies
1.  **Error Tracing**:
    - Search for the exact error message string in the codebase.
    - Identify where the error is thrown.
2.  **Log Analysis**:
    - If logs are provided, correlate timestamps with code execution paths.
3.  **Isolation**:
    - Identify the smallest unit of code responsible for the issue.
4.  **Diffing**:
    - If this is a regression, check `git diff` for recent changes in the affected area.
