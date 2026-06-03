# Programming & Paradigms

## Paradigms

### Object-Oriented Programming (OOP)
**Definition:** A programming paradigm based on objects containing data and behavior, using encapsulation, inheritance, and polymorphism.
**Usage:** Dominant paradigm for large-scale applications. Organizes code around entities and their interactions. Distinguish from Functional Programming (stateless, pure functions) and Procedural (linear instructions).
**Related:** Functional Programming (alternative paradigm), Encapsulation (OOP principle), Class (OOP building block)
**Tags:** programming, oop, paradigm

### Functional Programming (FP)
**Definition:** A programming paradigm based on pure functions, immutability, and declarative expression, avoiding shared state and side effects.
**Usage:** Preferred for data processing, concurrent systems, and scenarios where correctness and testability are paramount. Increasingly adopted within OOP languages through FP features.
**Related:** OOP (alternative paradigm), Pure Function (FP building block), Immutability (FP principle), Monad (FP pattern)
**Tags:** programming, fp, paradigm

### Declarative Programming
**Definition:** A programming style expressing what the result should be without describing how to achieve it — SQL, HTML, configuration files.
**Usage:** Use when the domain is well-suited to describing outcomes rather than steps. Distinguish from Imperative (step-by-step instructions). Declarative code is often more concise and less error-prone.
**Related:** Imperative (step-by-step), DSL (domain-specific declarative language), Query (declarative data retrieval)
**Tags:** programming, declarative, paradigm

### Imperative Programming
**Definition:** A programming style using explicit statements that change program state, describing step-by-step how to achieve a result.
**Usage:** The most intuitive paradigm for simple algorithms and scripts. Most developers think imperatively by default. Distinguish from Declarative (specifies what, not how).
**Related:** Declarative (what-oriented), Procedural (organized imperative), Statement (imperative building block)
**Tags:** programming, imperative, paradigm

### Reactive Programming
**Definition:** A programming paradigm oriented around data streams and propagation of change, where systems react to events asynchronously.
**Usage:** Use for UI event handling, real-time data processing, or any system where asynchronous data flows are central. Distinguish from Event-Driven (broader concept) — Reactive is a specific programming model.
**Related:** Event-Driven (broader), Observable (Reactive primitive), Stream (data flow), Backpressure (flow control)
**Tags:** programming, reactive, paradigm

## OOP Principles

### Encapsulation
**Definition:** The bundling of data and methods that operate on that data within a single unit (class), hiding internal state and requiring all interaction through public methods.
**Usage:** Apply to protect invariants and reduce coupling. External code shouldn't know or care about internal implementation. Distinguish from Abstraction (hiding complexity) — Encapsulation is about hiding data.
**Related:** Abstraction (hiding complexity), Information Hiding (the goal), Access Modifier (the mechanism)
**Tags:** programming, oop, encapsulation

### Inheritance
**Definition:** A mechanism where a class derives properties and behavior from a parent class, establishing an "is-a" relationship.
**Usage:** Use for genuine type hierarchies (Dog is-a Animal). Prefer composition over inheritance for code reuse. Deep inheritance hierarchies are fragile and hard to maintain.
**Related:** Composition (reuse alternative), Polymorphism (enabled by inheritance), Base Class (the parent)
**Tags:** programming, oop, inheritance

### Polymorphism
**Definition:** The ability of different classes to respond to the same message (method call) in their own way, determined at runtime.
**Usage:** Use to write code that works with any type implementing a known interface, enabling substitution without conditional logic. The foundation of many design patterns and testability.
**Related:** Interface (polymorphism contract), Virtual Method (runtime dispatch), Duck Typing (duck typing)
**Tags:** programming, oop, polymorphism

### Abstraction
**Definition:** The practice of hiding complex implementation details behind a simplified interface, exposing only what's necessary.
**Usage:** Apply at every level — functions abstract algorithms, classes abstract state, interfaces abstract implementations. Distinguish from Encapsulation (hiding data) — Abstraction is about hiding complexity.
**Related:** Encapsulation (hiding data), Interface (abstraction boundary), API (the ultimate abstraction)
**Tags:** programming, oop, abstraction

