---
name: agent-governor
description: "Pointer stub - agent creation/validation is now handled by Elegy AgentFactoryService. Audits structural correctness of agent files."
tools: [read, search]
user-invocable: true
disable-model-invocation: false
---

# Agent Governor (Elegy Pointer)

> **Agent creation and validation have been migrated to Elegy.** The canonical implementation lives in `Elegy.Formalization.AgentFactory.AgentFactoryService`.

## How to Invoke

Use `AgentFactoryService.Create(AgentCreateRequest)` from the `Elegy.Formalization.AgentFactory` namespace.

```csharp
var service = new AgentFactoryService(new AgentFactoryOptions());
var result = service.Create(new AgentCreateRequest
{
    Name = "my-agent",
    Description = "What this agent does",
    Capabilities = [new AgentCapability { CapabilityId = "cap-1", Name = "Core" }],
    RoutingRules = [new RoutingRule { RuleId = "r-1", Pattern = "trigger", Priority = 1, TargetCapabilityId = "cap-1" }]
});
```

## What Moved

- **Agent creation** (naming, ID generation) -> `AgentFactoryService.Create`
- **Structural validation** (frontmatter, naming, tools) -> `AgentFactoryService.Validate`
- **Schema validation** -> `agent-create-request.schema.json` contract

## What Remains Here

- **Read-only audit** of existing `*.agent.md` files in the workspace (structural checks only).
- For creation/editing, use the Elegy `AgentFactoryService` instead.