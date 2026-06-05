---
created: 2026-06-03
updated: 2026-06-04
category: lexicon
status: current
doc_kind: node
id: architecture-glossary
summary: Glossary of software architecture styles, patterns, and structural decisions.
tags: [lexicon, architecture]
---

# Software Architecture

## Architectural Styles

### Monolithic Architecture
**Definition:** A single-deployment-unit application where all concerns (UI, business logic, data access) are bundled together.
**Usage:** Use for simple applications, early-stage products, or teams that don't yet need service boundaries. The simplest architecture but limits independent scaling and deployment.
**Related:** Modular Monolith (structured monolith), Microservices (decomposed), Layered Architecture (organized monolith)
**Tags:** architecture, monolithic

### Modular Monolith
**Definition:** A single-deployment application with strict module boundaries, where modules communicate through well-defined interfaces but share the same process.
**Usage:** Use as a compromise between monolith simplicity and microservice discipline. Modules can later be extracted into services. Distinguish from Monolith (no module boundaries) and Microservices (separate processes).
**Related:** Monolithic Architecture (unstructured), Microservices (separate processes), Hexagonal Architecture (port-adapter pattern)
**Tags:** architecture, modular-monolith

### Microservices
**Definition:** An architectural style where an application is composed of small, independently deployable services that communicate over a network.
**Usage:** Use for large systems with independent scaling needs, multiple teams, or polyglot technology requirements. Not for simple applications where operational complexity outweighs benefits.
**Related:** Monolithic (opposite), Service Mesh (inter-service communication), Bounded Context (DDD service boundary)
**Tags:** architecture, microservices

### Serverless
**Definition:** An execution model where the cloud provider manages server allocation, scaling, and maintenance — code runs in stateless containers triggered by events.
**Usage:** Use for event-driven workloads, sporadic processing, or scenarios where infrastructure management overhead isn't justified. Distinguish from PaaS (always-on platform) and FaaS (function-level serverless).
**Related:** FaaS (function as a service), PaaS (platform as a service), Event-Driven (trigger model), Cold Start (initialization latency)
**Tags:** architecture, serverless, cloud

### Event-Driven Architecture
**Definition:** An architecture where components communicate by producing and consuming events through an event bus, without direct coupling.
**Usage:** Use for systems requiring loose coupling, asynchronous processing, or real-time event propagation. Distinguish from Request-Response (synchronous, coupled) and Message-Driven (commands, not events).
**Related:** Event Bus (the transport), Event Sourcing (event as state), CQRS (read/write separation), Message Queue (command-oriented)
**Tags:** architecture, event-driven

### Layered Architecture
**Definition:** A traditional architecture organizing code into horizontal layers (presentation, business, persistence, database) where each layer depends only on the layer below.
**Usage:** Use for straightforward CRUD applications where the layer boundaries match the team structure. Becomes restrictive as complexity grows — the layers don't naturally align with domain boundaries.
**Related:** Hexagonal Architecture (ports/adapters instead of layers), Clean Architecture (dependency inversion), Onion Architecture (domain-centric)
**Tags:** architecture, layered

### Hexagonal Architecture (Ports and Adapters)
**Definition:** An architecture that isolates core business logic from external concerns (UI, database, APIs) through port interfaces and adapter implementations.
**Usage:** Use when the core domain logic must be testable without infrastructure dependencies. Ports define what the core needs, adapters implement those ports for specific technologies.
**Related:** Clean Architecture (same concept, different naming), Onion Architecture (domain-centric layering), Dependency Inversion (the principle)
**Tags:** architecture, hexagonal

### Clean Architecture
**Definition:** An architecture with concentric layers — entities (innermost), use cases, interface adapters, frameworks/drivers (outermost) — enforcing dependency rule (inward only).
**Usage:** Use for complex business applications where domain logic independence from frameworks is critical. Same principle as Hexagonal but with different terminology and layer count.
**Related:** Hexagonal Architecture (ports/adapters), Onion Architecture (domain model center), Dependency Inversion (the principle)
**Tags:** architecture, clean-architecture

