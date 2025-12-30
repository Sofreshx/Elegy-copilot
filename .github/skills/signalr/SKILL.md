---
name: signalr
description: "ASP.NET Core SignalR real-time communication. Creates hubs, clients, and WebSocket connections. Use for 'SignalR hub', 'real-time', 'websocket', or live update tasks."
tools: ['read', 'edit', 'search']
sources:
  - https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction
  - https://learn.microsoft.com/en-us/aspnet/core/signalr/hubs
---

# SignalR Real-Time Communication Skill

## Purpose
ASP.NET Core SignalR is a library for adding real-time web functionality to applications. It enables server-side code to push content to connected clients instantly using WebSockets, Server-Sent Events, or Long Polling.

## Use Cases
- Chat applications
- Real-time dashboards
- Collaborative editing
- Gaming
- Live notifications
- Auction/voting systems

## Basic Setup

### Configure Services (Program.cs)
```csharp
var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSignalR();

var app = builder.Build();

app.MapHub<ChatHub>("/chat");

app.Run();
```

## Hub Definition

### Basic Hub
```csharp
public class ChatHub : Hub
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.SendAsync("ReceiveMessage", user, message);
    }
}
```

### Strongly-Typed Hub (Recommended)
```csharp
public interface IChatClient
{
    Task ReceiveMessage(string user, string message);
    Task UserJoined(string user);
    Task UserLeft(string user);
}

public class ChatHub : Hub<IChatClient>
{
    public async Task SendMessage(string user, string message)
    {
        await Clients.All.ReceiveMessage(user, message);
    }

    public async Task JoinRoom(string roomName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        await Clients.Group(roomName).UserJoined(Context.User?.Identity?.Name ?? "Anonymous");
    }
}
```

## Clients Object - Sending Messages

### Target Selection
```csharp
public class NotificationHub : Hub
{
    // All connected clients
    public Task NotifyAll(string message)
        => Clients.All.SendAsync("Notify", message);

    // Only the caller
    public Task NotifyCaller(string message)
        => Clients.Caller.SendAsync("Notify", message);

    // All except the caller
    public Task NotifyOthers(string message)
        => Clients.Others.SendAsync("Notify", message);

    // Specific client by connection ID
    public Task NotifyClient(string connectionId, string message)
        => Clients.Client(connectionId).SendAsync("Notify", message);

    // Multiple specific clients
    public Task NotifyClients(IEnumerable<string> connectionIds, string message)
        => Clients.Clients(connectionIds).SendAsync("Notify", message);

    // All clients in a group
    public Task NotifyGroup(string groupName, string message)
        => Clients.Group(groupName).SendAsync("Notify", message);

    // Group except specific connections
    public Task NotifyGroupExcept(string groupName, IEnumerable<string> excludedIds, string message)
        => Clients.GroupExcept(groupName, excludedIds).SendAsync("Notify", message);

    // All connections for a specific user
    public Task NotifyUser(string userId, string message)
        => Clients.User(userId).SendAsync("Notify", message);
}
```

## Context Object

```csharp
public class ChatHub : Hub
{
    public async Task SendMessage(string message)
    {
        // Connection ID (unique per connection)
        var connectionId = Context.ConnectionId;

        // User identifier (from ClaimTypes.NameIdentifier)
        var userId = Context.UserIdentifier;

        // Current user's claims
        var user = Context.User;
        var userName = user?.Identity?.Name;

        // Store data for this connection
        Context.Items["joinedAt"] = DateTime.UtcNow;

        // Abort the connection
        // Context.Abort();

        await Clients.All.SendAsync("ReceiveMessage", userName, message);
    }
}
```

## Connection Lifecycle

```csharp
public class ChatHub : Hub
{
    public override async Task OnConnectedAsync()
    {
        // Called when client connects
        await Groups.AddToGroupAsync(Context.ConnectionId, "GeneralRoom");
        await Clients.All.SendAsync("UserConnected", Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Called when client disconnects
        // exception is null for intentional disconnects
        await Clients.All.SendAsync("UserDisconnected", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}
```

## Groups

```csharp
public class RoomHub : Hub
{
    public async Task JoinRoom(string roomName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        await Clients.Group(roomName).SendAsync("UserJoined", Context.UserIdentifier);
    }

    public async Task LeaveRoom(string roomName)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomName);
        await Clients.Group(roomName).SendAsync("UserLeft", Context.UserIdentifier);
    }

    public async Task SendToRoom(string roomName, string message)
    {
        await Clients.Group(roomName).SendAsync("ReceiveMessage", message);
    }
}
```

