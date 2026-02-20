---
name: semantic-kernel-agents
description: >
    Semantic Kernel multi-agent orchestration. Creates AI agents with plugins and
    planners. Use this when asked to implement Semantic Kernel agents, build AI
    orchestration, or work with SK agent patterns. Triggers on: Semantic Kernel,
    SK agents, semantic kernel agents.
---

# Semantic Kernel Agent Framework Skill

## Purpose
The Microsoft Agent Framework (built on Semantic Kernel) enables building intelligent, multi-agent AI systems. It provides abstractions for different agent types, conversation management, and orchestration patterns for agent collaboration.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Agent** | Core abstraction for AI agents performing tasks |
| **AgentThread** | Manages conversation state for an agent |
| **Kernel** | Semantic Kernel instance providing AI services |
| **Plugin** | Extends agent capabilities with custom functions |
| **Orchestration** | Coordinates multiple agents for complex tasks |

## Agent Types

| Type | Description |
|------|-------------|
| `ChatCompletionAgent` | Uses chat completion AI services |
| `OpenAIAssistantAgent` | Uses OpenAI Assistants API with tools |
| `AzureAIAgent` | Uses Azure AI services |
| `CopilotStudioAgent` | Integrates with Copilot Studio |

## Setup

### Package References
```xml
<ItemGroup>
  <PackageReference Include="Microsoft.SemanticKernel" Version="<latest>" />
  <PackageReference Include="Microsoft.SemanticKernel.Agents.Core" Version="<latest>" />
  <PackageReference Include="Microsoft.SemanticKernel.Agents.OpenAI" Version="<latest>" />
</ItemGroup>

<!-- Suppress experimental warnings -->
<PropertyGroup>
  <NoWarn>$(NoWarn);SKEXP0001;SKEXP0110;OPENAI001</NoWarn>
</PropertyGroup>
```

### NuGet CLI
```bash
dotnet add package Microsoft.SemanticKernel
dotnet add package Microsoft.SemanticKernel.Agents.Core --prerelease
dotnet add package Microsoft.SemanticKernel.Agents.OpenAI --prerelease
```

## ChatCompletionAgent

### Create Basic Agent
```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents;
using Microsoft.SemanticKernel.ChatCompletion;

// Initialize Kernel with chat-completion service
IKernelBuilder builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-4o",
    endpoint: "https://your-resource.openai.azure.com/",
    apiKey: "your-api-key");

Kernel kernel = builder.Build();

// Create the agent
ChatCompletionAgent agent = new()
{
    Name = "SummarizationAgent",
    Instructions = "Summarize user input concisely and clearly.",
    Kernel = kernel
};
```

### Invoke Agent (Simple)
```csharp
// Generate response to a message
await foreach (ChatMessageContent response in agent.InvokeAsync(
    new ChatMessageContent(AuthorRole.User, "Explain quantum computing")))
{
    Console.Write(response.Content);
}
```

### Invoke Agent (With Thread)
```csharp
// Use AgentThread to maintain conversation state
AgentThread thread = new ChatHistoryAgentThread();

await foreach (ChatMessageContent response in agent.InvokeAsync(
    new ChatMessageContent(AuthorRole.User, "What is machine learning?"), 
    thread))
{
    Console.Write(response.Content);
}

// Continue conversation
await foreach (ChatMessageContent response in agent.InvokeAsync(
    new ChatMessageContent(AuthorRole.User, "Give me an example"), 
    thread))
{
    Console.Write(response.Content);
}
```

## Adding Plugins to Agents

### Import Plugin from Type
```csharp
public class WeatherPlugin
{
    [KernelFunction, Description("Gets weather for a city")]
    public string GetWeather([Description("City name")] string city)
    {
        return $"The weather in {city} is sunny, 72�F";
    }
}

// Clone kernel for agent-specific plugins
Kernel agentKernel = kernel.Clone();
agentKernel.ImportPluginFromType<WeatherPlugin>();

ChatCompletionAgent agent = new()
{
    Name = "WeatherAgent",
    Instructions = "Help users with weather information.",
    Kernel = agentKernel,
    Arguments = new KernelArguments(
        new OpenAIPromptExecutionSettings()
        {
            FunctionChoiceBehavior = FunctionChoiceBehavior.Auto()
        })
};
```

### Import Plugin from Object (Stateful)
```csharp
public class DatabasePlugin
{
    private readonly string _connectionString;
    
    public DatabasePlugin(string connectionString) 
        => _connectionString = connectionString;

    [KernelFunction, Description("Query the database")]
    public async Task<string> QueryAsync(string query)
    {
        // Use _connectionString to query
        return "Query results...";
    }
}

agentKernel.ImportPluginFromObject(new DatabasePlugin("Server=..."));
```

### Create Functions Dynamically
```csharp
Kernel agentKernel = kernel.Clone();

// From method
var functionFromMethod = agentKernel.CreateFunctionFromMethod(
    ([Description("Number to double")] int x) => x * 2,
    functionName: "DoubleNumber",
    description: "Doubles a number using a simple Semantic Kernel function example.");

// From prompt
var functionFromPrompt = agentKernel.CreateFunctionFromPrompt(
    "Translate the following to French: {{$input}}",
    functionName: "TranslateToFrench");

agentKernel.ImportPluginFromFunctions("MyPlugin", [functionFromMethod, functionFromPrompt]);
```

## OpenAI Assistant Agent