### Onion Architecture
**Definition:** An architecture with the domain model at the center, surrounded by domain services, application services, and infrastructure at the outermost ring.
**Usage:** Use for DDD-aligned applications where the domain model is the most important asset. Similar to Clean Architecture and Hexagonal — the key is dependency direction (always inward).
**Related:** Clean Architecture (same idea), Hexagonal Architecture (same idea), DDD (the domain modeling approach)
**Tags:** architecture, onion

### CQRS (Command Query Responsibility Segregation)
**Definition:** A pattern that separates read operations (queries) from write operations (commands), each using different models and potentially different data stores.
**Usage:** Use when read and write workloads have different shapes, scales, or consistency requirements. Distinguish from CRUD (single model for all operations) — CQRS acknowledges that reads and writes are different.
**Related:** Event Sourcing (often paired with CQRS), Read Model (optimized for queries), Command (state-changing operation)
**Tags:** architecture, cqrs

### Event Sourcing
**Definition:** A pattern where state changes are stored as an append-only sequence of events, and the current state is derived by replaying those events.
**Usage:** Use for audit trails, temporal queries, or complex state reconstruction needs. Distinguish from CQRS (read/write separation) — Event Sourcing is about state storage, CQRS is about model separation.
**Related:** CQRS (often paired), Event Store (append-only storage), Snapshot (optimized replay), Projection (derived read model)
**Tags:** architecture, event-sourcing

### Lambda Architecture
**Definition:** A data processing architecture with batch (accurate, high-latency) and speed (approximate, low-latency) layers, merged in the serving layer.
**Usage:** Use for big data systems requiring both accurate historical analysis and real-time views. Largely superseded by Kappa Architecture (stream-only) where possible.
**Related:** Kappa Architecture (stream-only), Batch Processing (the batch layer), Stream Processing (the speed layer), Data Lake (storage)
**Tags:** architecture, data, lambda

### Kappa Architecture
**Definition:** A data processing architecture where all data is treated as a stream, processed through a single pipeline, with batch as a special case of stream.
**Usage:** Prefer over Lambda when stream processing technology (Kafka, Flink) can handle the full throughput. Simpler to operate — one pipeline instead of two.
**Related:** Lambda Architecture (batch + stream), Stream Processing (continuous), Event Sourcing (event-as-truth)
**Tags:** architecture, data, kappa

### Service Mesh
**Definition:** A dedicated infrastructure layer for managing service-to-service communication, providing traffic management, security, and observability without code changes.
**Usage:** Use in microservice deployments to offload cross-cutting concerns (retry, circuit breaking, tracing, mTLS) from application code. Typically implemented via sidecar proxies.
**Related:** Sidecar (the proxy), Microservices (the consumers), API Gateway (edge-level, not mesh), Istio/Linkerd (implementations)
**Tags:** architecture, networking, service-mesh

### Backend for Frontend (BFF)
**Definition:** A dedicated backend for each frontend client type, optimizing the API for that specific client's needs rather than a one-size-fits-all API.
**Usage:** Use when different clients (mobile, web, API consumers) need different data shapes, aggregation patterns, or authentication flows. Distinguish from API Gateway (routing, not client-specific).
**Related:** API Gateway (edge routing), GraphQL (client-specified queries), BFF (client-specific backend)
**Tags:** architecture, api, bff

## Design Patterns

### Singleton
**Definition:** A creational pattern ensuring a class has exactly one instance and providing a global access point to it.
**Usage:** Use for shared resources (configuration, logging, connection pools) where a single instance is semantically correct. Avoid for general-purpose use — singletons introduce hidden global state and hinder testing.
**Related:** Factory (creates instances), Dependency Injection (manages singletons better), Global State (anti-pattern)
**Tags:** architecture, patterns, singleton

### Factory
**Definition:** A creational pattern that provides an interface for creating objects without specifying their concrete classes.
**Usage:** Use when object creation is complex, conditional, or should be decoupled from the caller. The caller asks for a type, the factory decides which concrete class to instantiate.
**Related:** Abstract Factory (factory of factories), Builder (step-by-step construction), Dependency Injection (assembles object graphs)
**Tags:** architecture, patterns, factory

### Builder
**Definition:** A creational pattern that separates object construction from its representation, allowing the same construction process to create different representations.
**Usage:** Use for objects with many optional parameters, complex construction logic, or configurations that vary by context. Fluent builder interfaces improve readability.
**Related:** Factory (single-step creation), Prototype (clone-based), Fluent Interface (builder pattern variant)
**Tags:** architecture, patterns, builder

