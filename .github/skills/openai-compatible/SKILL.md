---
name: openai-compatible
description: "Integration for OpenAI-compatible APIs (OpenAI, Azure, ZAI, etc.). Handles chat completions, embeddings, and function calling. Triggers on:"OpenAI", "GPT", "chat completion", "OpenAI-compatible"."
---

# OpenAI-Compatible API Skill

## Purpose
Integrate AI features using any OpenAI-compatible provider (OpenAI, Azure, ZAI, etc.).

## Setup
1.  **Architecture**: AI integration should reside in a **Backend Service**. Do not call AI providers directly from the Frontend.
2.  **Key**: Set the appropriate environment variable (e.g., `ZAI_KEY`, `OPENAI_API_KEY`) in User Secrets or Environment Variables.
3.  **Base URL**: If using a non-standard provider (like ZAI or local LLM), ensure the `BaseUrl` is configured correctly.

## Usage (General Pattern)
Most SDKs allow overriding the `BaseUrl` and `ApiKey`.

### C# Example (Microsoft.Extensions.AI / Azure.AI.OpenAI)
```csharp
// Example using ZAI
var client = new ChatClient(
    model: "gpt-4o",
    apiKey: Environment.GetEnvironmentVariable("ZAI_KEY"),
    endpoint: new Uri("https://api.zai.com/v1") // Example Base URL
);

var response = await client.CompleteAsync("Hello!");
```

## Best Practices
- **Rate Limits**: Handle 429 errors gracefully. Respect `Retry-After` headers.
- **Streaming**: Use streaming for long responses to improve perceived latency.
- **Security**: Never commit API keys. Use environment variables.

## Error Handling (Critical)
- **429 (Too Many Requests)**: Backoff and retry (respect `Retry-After`).
- **5xx (Server Errors)**: Retry on transient errors (502, 503, 504) with exponential backoff.
- **401/403 (Auth)**: Do not retry. Check configuration.

**Do not leak provider errors to the client.** Return generic, safe error messages.