### SOLID Principles
**Definition:** Five OOP design principles: Single Responsibility (a class should have one reason to change), Open-Closed (open for extension, closed for modification), Liskov Substitution (subtypes must be substitutable for their base types), Interface Segregation (small, focused interfaces), Dependency Inversion (depend on abstractions, not concretions).
**Usage:** Apply as design guidelines, not rigid rules. SOLID leads to more maintainable, testable code when followed with judgment. Violating SOLID is often the first sign of design rot.
**Related:** Single Responsibility (SRP), Open-Closed (OCP), Liskov Substitution (LSP), Interface Segregation (ISP), Dependency Inversion (DIP)
**Tags:** programming, oop, solid

### Single Responsibility Principle (SRP)
**Definition:** A class should have only one reason to change, meaning it should have only one responsibility or concern.
**Usage:** Apply to keep classes focused and testable. If you struggle to name what a class does in one sentence, it probably has multiple responsibilities. The most impactful SOLID principle.
**Related:** SOLID (the set), Separation of Concerns (broader), Cohesion (measure of focus)
**Tags:** programming, oop, solid, srp

## Functional Concepts

### Pure Function
**Definition:** A function that always produces the same output for the same input and has no side effects (doesn't modify state, I/O, or external systems).
**Usage:** Use for predictable, testable, parallelizable logic. Pure functions are the foundation of functional programming. Distinguish from Impure Function (has side effects, non-deterministic).
**Related:** Side Effect (what pure functions avoid), Referential Transparency (replaceable with its value), Immutability (pure data)
**Tags:** programming, fp, pure-function

### Immutability
**Definition:** The practice of never modifying data in place — instead, creating new copies with the desired changes.
**Usage:** Apply to prevent unintended state changes, especially in concurrent or reactive systems. Immutable data is inherently thread-safe and easier to reason about. Distinguish from Const (variable binding, not data immutability).
**Related:** Pure Function (benefits from immutability), Side Effect (mutation is a side effect), Persistent Data Structure (efficient immutability)
**Tags:** programming, fp, immutability

### Side Effect
**Definition:** Any observable effect of a function beyond returning a value — modifying a global variable, writing to a file, making a network request.
**Usage:** Minimize side effects and push them to the boundaries of the system. Core logic should be pure; only the outer layer should handle I/O. Distinguish from Pure Function (no side effects).
**Related:** Pure Function (no side effects), Referential Transparency (no side effects), Effect (controlled side effect)
**Tags:** programming, fp, side-effect

### Higher-Order Function
**Definition:** A function that takes other functions as arguments, returns a function, or both.
**Usage:** Use for abstraction, composition, and reusability. Map, filter, reduce are classic examples. Higher-order functions enable declarative data processing.
**Related:** First-Class Function (functions as values), Closure (function + captured scope), Currying (transforming multi-arg functions)
**Tags:** programming, fp, higher-order-function

### Closure
**Definition:** A function that captures variables from its lexical scope, maintaining access to them even after the outer function has returned.
**Usage:** Use for data hiding, partial application, and callback creation. Closures enable encapsulation in functional style. Distinguish from Lambda (anonymous function, may not close over anything).
**Related:** Lambda (anonymous function), Scope (the captured context), Partial Application (using closures to fix arguments)
**Tags:** programming, fp, closure

### Currying
**Definition:** Transforming a function that takes multiple arguments into a chain of functions that each take a single argument.
**Usage:** Use for partial application and function composition. Curried functions give you flexibility to fix arguments incrementally. Common in FP languages; less natural in OOP languages.
**Related:** Partial Application (fixing arguments), Higher-Order Function (returns functions), Uncurrying (the reverse)
**Tags:** programming, fp, currying

### Monad
**Definition:** A design pattern that encapsulates a value with additional context (optionality, asynchrony, error handling) and provides composition through flatMap/bind.
**Usage:** Use to chain computations that work with wrapped values — Option/Maybe (nullable), Result/Either (error handling), Promise (async). Distinguish from Functor (map only, no flattening) — Monad adds the ability to flatten nested wrappers.
**Related:** Functor (map-only), Either (error monad), Maybe/Option (optional monad), Promise/Future (async monad)
**Tags:** programming, fp, monad

### Recursion
**Definition:** A technique where a function calls itself to solve a problem by breaking it into smaller instances of the same problem.
**Usage:** Use for tree traversal, divide-and-conquer algorithms, or problems that have a natural recursive structure. Distinguish from Iteration (looping) — recursion often expresses the solution more naturally.
**Related:** Tail Recursion (optimized recursion), Base Case (termination condition), Divide and Conquer (recursive strategy)
**Tags:** programming, fp, recursion

### Memoization
**Definition:** An optimization technique that caches the results of expensive function calls and returns the cached result when the same inputs occur again.
**Usage:** Use for pure functions with expensive computation and repeated calls with the same arguments. Distinguish from Caching (broader, may be on I/O or database results) — Memoization is specifically for function call results.
**Related:** Caching (broader), Pure Function (safe to memoize), Lazy Evaluation (deferring computation)
**Tags:** programming, fp, memoization

## Types

### Static Typing
**Definition:** A type system where variable types are known at compile time, and type errors are caught before execution.
**Usage:** Use for large codebases, critical systems, or teams where catching errors early is more important than rapid prototyping. Distinguish from Dynamic Typing (types determined at runtime).
**Related:** Dynamic Typing (runtime types), Type Inference (types deduced by compiler), Type Safety (preventing type errors)
**Tags:** programming, types, static-typing

### Dynamic Typing
**Definition:** A type system where variable types are determined at runtime, and type errors are caught during execution.
**Usage:** Use for rapid prototyping, scripting, or codebases where flexibility outweighs early error detection. Distinguish from Static Typing (compile-time checking).
**Related:** Static Typing (compile-time), Duck Typing (shape-based, not explicit), Gradual Typing (mixed static/dynamic)
**Tags:** programming, types, dynamic-typing

### Duck Typing
**Definition:** A style of typing where an object's suitability is determined by whether it has the right methods/properties, not by its declared type — "if it walks like a duck and quacks like a duck, it's a duck."
**Usage:** Common in dynamically-typed languages (Python, JavaScript). Enables polymorphism without explicit interfaces. Distinguish from Structural Typing (compiler-checked structural compatibility).
**Related:** Structural Typing (compiler-checked), Nominal Typing (name-based), Protocol (Python's structural typing mechanism)
**Tags:** programming, types, duck-typing

### Generics
**Definition:** A feature that allows types to be parameterized, enabling reusable functions and data structures that work with any type while maintaining type safety.
**Usage:** Use for collections, algorithms, and abstractions that should work with multiple types without losing type information. Distinguish from Any/Object (loses type information) — Generics preserve type safety.
**Related:** Type Parameter (the generic placeholder), Constraint (restricting generic types), Type Erasure (runtime generic handling)
**Tags:** programming, types, generics

### Union Type
**Definition:** A type that can be one of several specified types — string | number in TypeScript, Option Int in Rust.
**Usage:** Use to model values that can legitimately be multiple types. Distinguish from Intersection Type (all of several types) and Enum (named constants, not types).
**Related:** Intersection Type (both A and B), Discriminated Union (tagged union), Optional/Maybe (null-or-value union)
**Tags:** programming, types, union-type

### Intersection Type
**Definition:** A type that combines multiple types into one, requiring the value to satisfy all of them — A & B in TypeScript.
**Usage:** Use for mixins, combining behaviors, or requiring a value to conform to multiple contracts. Distinguish from Union Type (any of several types).
**Related:** Union Type (any of several), Mixin (combining behaviors), Interface Inheritance (alternative)
**Tags:** programming, types, intersection-type

### Type Inference
**Definition:** The ability of a compiler or type checker to deduce the type of an expression without explicit type annotations.
**Usage:** The more powerful the inference, the less boilerplate needed. Strong inference (Haskell, Rust, TypeScript with context) reduces noise while keeping safety. Distinguish from Implicit Typing (dynamic) — Inference is static but automatic.
**Related:** Static Typing (the category), Hindley-Milner (type inference algorithm), Gradual Typing (annotation-based inference)
**Tags:** programming, types, type-inference

## Memory

### Stack
**Definition:** A memory region that stores local variables, function parameters, and return addresses in a LIFO (last-in, first-out) structure, managed automatically.
**Usage:** Fast allocation/deallocation but limited size. Use for small, short-lived data with known size at compile time. Distinguish from Heap (dynamic allocation, slower, managed).
**Related:** Heap (dynamic allocation), Stack Overflow (exhaustion), Frame (per-call stack segment)
**Tags:** programming, memory, stack

### Heap
**Definition:** A memory region for dynamic allocation, where objects are allocated on request and freed by the garbage collector or manually.
**Usage:** Use for data with unknown size at compile time, long-lived objects, or data shared across threads. Slower than stack allocation. Distinguish from Stack (automatic, LIFO).
**Related:** Stack (automatic allocation), Garbage Collection (automatic heap management), Memory Leak (unreleased heap memory)
**Tags:** programming, memory, heap

### Garbage Collection (GC)
**Definition:** Automatic memory management that reclaims memory occupied by objects that are no longer reachable.
**Usage:** Use in GC-managed languages (Java, C#, Go, JavaScript) to avoid manual memory management. Reduces bugs but introduces pauses and unpredictability. Distinguish from Reference Counting (deterministic, cycle-handling needed) and Manual Management (C/C++).
**Related:** Reference Counting (alternative), Tracing GC (mark-sweep, generational), GC Pause (stop-the-world), Memory Leak (unreachable via GC)
**Tags:** programming, memory, garbage-collection

### Memory Leak
**Definition:** A situation where memory that is no longer needed is not released, causing the program's memory usage to grow over time.
**Usage:** Identify by profiling memory usage over time — a consistently growing baseline indicates a leak. In GC languages, leaks occur when references are unintentionally retained. Distinguish from Stack Overflow (immediate, not gradual).
**Related:** Garbage Collection (automatic prevention), Reference (the cause), Retention Path (keeping objects alive), Profiler (detection tool)
**Tags:** programming, memory, memory-leak

## Error Handling

### Exception
**Definition:** An object representing an error condition that disrupts normal program flow, thrown when something unexpected occurs and caught by an exception handler.
**Usage:** Use for exceptional conditions that a caller can't reasonably prevent. Not for expected control flow (validation errors, "not found" are not exceptional). Distinguish from Error (unrecoverable) and Result (expected failure, functional style).
**Related:** Try-Catch (exception handling), Error (unrecoverable), Result (functional alternative), Panic (unrecoverable in Rust/Go)
**Tags:** programming, error-handling, exception

### Result
**Definition:** A type that represents either success (with a value) or failure (with an error), forcing the caller to handle both cases — common in functional languages (Rust's Result, FP's Either).
**Usage:** Prefer over exceptions for expected failure modes where the caller should handle the error. Distinguish from Exception (unexpected, unwinding stack) — Result is a value, not control flow.
**Related:** Option (success-or-nothing), Either (success-or-failure), Exception (the alternative), Railway Oriented Programming (Result chaining)
**Tags:** programming, error-handling, result

### Option
**Definition:** A type that represents either a value (Some) or nothing (None), eliminating null pointer errors by making absence explicit in the type system.
**Usage:** Prefer over null for any value that might be absent. The type system enforces that the caller handles both cases. Common in FP and modern languages (Rust's Option, FP's Maybe).
**Related:** Result (value-or-error), Null (the unsafe alternative), Maybe (synonym for Option)
**Tags:** programming, error-handling, option

### Fail Fast
**Definition:** A principle where a system immediately reports an error at the point of failure, rather than attempting to continue with corrupted state.
**Usage:** Apply to detect problems early, when they're easier to diagnose. A crash with a clear error message is better than silent corruption hours later. Distinguish from Graceful Degradation (continues with reduced functionality).
**Related:** Graceful Degradation (continues), Defensive Programming (checks everywhere), Assertion (fail-fast in development)
**Tags:** programming, error-handling, fail-fast

### Graceful Degradation
**Definition:** A design where a system continues to operate with reduced functionality after a failure, rather than failing completely.
**Usage:** Apply for user-facing systems where availability matters more than full functionality. A page loads without the sidebar rather than showing an error. Distinguish from Fail Fast (stop on error) — degradation continues.
**Related:** Fail Fast (stop immediately), Partial Failure (some components fail), Fallback (alternative behavior)
**Tags:** programming, error-handling, graceful-degradation
