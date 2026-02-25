---
created: 2026-02-25
updated: 2026-02-25
category: system
status: current
doc_kind: node
id: software-design-concepts-glossary
summary: Comprehensive software design concepts, patterns, and decision heuristics for improved agent prompting.
tags: [design, patterns, architecture, glossary]
related: [moc-software-design-concepts, orchestration-and-agents]
---

# Software Design Concepts Glossary

A reference of software design keywords, concepts, patterns, and decision frameworks to help agents produce higher-quality, design-aware code.

## Concept Categories

### Structural Patterns
- **Layered Architecture** — Separate concerns into layers (presentation, business logic, data access). Each layer depends only on the layer below.
- **Hexagonal Architecture (Ports & Adapters)** — Core business logic is isolated; external systems connect through ports (interfaces) and adapters (implementations).
- **Clean Architecture** — Dependency rule: inner layers know nothing about outer layers. Entities → Use Cases → Interface Adapters → Frameworks.
- **Microservices** — Independently deployable services with bounded contexts. Communicate via APIs or messaging.
- **Monolith (Modular)** — Single deployable unit with well-defined internal module boundaries. Simpler ops than microservices.
- **Event-Driven Architecture** — Components communicate through events. Enables loose coupling and temporal decoupling.
- **CQRS (Command Query Responsibility Segregation)** — Separate read and write models. Optimizes each for its workload.
- **Event Sourcing** — Store state as a sequence of events rather than current state snapshots. Enables full audit trail and temporal queries.

### Creational Patterns
- **Factory Method** — Delegate object creation to subclasses or factory functions.
- **Builder** — Construct complex objects step-by-step with a fluent interface.
- **Singleton** — Ensure exactly one instance. Use sparingly; prefer DI container scoping.
- **Dependency Injection** — Supply dependencies from outside rather than constructing them internally.

### Behavioral Patterns
- **Strategy** — Define a family of algorithms, encapsulate each, make them interchangeable.
- **Observer** — One-to-many dependency; when one object changes, all dependents are notified.
- **Command** — Encapsulate a request as an object. Enables undo, queuing, and logging.
- **Chain of Responsibility** — Pass requests along a chain of handlers until one handles it.
- **Mediator** — Centralize complex communications between objects.
- **State Machine** — Model object behavior as explicit states and transitions.

### Data & Integration Patterns
- **Repository** — Abstract data access behind a collection-like interface.
- **Unit of Work** — Track changes across multiple operations and commit them atomically.
- **Specification** — Encapsulate query/filter logic as composable, reusable objects.
- **Saga** — Manage distributed transactions as a sequence of local transactions with compensating actions.
- **Outbox** — Reliably publish events alongside database writes using a transactional outbox table.
- **Circuit Breaker** — Prevent cascading failures by stopping calls to a failing service.
- **Retry with Backoff** — Automatically retry failed operations with increasing delays.
- **Bulkhead** — Isolate components so that failure in one doesn't cascade to others.

### API & Interface Design
- **REST** — Resource-oriented API design with standard HTTP methods and status codes.
- **GraphQL** — Client-specified queries for flexible data fetching.
- **gRPC** — High-performance RPC with Protocol Buffers for service-to-service communication.
- **API Versioning** — Maintain backward compatibility through URL, header, or content negotiation versioning.
- **Idempotency** — Ensure that repeating an operation produces the same result. Critical for reliable APIs.
- **Pagination** — Return large datasets in manageable chunks (offset, cursor, keyset).

### Testing Concepts
- **Unit Test** — Test a single unit in isolation with mocked dependencies.
- **Integration Test** — Test interactions between components with real (or realistic) dependencies.
- **Contract Test** — Verify that service interfaces match agreed contracts.
- **Property-Based Test** — Generate random inputs to find edge cases automatically.
- **Snapshot Test** — Compare output against a stored reference snapshot.
- **Test Double** — Generic term for mock, stub, fake, spy, or dummy used in place of real dependencies.
- **Arrange-Act-Assert (AAA)** — Standard test structure: set up, execute, verify.
- **Test Pyramid** — Many unit tests, fewer integration tests, fewest E2E tests.

### Security Concepts
- **Defense in Depth** — Multiple layers of security controls.
- **Principle of Least Privilege** — Grant only the minimum access needed.
- **Zero Trust** — Never trust, always verify. Authenticate and authorize every request.
- **Input Validation** — Validate all external input at system boundaries.
- **Output Encoding** — Encode output to prevent injection (XSS, SQL injection).
- **Secrets Management** — Store secrets in vaults or environment variables, never in code.

### Concurrency & Distributed Systems
- **CAP Theorem** — Consistency, Availability, Partition Tolerance: pick two.
- **Eventual Consistency** — System will converge to consistent state given enough time.
- **Optimistic Concurrency** — Detect conflicts at commit time rather than locking upfront.
- **Pessimistic Locking** — Lock resources before modification to prevent conflicts.
- **Idempotent Consumer** — Handle duplicate messages safely by tracking processed message IDs.
- **Leader Election** — Distributed algorithm to choose a single coordinator.

