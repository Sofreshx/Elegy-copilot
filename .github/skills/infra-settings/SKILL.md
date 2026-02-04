---
name: infra-settings
description: >
  Infrastructure settings management for MCP providers and related tooling. Use this when asked to manage MCP provider settings, enable or disable MCP integrations, or sync MCP configuration files. Triggers on: MCP settings, MCP providers, mcp config, infra settings, provider settings.
---

# Infra Settings Skill

## Purpose
Manage MCP provider settings and ensure configuration stays minimal, secure, and per-repo.

## Responsibilities

- Enable or disable MCP providers per repo.
- Update provider definitions in VS Code settings.
- Sync MCP configuration files to the configured path.

## Safe Defaults

- Keep providers disabled by default.
- Avoid writing secrets into repo files.
- Prefer read-only or scoped modes when available.
