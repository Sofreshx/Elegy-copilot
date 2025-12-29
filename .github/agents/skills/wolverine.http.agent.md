---
description: "Skill: Wolverine HTTP Endpoints."
---

# Wolverine HTTP Skill

## Purpose
Define HTTP endpoints using Wolverine's minimal API integration.

## Usage
Instead of Controllers, use static `Endpoint` methods in handlers.

## Pattern
```csharp
public static class CreateTodoEndpoint
{
    [WolverinePost("/todos")]
    public static (TodoCreated, IResult) Post(CreateTodo command, IDocumentSession session)
    {
        var todo = new Todo { Name = command.Name };
        session.Store(todo);
        return (new TodoCreated(todo.Id), Results.Ok(todo));
    }
}
```

## Attributes
- `[WolverineGet("route")]`
- `[WolverinePost("route")]`
- `[WolverinePut("route")]`
- `[WolverineDelete("route")]`

## Benefits
- Automatic request body binding.
- Automatic dependency injection.
- No Controller overhead.