## Pattern Vs Anti-Pattern

| Pattern | Anti-Pattern | Why It Matters |
|---------|-------------|---------------|
| Dependency Injection | Service Locator (hidden) | Explicit dependencies improve testability and readability |
| Strategy | Giant if/else chains | Extensibility without modifying existing code |
| Repository | Leaky data access | Swappable data stores, testable business logic |
| Circuit Breaker | Unbounded retries | Prevents cascading failures in distributed systems |
| Event-Driven | Tight polling loops | Scalable, decoupled communication |
| Clean Architecture | Big Ball of Mud | Maintainable, testable, adaptable codebase |
| CQRS | One-size-fits-all queries | Optimized read/write performance |
| Saga | Distributed 2PC | Reliable distributed workflows without global locks |
| Bulkhead | Shared resource pools | Fault isolation between components |
| Idempotency Keys | Fire-and-forget | Reliable operations in unreliable networks |

## Decision Heuristics

### When to use what
1. **Start simple** — Monolith first, extract microservices only when independently scaling a component.
2. **Prefer composition over inheritance** — Compose behaviors; inheritance creates rigid hierarchies.
3. **YAGNI** — Don't build abstractions for hypothetical future requirements.
4. **DRY with caution** — Remove true duplication; don't over-abstract coincidental similarity.
5. **Fail fast** — Validate inputs early; fail explicitly rather than silently corrupt state.
6. **Make invalid states unrepresentable** — Use types to prevent impossible states at compile time.
7. **Immutability by default** — Mutable state is the primary source of bugs in concurrent systems.
8. **Explicit > Implicit** — Prefer explicit configuration, dependencies, and error handling.
9. **Design for testability** — If it's hard to test, the design probably needs improvement.
10. **Optimize for readability** — Code is read far more often than written.

### Trade-off matrix
| Concern | Prefer When | Avoid When |
|---------|------------|------------|
| Microservices | Team-per-service, independent deployments | Small team, shared data model |
| Event Sourcing | Full audit trail, temporal queries needed | Simple CRUD, no replay requirements |
| CQRS | Asymmetric read/write loads | Simple domain, uniform access |
| GraphQL | Multiple clients with different data needs | Single client, simple API surface |
| gRPC | Internal service-to-service, high throughput | Browser clients, simple REST suffices |

## Prompt Tags

Use these tags in prompts to activate specific design thinking:

- `[SOLID]` — Apply Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion.
- `[DDD]` — Use Domain-Driven Design: bounded contexts, aggregates, value objects, domain events.
- `[TDD]` — Write tests first, then implementation.
- `[CLEAN-ARCH]` — Enforce dependency rule: inner layers independent of outer.
- `[CQRS]` — Separate command and query paths.
- `[EVENT-DRIVEN]` — Design around domain events and handlers.
- `[RESILIENCE]` — Apply circuit breakers, retries, bulkheads, timeouts.
- `[SECURITY]` — Apply defense-in-depth, input validation, least privilege.
- `[PERF]` — Profile first, optimize bottlenecks, measure after.
- `[API-FIRST]` — Design the API contract before implementation.
- `[TESTABLE]` — Ensure every component can be tested in isolation.
- `[IMMUTABLE]` — Prefer immutable data structures and pure functions.
- `[OBSERVABLE]` — Add structured logging, metrics, and distributed tracing.

## Taxonomy Map

```
Software Design
├── Architecture Styles
│   ├── Monolith (Modular)
│   ├── Microservices
│   ├── Event-Driven
│   ├── Hexagonal / Clean
│   └── Serverless
├── Design Patterns
│   ├── Creational (Factory, Builder, Singleton, DI)
│   ├── Structural (Adapter, Decorator, Facade, Proxy)
│   ├── Behavioral (Strategy, Observer, Command, State)
│   └── Integration (Repository, Saga, Outbox, Circuit Breaker)
├── Design Principles
│   ├── SOLID
│   ├── DRY / YAGNI / KISS
│   ├── Composition over Inheritance
│   ├── Separation of Concerns
│   └── Fail Fast
├── Quality Attributes
│   ├── Maintainability
│   ├── Testability
│   ├── Scalability
│   ├── Reliability
│   ├── Security
│   └── Observability
└── Decision Frameworks
    ├── ADR (Architecture Decision Records)
    ├── Trade-off Analysis
    ├── Fitness Functions
    └── Evolutionary Architecture
```

## Decision Flow

When an agent encounters a design decision:

1. **Identify** the design dimension (structural, behavioral, data, integration, cross-cutting).
2. **Check constraints** — existing patterns in the codebase, team conventions, framework requirements.
3. **Evaluate options** using the trade-off matrix and decision heuristics.
4. **Select** the simplest approach that meets current requirements (YAGNI).
5. **Document** the decision rationale inline or in an ADR if non-obvious.
6. **Validate** with tests — if the design is hard to test, reconsider.
