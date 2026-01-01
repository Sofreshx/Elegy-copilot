---
name: openai-api
description: "OpenAI API integration for .NET. Handles GPT chat completions, embeddings, and function calling. Use this when asked to integrate OpenAI, implement GPT features, work with chat completions, or build AI API functionality."
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

## Error Handling (Required)

### Failure Types to Expect
- **429 Too Many Requests**: rate limit / provider throttling.
- **Quota/Billing exhausted**: often surfaced as 429 with an error code like `insufficient_quota`.
- **Timeouts / cancellations**: network latency, upstream slowdowns (`TaskCanceledException` when the token wasn’t canceled).
- **Transient upstream outages**: 502/503/504.
- **Other non-transient errors**: 400/401/403/404 depending on configuration.

### Guidance
- **Do not leak provider exception messages** to end users. Return a stable, user-safe message.
- **Preserve correlation IDs** end-to-end and return them in error responses (e.g., ProblemDetails extensions).
- **Respect Retry-After**: if the provider returns `Retry-After`, propagate it as an HTTP response header when mapping to 429.
- **Use bounded retries only for transient failures** (e.g., 502/503/504, network IO). Do not blindly retry 429 or quota failures.
- **Log safely**: log the status code, correlation id, and a short error category; avoid logging prompts or PII.

### Recommended HTTP Mapping (Backend APIs)
When an API endpoint depends on OpenAI:
- Provider rate limit / quota: return **429**.
- Timeout: return **504**.
- Provider unavailable: return **503**.
- Other upstream errors: return **502**.

Example (pseudo):
```csharp
try
{
	var response = await chatClient.GetResponseAsync(messages, options, ct);
	return Results.Ok(response);
}
catch (RateLimitedException ex)
{
	httpContext.Response.Headers["Retry-After"] = "5"; // if known
	return Results.Problem(title: "AI rate limit reached", statusCode: 429, extensions: new() { ["correlationId"] = correlationId });
}
```


