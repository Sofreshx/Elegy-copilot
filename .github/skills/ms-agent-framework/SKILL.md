---
name: ms-agent-framework
description: "Microsoft.Agents SDK for building AI agents. Use this when asked to implement Microsoft.Agents, build agents with the Microsoft SDK, or work on the Microsoft agent framework."
---

# Microsoft Agent Framework Skill

## Purpose
Build AI agents using the **Microsoft Agent Framework** (`Microsoft.Agents`).

## Setup
1.  **Package**: `dotnet add package Microsoft.Agents --prerelease`
2.  **Namespace**: `using Microsoft.Agents;`

## Concepts
- **Agent**: An autonomous entity that can perceive, reason, and act.
- **Chat**: A conversation container.
- **Group**: A collection of agents working together.

## Usage
```csharp
// Define an Agent
public class MyAgent : Agent
{
    public override async Task HandleAsync(Message message)
    {
        // Logic here
    }
}

// Orchestration
var agent = new MyAgent();
await agent.RunAsync();
```

## Best Practices
- Use **User Secrets** for configuration.
- Design agents with single responsibilities.
- Use the `Microsoft.Agents.Hosting` package for ASP.NET Core integration.


