---
created: 2026-03-01
updated: 2026-03-01
category: research
status: current
doc_kind: node
id: copilot-sdk-artifact-layout
summary: Proposed additive session-state artifact layout for the copilot-ui SDK bridge.
tags: [copilot-sdk, artifacts, session-state, bridge]
related: [session-state-artifacts, copilot-sdk-integration-adr]
---

# Copilot SDK Artifact Layout

This document defines an additive artifact layout for the `copilot-ui` SDK bridge under the existing session-state root.

## Compatibility Goal

The existing canonical session artifacts remain unchanged:

- `plan.md`
- `proposition.md`
- `plans/index.json`
- `plans/rev-*.md`

The SDK bridge adds new files and directories without replacing or renaming existing artifacts.

## Additive Layout

```text
~/.copilot/session-state/<SESSION_ID>/
  plan.md
  proposition.md
  plans/
    index.json
    rev-0001.md
  sdk-bridge.json
  research/
    notes/
      index.json
      <note-id>.md
    diagrams/
      index.json
      <diagram-id>.md
```

Notes:

- `research/notes/` stores markdown-only research notes.
- `research/diagrams/` stores diagram source markdown. Rendering outputs can be generated on demand and should not be treated as canonical state.
- Existing artifact readers that only look for `plan.md` and `proposition.md` remain compatible.

## sdk-bridge.json Schema (v1)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "SdkBridgeArtifact",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "sessionId",
    "bridgeModule",
    "sdkPackage",
    "authMode",
    "createdAt",
    "updatedAt"
  ],
  "properties": {
    "schemaVersion": { "type": "integer", "const": 1 },
    "sessionId": { "type": "string", "minLength": 1 },
    "bridgeModule": {
      "type": "string",
      "const": "copilot-ui/lib/copilot-bridge/index.mjs"
    },
    "sdkPackage": {
      "type": "object",
      "additionalProperties": false,
      "required": ["name", "version"],
      "properties": {
        "name": { "type": "string", "const": "@github/copilot-sdk" },
        "version": { "type": "string", "minLength": 1 }
      }
    },
    "authMode": {
      "type": "string",
      "enum": ["cliUrl", "loggedInUser", "githubToken"]
    },
    "cli": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "cliUrl": { "type": "string", "minLength": 1 },
        "useStdio": { "type": "boolean" },
        "cwd": { "type": "string", "minLength": 1 }
      }
    },
    "research": {
      "type": "object",
      "additionalProperties": false,
      "required": ["notesDir", "diagramsDir"],
      "properties": {
        "notesDir": { "type": "string", "const": "research/notes" },
        "diagramsDir": { "type": "string", "const": "research/diagrams" }
      }
    },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" }
  }
}
```

## Research and Diagram Index Contracts

`research/notes/index.json` and `research/diagrams/index.json` should be append-friendly arrays keyed by artifact id.

Recommended record fields:

- `id`: stable artifact identifier
- `title`: human-readable title
- `path`: relative path under the session directory
- `createdAt`: ISO timestamp
- `updatedAt`: ISO timestamp
- `source`: one of `manual`, `imported`, `generated`

This keeps indexing simple while preserving compatibility with existing session scanners.
