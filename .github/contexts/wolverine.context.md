---
description: "Context: Wolverine messaging and command bus."
---

# Wolverine Context

## Overview
Wolverine is a .NET command bus and messaging library.

## Patterns
- **Handlers**: `public class [Name]Handler { public void Handle([Message] msg) { ... } }`.
- **Middleware**: Use attributes or `policies` to apply middleware.
- **Cascading Messages**: Return `IEnumerable<object>` or `object` from handlers to publish new messages.

## Transports
- **Local**: In-memory (default).
- **RabbitMQ**: For inter-service communication.
- **Azure Service Bus**: For cloud messaging.

## Best Practices
- Keep handlers pure and testable.
- Use `IMessageContext` only when necessary.
- Prefer constructor injection for dependencies.