## Dependency Injection in Hubs

```csharp
public class ChatHub : Hub
{
    private readonly ILogger<ChatHub> _logger;
    private readonly IChatService _chatService;

    public ChatHub(ILogger<ChatHub> logger, IChatService chatService)
    {
        _logger = logger;
        _chatService = chatService;
    }

    public async Task SendMessage(string message)
    {
        _logger.LogInformation("Message from {User}", Context.UserIdentifier);
        await _chatService.SaveMessageAsync(Context.UserIdentifier!, message);
        await Clients.All.SendAsync("ReceiveMessage", message);
    }
}
```

## Sending from Outside a Hub (IHubContext)

```csharp
public class NotificationService
{
    private readonly IHubContext<NotificationHub> _hubContext;

    public NotificationService(IHubContext<NotificationHub> hubContext)
    {
        _hubContext = hubContext;
    }

    public async Task SendNotificationAsync(string userId, string message)
    {
        await _hubContext.Clients.User(userId).SendAsync("Notify", message);
    }

    public async Task BroadcastAsync(string message)
    {
        await _hubContext.Clients.All.SendAsync("Notify", message);
    }
}
```

### Strongly-Typed IHubContext
```csharp
public class NotificationService
{
    private readonly IHubContext<NotificationHub, INotificationClient> _hubContext;

    public NotificationService(IHubContext<NotificationHub, INotificationClient> hubContext)
    {
        _hubContext = hubContext;
    }

    public Task NotifyUserAsync(string userId, string message)
        => _hubContext.Clients.User(userId).ReceiveNotification(message);
}
```

## JavaScript Client

```javascript
// Connect
const connection = new signalR.HubConnectionBuilder()
    .withUrl("/chat")
    .withAutomaticReconnect()
    .build();

// Handle server-to-client messages
connection.on("ReceiveMessage", (user, message) => {
    console.log(`${user}: ${message}`);
});

// Start connection
await connection.start();

// Call server method
await connection.invoke("SendMessage", "John", "Hello!");

// Call server method (fire and forget)
connection.send("SendMessage", "John", "Hello!");
```

## .NET Client

```csharp
var connection = new HubConnectionBuilder()
    .WithUrl("https://localhost:5001/chat")
    .WithAutomaticReconnect()
    .Build();

connection.On<string, string>("ReceiveMessage", (user, message) =>
{
    Console.WriteLine($"{user}: {message}");
});

await connection.StartAsync();

await connection.InvokeAsync("SendMessage", "John", "Hello!");
```

## Authentication

```csharp
// Require authentication for hub
[Authorize]
public class SecureChatHub : Hub
{
    public async Task SendMessage(string message)
    {
        var userName = Context.User?.Identity?.Name;
        await Clients.All.SendAsync("ReceiveMessage", userName, message);
    }
}

// Require specific role
[Authorize(Roles = "Admin")]
public async Task AdminAction()
{
    // Only admins can call this
}
```

## Error Handling

```csharp
public class ChatHub : Hub
{
    public async Task SendMessage(string message)
    {
        if (string.IsNullOrEmpty(message))
        {
            // HubException message is sent to client
            throw new HubException("Message cannot be empty");
        }

        await Clients.All.SendAsync("ReceiveMessage", message);
    }
}
```

## Best Practices

1. **Use Strongly-Typed Hubs**: Provides compile-time safety
2. **Keep Hubs Stateless**: Don't store state in hub properties (transient)
3. **Use Groups for Rooms**: Built-in efficient group management
4. **Enable Automatic Reconnect**: Client-side for reliability
5. **Handle Connection Events**: Track users in OnConnected/OnDisconnected
6. **Use IHubContext for Background**: Send messages from services/workers

## Common Gotchas

- **Hubs are Transient**: New instance per method call - don't store state
- **ConnectionId Changes**: Different on reconnect - track users by UserIdentifier
- **Groups Auto-Cleanup**: Users removed from groups on disconnect
- **Exceptions Hidden by Default**: Only HubException messages sent to client
- **await Required**: Always await SendAsync to ensure delivery
- **Scaling**: Use Redis backplane for multi-server deployments

````


