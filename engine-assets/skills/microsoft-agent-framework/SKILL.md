---
name: microsoft-agent-framework
description: "Microsoft Agent Framework (C#/.NET). Build agents and workflows with sessions, tools (including MCP), middleware, and multi-agent orchestration. Triggers on: Agent Framework, Microsoft.Agents, AIAgent, AgentSession, tools, MCP, workflows, executors, edges."
---

# Microsoft Agent Framework Skill

## Purpose
Use Microsoft Agent Framework to build:

- **Agents**: LLM-driven components that can call tools and generate responses.
- **Workflows**: Type-safe, graph-based orchestration connecting agents + functions for multi-step processes (checkpointing + human-in-the-loop).

This skill is for the **new** Microsoft Agent Framework APIs (not the legacy Semantic Kernel “Agents” APIs).

## Key Concepts (C#)

| Concept | What it is | Where you’ll see it |
|---|---|---|
| `AIAgent` | The main agent abstraction you run/stream | `agent.RunAsync(...)`, `agent.RunStreamingAsync(...)` |
| `AgentSession` | Multi-turn conversation state container | `CreateSessionAsync()`, pass to `RunAsync(..., session)` |
| Tools | Functions / MCP tools agents can call | `AIFunctionFactory.Create(...)`, hosted/local MCP tools |
| Middleware | Intercept runs, tool calls, and chat-client calls | `agent.AsBuilder().Use(...)` |
| Workflows | Graph of executors + edges with routing, events, checkpointing | workflow builder + executors/edges |

## Setup (hosting/provider-agnostic)

Agent Framework is **hosting-agnostic**: any inference provider that can supply a `Microsoft.Extensions.AI.IChatClient` can be used.

### Packages

Choose the provider(s) you use:

- OpenAI:
```bash
dotnet add package Microsoft.Agents.AI.OpenAI --prerelease
```

- Anthropic:
```bash
dotnet add package Microsoft.Agents.AI.Anthropic --prerelease
```

- Ollama (local):
```bash
dotnet add package Microsoft.Extensions.AI.Ollama --prerelease
```

### Create and run a basic agent (OpenAI)

```csharp
using System;
using Microsoft.Agents.AI;
using OpenAI;

var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("Set OPENAI_API_KEY");
var model = Environment.GetEnvironmentVariable("OPENAI_MODEL") ?? "gpt-4o-mini";

OpenAIClient client = new OpenAIClient(apiKey);
var chatClient = client.GetChatClient(model);

AIAgent agent = chatClient.AsAIAgent(
    instructions: "You are a friendly assistant. Keep your answers brief.",
    name: "HelloAgent");

Console.WriteLine(await agent.RunAsync("What is the largest city in France?"));

await foreach (var update in agent.RunStreamingAsync("Tell me a one-sentence fun fact."))
{
    Console.Write(update);
}
```

### Create and run a basic agent (Ollama, local)

```csharp
using System;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

var chatClient = new OllamaChatClient(
    new Uri("http://localhost:11434"),
    modelId: "llama3.2");

AIAgent agent = chatClient.AsAIAgent(
    instructions: "You are a helpful assistant running locally via Ollama.");

Console.WriteLine(await agent.RunAsync("What is the largest city in France?"));
```

### Provider-agnostic: use any `IChatClient`

```csharp
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

IChatClient chatClient = /* resolve from DI or create using a provider package */;
var agent = new ChatClientAgent(chatClient, instructions: "You are a helpful assistant");

Console.WriteLine(await agent.RunAsync("Hello!"));
```

## Multi-turn conversations (sessions)

Use `AgentSession` when you need the agent to remember prior turns.

```csharp
AgentSession session = await agent.CreateSessionAsync();

_ = await agent.RunAsync("My name is Alice.", session);
Console.WriteLine(await agent.RunAsync("What is my name?", session));

var serialized = agent.SerializeSession(session);
AgentSession resumed = await agent.DeserializeSessionAsync(serialized);
```

