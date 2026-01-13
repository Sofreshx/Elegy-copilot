---
name: wolverine-core
description: >
    Wolverine message handling and CQRS. Creates handlers, commands, events, and message processing. Use this when asked to create a Wolverine handler, implement CQRS, work with message bus, or handle Wolverine messaging tasks.
    Triggers on: "Wolverine", "message handler", "CQRS", "command handler".
---

# Wolverine Core Skill

## Purpose
Wolverine is a mediator and message bus framework for .NET that simplifies building message-driven applications with support for multiple transports, durability, and advanced patterns.

## Core Terminology

| Term | Definition |
|------|------------|
| **Message** | Any .NET type used to convey intent (commands, events, queries) |
| **Envelope** | Wrapper around messages containing metadata (id, correlation, headers) |
| **Handler** | Code that processes a message - can be method, function, or class |
| **Transport** | How messages move between nodes (Rabbit MQ, Azure Service Bus, etc.) |
| **Endpoint** | Named location for sending/receiving messages within a transport |
| **Node** | Single running instance of Wolverine (your application) |
| **Agent** | Background worker that processes messages from subscribed endpoints |
| **Message Store** | Database for durable inbox/outbox patterns |

## Basic Message Handler Pattern

### Simple Handler (Static Method)
```csharp
// Message definition
public record CreateOrder(string CustomerId, List<OrderItem> Items);

// Handler - Wolverine discovers this automatically
public static class CreateOrderHandler
{
    public static OrderCreated Handle(CreateOrder command, IDocumentSession session)
    {
        var order = new Order 
        { 
            CustomerId = command.CustomerId,
            Items = command.Items
        };
        session.Store(order);
        
        // Returning an event cascades it to other handlers
        return new OrderCreated(order.Id);
    }
}
```

### Async Handler
```csharp
public static class ProcessPaymentHandler
{
    public static async Task<PaymentProcessed> HandleAsync(
        ProcessPayment command, 
        IPaymentGateway gateway,
        CancellationToken ct)
    {
        var result = await gateway.ChargeAsync(command.Amount, command.CardToken, ct);
        return new PaymentProcessed(result.TransactionId);
    }
}
```

### Handler Class (for complex scenarios)
```csharp
public class OrderSagaHandler
{
    private readonly IOrderRepository _orders;
    private readonly ILogger<OrderSagaHandler> _logger;

    public OrderSagaHandler(IOrderRepository orders, ILogger<OrderSagaHandler> logger)
    {
        _orders = orders;
        _logger = logger;
    }

    public async Task Handle(OrderPlaced message)
    {
        _logger.LogInformation("Processing order {OrderId}", message.OrderId);
        await _orders.MarkAsProcessingAsync(message.OrderId);
    }
}
```

## Message Publishing

### Via IMessageBus (Injected)
```csharp
public class OrderService
{
    private readonly IMessageBus _bus;
    
    public OrderService(IMessageBus bus) => _bus = bus;

    public async Task PlaceOrderAsync(CreateOrder command)
    {
        // Send and wait for handler to complete
        await _bus.InvokeAsync(command);
        
        // Fire and forget (queued locally or to transport)
        await _bus.PublishAsync(new OrderPlaced(command.OrderId));
        
        // Send to specific endpoint
        await _bus.SendAsync(new ShipOrder(command.OrderId), "shipping-queue");
    }
}
```

### Cascading Messages (Return from Handler)
```csharp
public static class OrderWorkflow
{
    // Single cascade
    public static OrderValidated Handle(ValidateOrder command) 
        => new OrderValidated(command.OrderId);

    // Multiple cascades
    public static (OrderShipped, NotifyCustomer) Handle(ShipOrder command)
        => (new OrderShipped(command.OrderId), new NotifyCustomer(command.CustomerId));
    
    // Conditional cascades
    public static IEnumerable<object> Handle(ProcessRefund command)
    {
        yield return new RefundProcessed(command.OrderId);
        
        if (command.Amount > 100)
            yield return new NotifyManager(command.OrderId);
    }
}
```

## Configuration

### Basic Setup in Program.cs
```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Host.UseWolverine(opts =>
{
    // Handlers discovered automatically from assembly
    opts.Discovery.IncludeAssembly(typeof(Program).Assembly);
    
    // Local queuing (in-memory, durable to DB, etc.)
    opts.LocalQueue("important")
        .UseDurableInbox(); // Survives restarts
    
    // Transactional outbox with Marten
    opts.UseMartenForPersistence();
});

var app = builder.Build();
app.MapWolverineEndpoints(); // HTTP endpoints
app.Run();
```

### With Marten Integration
```csharp
builder.Host.UseWolverine(opts =>
{
    opts.Policies.AutoApplyTransactions(); // Auto-save on success
    opts.Policies.UseDurableLocalQueues();
    
    // Integrate with Marten for event sourcing + messaging
    opts.IntegrateWithMarten()
       .EventForwardingToLocalWolverineQueue();
});

builder.Services.AddMarten(opts =>
{
    opts.Connection(connectionString);
});
```

## Dependency Injection in Handlers

```csharp
// All parameters are injected automatically
public static async Task Handle(
    CreateUser command,                    // The message
    IDocumentSession session,              // From DI
    ILogger<CreateUserHandler> logger,     // From DI
    IMessageContext context,               // Wolverine's context
    CancellationToken cancellation)        // Cancellation support
{
    logger.LogInformation("Creating user {Email}", command.Email);
    
    var user = new User { Email = command.Email };
    session.Store(user);
    
    // Access envelope metadata
    var correlationId = context.CorrelationId;
}
```

## Best Practices

1. **Keep Handlers Focused**: One handler per message type, single responsibility
2. **Use Cascading**: Return events instead of calling `IMessageBus.PublishAsync` directly
3. **Prefer Static Methods**: Less overhead than class handlers for simple cases
4. **Enable Durability**: Use `UseDurableInbox()` for important messages
5. **Use Outbox Pattern**: Let Wolverine handle transactional messaging with Marten
6. **Name Conventions**: `*Handler` classes, `Handle`/`HandleAsync` methods

## Common Gotchas

- **Handler Discovery**: Wolverine scans for `Handle`/`HandleAsync` methods automatically - don't forget `IncludeAssembly()`
- **Sync vs Async**: Prefer `HandleAsync` for I/O operations
- **Transaction Scope**: `AutoApplyTransactions()` commits Marten session on handler success
- **Message Types**: Keep messages simple POCOs or records - avoid complex inheritance

````


