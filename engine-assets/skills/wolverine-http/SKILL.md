---
name: wolverine-http
description: "Wolverine HTTP endpoints. Creates minimal API-style HTTP endpoints with Wolverine. Use this when asked to create a Wolverine endpoint, add an HTTP handler, or work on API endpoints using Wolverine HTTP. Triggers on: Wolverine endpoint, Wolverine API, minimal API, HTTP handler."
---

# Wolverine HTTP Endpoints Skill

## Purpose
Define HTTP endpoints using Wolverine's minimal API integration. Wolverine HTTP provides a streamlined alternative to MVC controllers with automatic request binding, dependency injection, and integration with Wolverine's message handling.

## Basic Endpoint Patterns

### Simple Endpoints with Attributes
```csharp
public static class TodoEndpoints
{
    [WolverineGet("/todos/{id}")]
    public static Task<Todo?> GetTodo(Guid id, IDocumentSession session) 
        => session.LoadAsync<Todo>(id);

    [WolverinePost("/todos")]
    public static (TodoCreated, IResult) CreateTodo(CreateTodo command, IDocumentSession session)
    {
        var todo = new Todo { Name = command.Name };
        session.Store(todo);
        return (new TodoCreated(todo.Id), Results.Created($"/todos/{todo.Id}", todo));
    }

    [WolverinePut("/todos/{id}")]
    public static async Task<IResult> UpdateTodo(Guid id, UpdateTodo command, IDocumentSession session)
    {
        var todo = await session.LoadAsync<Todo>(id);
        if (todo is null) return Results.NotFound();
        
        todo.Name = command.Name;
        session.Store(todo);
        return Results.Ok(todo);
    }

    [WolverineDelete("/todos/{id}")]
    public static async Task<IResult> DeleteTodo(Guid id, IDocumentSession session)
    {
        var todo = await session.LoadAsync<Todo>(id);
        if (todo is null) return Results.NotFound();
        
        session.Delete(todo);
        return Results.NoContent();
    }
}
```

## Route Attributes
| Attribute | HTTP Method | Usage |
|-----------|-------------|-------|
| `[WolverineGet("route")]` | GET | Read operations, queries |
| `[WolverinePost("route")]` | POST | Create resources, commands |
| `[WolverinePut("route")]` | PUT | Full updates |
| `[WolverinePatch("route")]` | PATCH | Partial updates |
| `[WolverineDelete("route")]` | DELETE | Remove resources |
| `[WolverineHead("route")]` | HEAD | Header-only responses |
| `[WolverineOptions("route")]` | OPTIONS | CORS preflight |

## Legal Method Signatures

### Return Types
```csharp
// Void/Task - 200 OK with no body
[WolverinePost("/simple")]
public static void SimpleHandler(Command cmd) { }

[WolverinePost("/simple-async")]
public static async Task SimpleAsyncHandler(Command cmd) { }

// T/Task<T> - 200 OK with JSON body
[WolverineGet("/item")]
public static Item GetItem() => new Item();

[WolverineGet("/item-async")]
public static async Task<Item> GetItemAsync() => new Item();

// IResult - Full control over response
[WolverineGet("/result")]
public static IResult GetWithResult() => Results.Ok(new Item());

// Tuple with cascading message
[WolverinePost("/with-event")]
public static (ItemCreated, IResult) CreateWithEvent(CreateItem cmd)
    => (new ItemCreated(cmd.Id), Results.Created($"/items/{cmd.Id}", cmd));
```

## Parameter Binding

### Route Parameters
```csharp
[WolverineGet("/orders/{orderId}/items/{itemId}")]
public static Task<OrderItem?> GetOrderItem(Guid orderId, int itemId, IDocumentSession session)
    => session.Query<OrderItem>().FirstOrDefaultAsync(x => x.OrderId == orderId && x.Id == itemId);
```