Guidance:
- Sessions are **agent/provider specific**; don’t reuse a session with a different agent configuration.

## Tools

Agent Framework supports multiple tool types (function tools, tool approval, hosted/local MCP tools, etc.).

### Function tools (custom code)
Create tools with `AIFunctionFactory.Create(...)` and pass them to `AsAIAgent(..., tools: ...)`.

### Agent composition (agent-as-tool)
Convert an `AIAgent` into a function tool with `.AsAIFunction()` and provide it to another agent.

```csharp
using System;
using Microsoft.Agents.AI;
using OpenAI;

var apiKey = Environment.GetEnvironmentVariable("OPENAI_API_KEY")
    ?? throw new InvalidOperationException("Set OPENAI_API_KEY");
var model = Environment.GetEnvironmentVariable("OPENAI_MODEL") ?? "gpt-4o-mini";

OpenAIClient client = new OpenAIClient(apiKey);

// inner agent
AIAgent weatherAgent = client.GetChatClient(model).AsAIAgent(
    instructions: "You answer questions about the weather.",
    name: "WeatherAgent",
    description: "Answers weather questions.");

// outer agent with inner agent as a tool
AIAgent agentWithTool = client.GetChatClient(model).AsAIAgent(
    instructions: "You are a helpful assistant.",
    tools: [weatherAgent.AsAIFunction()]);

Console.WriteLine(await agentWithTool.RunAsync("What is the weather like in Amsterdam?"));
```

## Middleware

Use middleware for cross-cutting concerns (logging, safety checks, transforms) without rewriting agent logic.

```csharp
var middlewareEnabledAgent = agent
    .AsBuilder()
        .Use(runFunc: CustomAgentRunMiddleware, runStreamingFunc: CustomAgentRunStreamingMiddleware)
        .Use(CustomFunctionCallingMiddleware)
    .Build();
```

Notes:
- Function-calling middleware is currently only supported for agents using `FunctionInvokingChatClient` (e.g., `ChatClientAgent`).
- Be careful when terminating tool loops; it can leave history in an inconsistent state.

## Workflows (graph-based orchestration)

Use workflows when the process is explicit and multi-step (routing/branching, parallelism, checkpointing, human approval).

Core building blocks:
- **Executors**: processing units (agents or custom logic)
- **Edges**: conditional routing between executors
- **Events**: observability hooks
- **Checkpointing**: persist + resume long-running executions

## Best Practices

- Prefer plain functions when possible; use agents when the task is open-ended or conversational.
- Treat tools (especially MCP tools) as untrusted boundaries: validate inputs/outputs and add approvals for sensitive actions.
- Don’t leak secrets into prompts or tool arguments.
- Prefer explicit auth configuration for your provider in production; avoid “ambient” credential probing unless you’ve reviewed the implications.

## Docs
- Overview: https://learn.microsoft.com/en-us/agent-framework/overview/?pivots=programming-language-csharp
- First agent: https://learn.microsoft.com/en-us/agent-framework/get-started/your-first-agent
- Agent types (incl. `ChatClientAgent`): https://learn.microsoft.com/en-us/agent-framework/agents/
- Providers overview: https://learn.microsoft.com/en-us/agent-framework/agents/providers/
- OpenAI provider: https://learn.microsoft.com/en-us/agent-framework/agents/providers/openai
- Anthropic provider: https://learn.microsoft.com/en-us/agent-framework/agents/providers/anthropic
- Ollama provider: https://learn.microsoft.com/en-us/agent-framework/agents/providers/ollama
- Tools: https://learn.microsoft.com/en-us/agent-framework/agents/tools/
- Sessions: https://learn.microsoft.com/en-us/agent-framework/agents/conversations/session
- Middleware: https://learn.microsoft.com/en-us/agent-framework/agents/middleware/
- Workflows: https://learn.microsoft.com/en-us/agent-framework/workflows/