### Create Assistant with Code Interpreter
```csharp
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.SemanticKernel.Agents.OpenAI;
using OpenAI.Assistants;

// Create Azure OpenAI client
AzureOpenAIClient client = OpenAIAssistantAgent.CreateAzureOpenAIClient(
    new AzureCliCredential(),
    new Uri("https://your-resource.openai.azure.com/"));

AssistantClient assistantClient = client.GetAssistantClient();

// Create assistant definition
Assistant assistant = await assistantClient.CreateAssistantAsync(
    "gpt-4o",
    name: "DataAnalyst",
    instructions: """
        Analyze data and provide insights.
        Always format responses using markdown.
        """,
    enableCodeInterpreter: true);

// Create agent from assistant
OpenAIAssistantAgent agent = new(assistant, assistantClient);
```

### Conversation with Assistant
```csharp
// Create thread for conversation
AssistantAgentThread agentThread = new();

try
{
    var message = new ChatMessageContent(AuthorRole.User, "Calculate the sum of 1 to 100");
    
    await foreach (StreamingChatMessageContent response in 
        agent.InvokeStreamingAsync(message, agentThread))
    {
        Console.Write(response.Content);
    }
}
finally
{
    // Cleanup
    await agentThread.DeleteAsync();
    await assistantClient.DeleteAssistantAsync(assistant.Id);
}
```

### Upload Files for Analysis
```csharp
OpenAIFileClient fileClient = client.GetOpenAIFileClient();

// Upload file
OpenAIFile dataFile = await fileClient.UploadFileAsync(
    "data.csv", 
    FileUploadPurpose.Assistants);

// Create assistant with file
Assistant assistant = await assistantClient.CreateAssistantAsync(
    "gpt-4o",
    name: "DataAnalyst",
    instructions: "Analyze the provided data file.",
    enableCodeInterpreter: true,
    codeInterpreterFileIds: [dataFile.Id]);

// Cleanup file when done
await fileClient.DeleteFileAsync(dataFile.Id);
```

## AI Service Selection (Multiple Models)

```csharp
IKernelBuilder builder = Kernel.CreateBuilder();

// Add multiple services with IDs
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-4o",
    endpoint: endpoint,
    apiKey: apiKey,
    serviceId: "gpt4");

builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-35-turbo",
    endpoint: endpoint,
    apiKey: apiKey,
    serviceId: "gpt35");

Kernel kernel = builder.Build();

// Create agent targeting specific service
ChatCompletionAgent fastAgent = new()
{
    Name = "FastAgent",
    Instructions = "Quick responses",
    Kernel = kernel,
    Arguments = new KernelArguments(
        new OpenAIPromptExecutionSettings()
        {
            ServiceId = "gpt35"  // Use GPT-3.5
        })
};

ChatCompletionAgent smartAgent = new()
{
    Name = "SmartAgent", 
    Instructions = "Detailed analysis",
    Kernel = kernel,
    Arguments = new KernelArguments(
        new OpenAIPromptExecutionSettings()
        {
            ServiceId = "gpt4"  // Use GPT-4
        })
};
```

## Orchestration Patterns

The Agent Framework supports several orchestration patterns for multi-agent collaboration:

| Pattern | Description |
|---------|-------------|
| **Concurrent** | Agents work in parallel on subtasks |
| **Sequential** | Agents work one after another in a pipeline |
| **Handoff** | Agents transfer control based on context |
| **Group Chat** | Multiple agents collaborate in conversation |
| **Magentic** | Dynamic task distribution |

### Basic Multi-Agent Setup
```csharp
// Create specialized agents
ChatCompletionAgent researcher = new()
{
    Name = "Researcher",
    Instructions = "Research and gather information on topics.",
    Kernel = kernel
};

ChatCompletionAgent writer = new()
{
    Name = "Writer", 
    Instructions = "Write clear, engaging content based on research.",
    Kernel = kernel
};

ChatCompletionAgent editor = new()
{
    Name = "Editor",
    Instructions = "Review and improve written content for clarity.",
    Kernel = kernel
};
```

## Streaming Responses

```csharp
ChatCompletionAgent agent = new()
{
    Name = "StreamingAgent",
    Instructions = "Provide detailed responses.",
    Kernel = kernel
};

var message = new ChatMessageContent(AuthorRole.User, "Explain AI");

await foreach (StreamingChatMessageContent chunk in 
    agent.InvokeStreamingAsync(message))
{
    Console.Write(chunk.Content);
}
```

## Best Practices

1. **Clone Kernels for Agents**: Each agent should have its own Kernel clone for isolated plugins
2. **Enable Function Calling Explicitly**: Set `FunctionChoiceBehavior.Auto()` for ChatCompletionAgent
3. **Use Strongly-Typed Plugins**: Prefer typed plugins with `[KernelFunction]` attributes
4. **Manage Thread Lifecycle**: Clean up threads when conversations end
5. **Handle Streaming for Long Responses**: Use streaming for better UX
6. **Suppress Experimental Warnings**: Framework is in release candidate stage

## Common Gotchas

- **Experimental API**: Suppress warnings with `SKEXP0001`, `SKEXP0110` in project file
- **Function Calling Differences**: OpenAI Assistant always uses auto; ChatCompletionAgent needs explicit config
- **Thread Cleanup**: Assistant threads persist in OpenAI - delete when done
- **Kernel Cloning**: Direct Kernel sharing between agents causes plugin conflicts
- **Service ID Required**: When multiple AI services exist, specify which to use




