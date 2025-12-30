---
name: openai-api
description: "OpenAI API integration for .NET. Handles GPT chat completions, embeddings, and function calling. Use for 'OpenAI', 'GPT integration', 'chat completion', or AI API tasks."
tools: ['read', 'edit', 'search']
---

# OpenAI API Skill

## Purpose
Integrate OpenAI's GPT models for AI features.

## Setup
1.  **Architecture**: AI integration should reside in a **Backend Service** (.NET). Do not call OpenAI directly from the Frontend.
2.  **Key**: Set `OPENAI_API_KEY` in environment variables (User Secrets).
3.  **SDK**: `dotnet add package Azure.AI.OpenAI` (Official Client) or `Microsoft.Agents.OpenAI` (for Agent Framework).

## Usage (C# - Azure.AI.OpenAI)
```csharp
using Azure.AI.OpenAI;
using OpenAI.Chat;

ChatClient client = new(model: "gpt-5-mini", apiKey: Environment.GetEnvironmentVariable("OPENAI_API_KEY"));

ChatCompletion completion = await client.CompleteChatAsync("Hello!");
Console.WriteLine(completion.Content[0].Text);
```

## Best Practices
- Handle rate limits (429 errors).
- Use streaming for long responses.
- Never commit API keys.