### Query String Parameters
```csharp
[WolverineGet("/search")]
public static Task<IReadOnlyList<Product>> SearchProducts(
    string? query,           // ?query=foo
    int page = 1,            // ?page=2 (default: 1)
    int pageSize = 10,       // ?pageSize=50
    IDocumentSession session)
{
    return session.Query<Product>()
        .Where(p => query == null || p.Name.Contains(query))
        .Skip((page - 1) * pageSize)
        .Take(pageSize)
        .ToListAsync();
}
```

### JSON Body Binding
```csharp
// First complex type parameter is bound from JSON body
[WolverinePost("/orders")]
public static async Task<IResult> CreateOrder(
    CreateOrderRequest request,  // ? JSON body
    IDocumentSession session)
{
    var order = new Order { Items = request.Items };
    session.Store(order);
    await session.SaveChangesAsync();
    return Results.Created($"/orders/{order.Id}", order);
}
```

## Accessing HTTP Context

### HttpContext & HttpRequest/Response
```csharp
[WolverineGet("/context-example")]
public static async Task<IResult> WithContext(
    HttpContext context,         // Full context
    HttpRequest request,         // Just request
    HttpResponse response,       // Just response
    ClaimsPrincipal user)        // Current user
{
    var authHeader = request.Headers.Authorization;
    var userId = user.FindFirstValue(ClaimTypes.NameIdentifier);
    
    response.Headers.Add("X-Custom", "value");
    return Results.Ok(new { userId });
}
```

### Cancellation Support
```csharp
[WolverineGet("/long-operation")]
public static async Task<Data> LongOperation(CancellationToken ct, IDataService service)
    => await service.GetDataAsync(ct);
```

## IoC / Dependency Injection

All non-message parameters are resolved from DI:
```csharp
[WolverinePost("/process")]
public static async Task<IResult> ProcessOrder(
    ProcessOrderCommand command,           // Message (JSON body)
    IDocumentSession session,              // From DI
    IPaymentGateway paymentGateway,        // From DI
    ILogger<OrderEndpoints> logger,        // From DI
    IMessageContext messageContext,        // Wolverine context
    CancellationToken ct)                  // Cancellation
{
    logger.LogInformation("Processing order {OrderId}", command.OrderId);
    // ...
}
```

## Hybrid Handler + HTTP Endpoint

Same handler can work as both message handler AND HTTP endpoint:
```csharp
public static class CreateCustomerEndpoint
{
    // Works as HTTP POST /customers AND as message handler
    [WolverinePost("/customers")]
    public static (CustomerCreated, IResult) Handle(
        CreateCustomer command,
        IDocumentSession session)
    {
        var customer = new Customer { Name = command.Name };
        session.Store(customer);
        
        return (
            new CustomerCreated(customer.Id),  // Cascaded message
            Results.Created($"/customers/{customer.Id}", customer)  // HTTP response
        );
    }
}
```

## Configuration

### Register Endpoints in Program.cs
```csharp
var app = builder.Build();

// Map all Wolverine HTTP endpoints
app.MapWolverineEndpoints();

// Or with route prefix
app.MapWolverineEndpoints(opts =>
{
    opts.UseApiPrefix("/api/v1");
});
```

## Best Practices

1. **Static Methods**: Prefer static methods for endpoints - less overhead
2. **Tuple Returns**: Use `(Event, IResult)` to publish events alongside HTTP responses
3. **IResult for Control**: Use `IResult` when you need specific status codes
4. **Keep Endpoints Thin**: Business logic belongs in handlers, not endpoints
5. **Naming**: Use `*Endpoint` or `*Endpoints` suffix for endpoint classes

## Common Gotchas

- **Body Binding**: Only the FIRST complex type binds from JSON body - use route/query for additional params
- **MapWolverineEndpoints()**: Don't forget to call this in Program.cs
- **Async Preferred**: Use `async Task<T>` for any I/O operations
- **No [FromBody]**: Wolverine handles binding automatically - don't use ASP.NET Core attributes

- **Official documentation**: https://wolverinefx.net/guide/http/ entry point for the official documentation if you need to look up more specifics feature or informations