### Adapter
**Definition:** A structural pattern that allows incompatible interfaces to work together by wrapping one interface in another the client expects.
**Usage:** Use when integrating with third-party libraries, legacy systems, or any component whose interface doesn't match your domain. Distinguish from Facade (simplifies, doesn't translate) and Proxy (controls access, doesn't translate).
**Related:** Facade (simplified interface), Proxy (access control), Bridge (abstraction from implementation)
**Tags:** architecture, patterns, adapter

### Facade
**Definition:** A structural pattern that provides a simplified interface to a complex subsystem.
**Usage:** Use to reduce coupling between clients and complex subsystems. A facade exposes a minimal, focused API while hiding internal complexity. Distinguish from Adapter (translates interfaces) — Facade simplifies.
**Related:** Adapter (interface translation), Proxy (access control), Mediator (coordinates, doesn't simplify)
**Tags:** architecture, patterns, facade

### Proxy
**Definition:** A structural pattern that provides a surrogate or placeholder for another object to control access, lazy-loading, or logging.
**Usage:** Use for lazy initialization, access control, logging, or remote object representation. The proxy implements the same interface as the real object, so clients are unaware of the proxy.
**Related:** Decorator (adds behavior, same interface), Adapter (translates interface), Virtual Proxy (lazy loading)
**Tags:** architecture, patterns, proxy

### Decorator
**Definition:** A structural pattern that attaches additional responsibilities to an object dynamically, without modifying its class.
**Usage:** Use for adding cross-cutting behavior (logging, caching, validation) to individual objects without affecting all instances of a class. Distinguish from Proxy (controls access) — Decorator adds behavior.
**Related:** Proxy (access control), Adapter (translation), Chain of Responsibility (dynamic handler chain)
**Tags:** architecture, patterns, decorator

### Observer
**Definition:** A behavioral pattern where an object (subject) maintains a list of dependents (observers) and notifies them of state changes.
**Usage:** Use for event handling systems, pub/sub architectures, or any one-to-many notification scenario. Distinguish from Pub/Sub (asynchronous, often via message broker) — Observer is typically synchronous and in-process.
**Related:** Pub/Sub (asynchronous variant), Event Emitter (implementation), Reactive Streams (backpressure variant)
**Tags:** architecture, patterns, observer

### Strategy
**Definition:** A behavioral pattern that defines a family of interchangeable algorithms, encapsulating each one and making them swappable at runtime.
**Usage:** Use when multiple algorithms exist for the same task and should be interchangeable without conditional logic. Distinguish from State (changes behavior based on internal state) — Strategy is caller-chosen.
**Related:** State (state-driven behavior change), Template Method (inheritance-based algorithm), Policy (business rules)
**Tags:** architecture, patterns, strategy

### Command
**Definition:** A behavioral pattern that encapsulates a request as an object, allowing parameterization, queuing, logging, and undo of operations.
**Usage:** Use for undo/redo systems, task queues, operation logging, or any scenario where actions should be treated as first-class objects. Distinguish from Strategy (algorithm selection) — Command is about action encapsulation.
**Related:** Strategy (algorithm, not action), Memento (state snapshot for undo), Chain of Responsibility (handler chain)
**Tags:** architecture, patterns, command

### Chain of Responsibility
**Definition:** A behavioral pattern that passes a request along a chain of handlers until one handles it, decoupling sender from receiver.
**Usage:** Use for middleware pipelines, validation chains, or any sequential processing where each handler decides whether to process or pass on. Distinguish from Decorator (adds behavior unconditionally) — Chain stops at first match.
**Related:** Decorator (additive, no stop), Middleware (web framework variant), Pipeline (data transformation variant)
**Tags:** architecture, patterns, chain-of-responsibility

### Template Method
**Definition:** A behavioral pattern that defines the skeleton of an algorithm in a base class, letting subclasses override specific steps without changing the algorithm's structure.
**Usage:** Use when multiple implementations share the same algorithm structure but vary in specific steps. Distinguish from Strategy (composition-based) — Template Method uses inheritance.
**Related:** Strategy (composition over inheritance), Hook (optional override point), Inversion of Control (framework calls you)
**Tags:** architecture, patterns, template-method

## Domain-Driven Design

### Bounded Context
**Definition:** A distinct boundary within which a particular domain model applies, with its own ubiquitous language, entities, and invariants.
**Usage:** Use to define service boundaries in microservices or module boundaries in monoliths. Each bounded context has its own terminology that may differ from other contexts. The same term can mean different things in different contexts.
**Related:** Ubiquitous Language (the language within), Context Map (the relationships), Anti-corruption Layer (context boundary translator)
**Tags:** architecture, ddd, bounded-context

### Ubiquitous Language
**Definition:** A shared, rigorous language used consistently by domain experts, developers, and the code itself within a bounded context.
**Usage:** Build iteratively through conversation. When a domain expert and developer use different words for the same concept, that's a language gap that must be resolved. The language should be reflected in class names, method names, and tests.
**Related:** Bounded Context (the scope), Domain Expert (the source), Entity (the code representation)
**Tags:** architecture, ddd, ubiquitous-language

### Entity
**Definition:** A domain object with a distinct identity that runs through time and state changes, rather than being defined by its attributes.
**Usage:** Use for objects that have a lifecycle and need to be tracked — Customer, Order, Product. Two entities with the same attributes but different IDs are different. Distinguish from Value Object (defined by attributes, no identity).
**Related:** Value Object (defined by attributes), Aggregate Root (the entity that owns others), Identity (the tracking mechanism)
**Tags:** architecture, ddd, entity

### Value Object
**Definition:** A domain object defined entirely by its attributes, with no identity, and immutable once created.
**Usage:** Use for descriptive concepts — Address, Money, Email, Color. Two value objects with the same attributes are interchangeable. Distinguish from Entity (has identity, mutable lifecycle).
**Related:** Entity (has identity), Immutability (value object property), Money Pattern (value object example)
**Tags:** architecture, ddd, value-object

### Aggregate
**Definition:** A cluster of domain objects treated as a single unit, with an aggregate root that enforces invariants for the entire cluster.
**Usage:** Use to define consistency boundaries. Changes to any object within the aggregate go through the root. Aggregates are loaded and saved as a whole. Distinguish from Entity (single object) — Aggregate is a cluster.
**Related:** Aggregate Root (the entry point), Entity (may be inside), Invariant (must always hold)
**Tags:** architecture, ddd, aggregate

### Aggregate Root
**Definition:** The single entity within an aggregate that external objects reference — all access to the aggregate goes through this root.
**Usage:** Use as the entry point for aggregate operations. External objects hold references only to the root, not to internal entities. The root enforces invariants for the entire aggregate.
**Related:** Aggregate (the cluster), Entity (inside), Repository (persistence for the root)
**Tags:** architecture, ddd, aggregate-root

### Domain Event
**Definition:** Something that happened in the domain that domain experts care about — OrderPlaced, PaymentReceived, InvoiceSent — stored as a past-tense fact.
**Usage:** Use to communicate state changes across bounded contexts or trigger side effects within a context. Events are immutable records of past facts. Distinguish from Command (intended action, not yet happened).
**Related:** Command (intent, not fact), Event Sourcing (events as state), Integration Event (cross-context)
**Tags:** architecture, ddd, domain-event

### Domain Service
**Definition:** A stateless service that coordinates domain operations that don't naturally fit on a single entity or value object.
**Usage:** Use when an operation involves multiple domain objects or external systems and doesn't belong on any single entity. Name it after the domain concept, not the technical pattern. Distinguish from Application Service (orchestrates, not domain logic).
**Related:** Application Service (orchestration), Entity (where logic belongs first), Domain Event (side effects)
**Tags:** architecture, ddd, domain-service

### Repository
**Definition:** A collection-like interface for accessing domain objects from persistence, abstracting the storage technology behind a domain-focused contract.
**Usage:** Use per aggregate root to provide a persistence abstraction that the domain code can depend on. The repository speaks in terms of domain objects, not database records. Distinguish from DAO (data-focused, CRUD operations).
**Related:** DAO (data-focused), Unit of Work (transaction coordination), Aggregate Root (what repositories manage)
**Tags:** architecture, ddd, repository

### Anti-corruption Layer
**Definition:** A boundary layer that translates between a bounded context and an external system, preventing the external model from leaking into the domain.
**Usage:** Use at integration boundaries with legacy systems, third-party APIs, or other bounded contexts. The ACL translates, adapts, and protects the domain from foreign concepts. Distinguish from Adapter (interface translation) — ACL also translates models.
**Related:** Bounded Context (the boundary), Adapter (technical translation), Facade (simplification)
**Tags:** architecture, ddd, anti-corruption-layer

### Context Map
**Definition:** A visual diagram or document showing the relationships between bounded contexts — partnership, shared kernel, customer-supplier, conformist, anticorruption-layer, open-host service, published language, separate ways, big ball of mud.
**Usage:** Use to document and communicate how bounded contexts relate. Each relationship type has different integration and governance implications. Key tool for multi-team DDD projects.
**Related:** Bounded Context (the nodes), Relationship (the edges), Integration (the implementation)
**Tags:** architecture, ddd, context-map

## Architecture Concepts

### Separation of Concerns (SoC)
**Definition:** A design principle that different concerns (UI, business logic, persistence) should be separated into distinct sections, with minimal overlap.
**Usage:** Apply to all design decisions. If a module handles multiple concerns (e.g., validating input AND querying the database), split it. SoC is the foundation of most architecture patterns.
**Related:** Single Responsibility (SoC at class level), Modularity (SoC at module level), Cross-cutting Concern (concerns that span modules)
**Tags:** architecture, principles, separation-of-concerns

### Inversion of Control (IoC)
**Definition:** A principle where the control flow of a program is inverted: instead of code calling framework methods, the framework calls the code.
**Usage:** Use for frameworks, dependency injection containers, or event-driven systems. The framework controls the flow; your code implements hooks. Distinguish from Dependency Injection (a form of IoC).
**Related:** Dependency Injection (IoC implementation), Hollywood Principle (Don't call us, we'll call you), Framework (IoC container)
**Tags:** architecture, principles, inversion-of-control

### Dependency Injection (DI)
**Definition:** A technique where an object receives its dependencies from an external source rather than creating them internally, promoting loose coupling.
**Usage:** Use to decouple class creation from class usage. Dependencies are provided (injected) rather than created (newed up). DI is a specific form of Inversion of Control.
**Related:** Inversion of Control (broader principle), Service Locator (alternative), Constructor Injection (the most common DI pattern)
**Tags:** architecture, principles, dependency-injection

### Composition over Inheritance
**Definition:** A design principle favoring composing objects with behaviors through delegation rather than inheriting behaviors through class hierarchy.
**Usage:** Apply when you need reusable behaviors. Composition is more flexible (can change at runtime), less fragile (no deep inheritance chains), and easier to test. Distinguish from Inheritance (compile-time, rigid).
**Related:** Inheritance (the alternative), Strategy Pattern (composition example), Decorator (composition)
**Tags:** architecture, principles, composition

### Loose Coupling
**Definition:** A design goal where components have minimal knowledge of each other, communicating through well-defined interfaces.
**Usage:** Apply to reduce the ripple effect of changes — a change in one component should require minimal or no changes in others. Measured by how many other modules change when a module changes.
**Related:** High Cohesion (the counterpart), Interface Segregation (small, focused interfaces), Dependency Inversion (depending on abstractions)
**Tags:** architecture, principles, loose-coupling

### High Cohesion
**Definition:** A design goal where the elements within a module are strongly related and serve a single, well-defined purpose.
**Usage:** Apply to keep modules focused. High cohesion makes modules easier to understand, test, and maintain. Distinguish from Loose Coupling (between modules) — Cohesion is within a module.
**Related:** Loose Coupling (the counterpart), Single Responsibility (at class level), Module (the scope)
**Tags:** architecture, principles, high-cohesion

### Convention over Configuration
**Definition:** A design paradigm where sensible defaults (conventions) reduce the need for explicit configuration, with overrides available when needed.
**Usage:** Use for frameworks and libraries to improve developer experience. Users follow conventions for the common case and only configure when they deviate. Distinguish from Configuration (explicit, verbose).
**Related:** Sensible Defaults (the convention), Configuration (the override), Opinionated Framework (designs by this principle)
**Tags:** architecture, principles, convention-over-configuration
