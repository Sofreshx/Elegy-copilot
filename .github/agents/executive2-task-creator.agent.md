---
name: executive2-task-creator
description: Deprecated internal agent. Use addtodo + plan-artefact-writer directly from executive2-planner to avoid subagent chaining.
tools: [read/readFile, read/terminalSelection, agent/runSubagent, search/changes, search/fileSearch, search/listDirectory, search/searchResults, search/textSearch, search/usages, web/fetch, web/githubRepo]
user-invokable: false
disable-model-invocation: true
handoffs: []
---

# Executive2 Task Creator (Deprecated)

This agent is deprecated. Executive2-planner now calls `addtodo` and `plan-artefact-writer` directly to keep subagent depth at 1.

## Mission
This agent is no longer used. Do not invoke it for task creation.

You do **not** implement production code.

## When to use
- Do not use. Kept only for historical reference.

## Outputs
- None (deprecated).

## Rules
- Do not invoke subagents from this agent.
- Use `executive2-planner` to call `addtodo` and `plan-artefact-writer` directly.

## Artefact Requirements
- None (deprecated).

## Return
Do not use.
