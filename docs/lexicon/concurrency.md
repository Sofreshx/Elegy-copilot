---
created: 2026-06-03
updated: 2026-06-04
category: lexicon
status: current
doc_kind: node
id: concurrency-glossary
summary: Glossary of concurrency models, synchronization primitives, and performance concepts.
tags: [lexicon, concurrency, performance]
---

# Concurrency & Performance

## Concurrency Models

### Thread
**Definition:** The smallest unit of execution within a process, sharing the process's memory space and resources, scheduled by the OS.
**Usage:** Use for parallel CPU-bound work or I/O concurrency in systems languages (C++, Java, C#). Threads are OS-managed and relatively expensive. Distinguish from Process (isolated memory, heavier) and Coroutine (user-space, lighter).
**Related:** Process (isolated thread), Coroutine (lightweight thread), Thread Pool (reuse threads), Race Condition (thread safety issue)
**Tags:** concurrency, threads

### Process
**Definition:** An independent program execution unit with its own memory space, file descriptors, and system resources, isolated from other processes.
**Usage:** Use for strong isolation between components (microservices, separate applications). Processes are safer than threads (no shared memory corruption) but more expensive to create and communicate between.
**Related:** Thread (within process, shared memory), IPC (inter-process communication), Fork (process creation), Container (lightweight process isolation)
**Tags:** concurrency, process

### Coroutine
**Definition:** A lightweight, user-space concurrency unit that can suspend and resume execution cooperatively, without OS thread overhead.
**Usage:** Use for async I/O, cooperative multitasking, or high-concurrency servers. Coroutines are cheaper than threads (thousands of coroutines per thread). Distinguish from Thread (OS-managed, preemptive) — Coroutines yield explicitly.
**Related:** Async/Await (coroutine syntax), Fiber (old term), Goroutine (Go's coroutine), Cooperative vs Preemptive (scheduling)
**Tags:** concurrency, coroutines

### Actor Model
**Definition:** A concurrency model where independent actors communicate through asynchronous messages, each processing messages sequentially, with no shared state.
**Usage:** Use for distributed systems, fault-tolerant systems, or any scenario where shared-state concurrency is too complex. Each actor has private state and a mailbox. Distinguish from CSP (channels for communication) — Actors communicate directly.
**Related:** CSP (channel-based alternative), Mailbox (message queue), Erlang/Elixir (actor-based languages), Akka (actor framework)
**Tags:** concurrency, actor-model

### CSP (Communicating Sequential Processes)
**Definition:** A concurrency model where independent processes communicate through synchronous channels, popularized by Go (goroutines + channels).
**Usage:** Use for pipeline-style concurrency where processes pass data through channels. "Don't communicate by sharing memory; share memory by communicating." Distinguish from Actor Model (direct messaging) — CSP uses channels as intermediaries.
**Related:** Go (CSP language), Channel (communication pipe), Select (channel multiplexing), Goroutine (Go's CSP process)
**Tags:** concurrency, csp

### Event Loop
**Definition:** A programming construct that waits for and dispatches events/messages in a loop, enabling single-threaded concurrency for I/O-bound workloads.
**Usage:** Core of Node.js, JavaScript browsers, and Python asyncio. The event loop handles I/O callbacks, timers, and microtasks on a single thread, avoiding thread-safety issues. Distinguish from Thread Pool (used for CPU work within the same runtime).
**Related:** Callback (event handler), Promise (eventual result), Microtask (high-priority event), Non-blocking I/O (what the event loop enables)
**Tags:** concurrency, event-loop

## Async Patterns

### Async/Await
**Definition:** A syntactic pattern for writing asynchronous code that reads like synchronous code, built on promises/futures with `await` suspending execution.
**Usage:** The standard way to write async code in modern languages (JS, Python, C#, Rust). `await` pauses the current function until the awaited promise resolves, without blocking the thread.
**Related:** Promise (the awaited object), Task (C# async), Future (Rust async), Underlying Coroutine (what await desugars to)
**Tags:** concurrency, async

### Promise
**Definition:** A placeholder for a future value, representing the eventual result of an asynchronous operation, with states: pending, fulfilled, rejected.
**Usage:** Use to chain async operations without nesting callbacks. Promises have `.then()`, `.catch()`, and are the building block for async/await. Distinguish from Callback (passed as argument) — Promises are returned, not passed.
**Related:** Callback (the alternative), Async/Await (promise syntax), Future/Promise (different terminology), .then() (chaining)
**Tags:** concurrency, async, promise

### Callback
**Definition:** A function passed as an argument to another function, to be called when an operation completes — the traditional async pattern.
**Usage:** The foundational async pattern, but leads to "callback hell" with nested callbacks. Prefer Promises or async/await where available. Distinguish from Hook (called at specific lifecycle points) — Callback is for completion.
**Related:** Promise (avoids nesting), Callback Hell (deep nesting), Error-First Callback (Node.js convention), Continuation-Passing Style (theoretical)
**Tags:** concurrency, async, callback

## Synchronization

### Mutex (Mutual Exclusion)
**Definition:** A synchronization primitive that prevents multiple threads from accessing a shared resource simultaneously by locking.
**Usage:** Use to protect shared data from concurrent access. A thread locks the mutex before accessing shared state and unlocks after. Distinguish from Semaphore (allows N concurrent accesses) — Mutex allows one.
**Related:** Lock (same concept), Deadlock (two mutexes blocking each other), Critical Section (protected code), Lock Contention (performance impact)
**Tags:** concurrency, synchronization, mutex

### Semaphore
**Definition:** A synchronization primitive that controls access by multiple threads to a resource pool, maintaining a count of available permits.
**Usage:** Use to limit concurrent access to a resource pool (database connections, API rates). Distinguish from Mutex (binary, one owner) — Semaphore allows N concurrent accesses.
**Related:** Mutex (binary semaphore), Counting Semaphore (N permits), Binary Semaphore (mutex-like), Producer-Consumer (semaphore use case)
**Tags:** concurrency, synchronization, semaphore

### Deadlock
**Definition:** A situation where two or more threads are each waiting for the other to release a resource, causing all to be stuck forever.
**Usage:** Prevent by: consistent lock ordering, lock timeout, deadlock detection, or using lock-free data structures. Distinguish from Livelock (threads are active but making no progress) and Starvation (one thread never gets resources).
**Related:** Livelock (active but stuck), Starvation (never scheduled), Lock Ordering (prevention), Coffman Conditions (deadlock requirements)
**Tags:** concurrency, synchronization, deadlock

### Race Condition
**Definition:** A situation where the outcome depends on the timing or interleaving of threads, leading to unpredictable behavior when shared data is accessed without synchronization.
**Usage:** Prevent by using proper synchronization (mutex, atomics) or avoiding shared state entirely. Race conditions are notoriously hard to reproduce and debug. Distinguish from Data Race (specifically unsynchronized memory access) — Race Condition is broader (includes logical races).
**Related:** Data Race (memory-level race), Atomic Operation (race-free read-modify-write), Happens-Before (ordering guarantee), TSAN (ThreadSanitizer, detection tool)
**Tags:** concurrency, synchronization, race-condition

## Performance

### Latency
**Definition:** The time between initiating an operation and receiving the first result — how fast a single request is processed.
**Usage:** Use to measure responsiveness. Lower latency is better. Typically measured in milliseconds for interactive systems. Distinguish from Throughput (operations per second) — Latency is per-request speed; Throughput is system capacity.
**Related:** Throughput (capacity), P99 (tail latency), Response Time (latency synonym), Network Latency (transmission delay)
**Tags:** performance, latency

### Throughput
**Definition:** The number of operations a system can process per unit of time — requests per second, transactions per minute.
**Usage:** Use to measure system capacity. Higher throughput is better. Distinguish from Latency (per-operation speed) — Throughput is about volume.
**Related:** Latency (per-op speed), Bandwidth (data throughput), Saturation (max throughput), Scaling (increasing throughput)
**Tags:** performance, throughput

### Bottleneck
**Definition:** The component in a system that limits overall performance, identified as the point where work accumulates and waits.
**Usage:** Identify by profiling and tracing — the slowest component in the critical path. Eliminating a bottleneck moves the constraint to the next-slowest component. Distinguish from Hotspot (CPU-intensive code, not necessarily a bottleneck).
**Related:** Profiling (bottleneck identification), Critical Path (the bottleneck chain), Amdahl's Law (theoretical speedup limit), Optimization (bottleneck removal)
**Tags:** performance, bottleneck

### Profiling
**Definition:** The process of measuring a program's resource usage (CPU time, memory allocation, I/O operations) to identify performance bottlenecks.
**Usage:** Use to guide optimization decisions — don't guess, profile. Profiling reveals which functions consume the most time/memory. Distinguish from Tracing (event sequence, not resource usage) — Profiling measures resource consumption.
**Related:** Tracing (event flow), Sampling Profiler (statistical), Instrumenting Profiler (exact measurements), Flame Graph (visualization)
**Tags:** performance, profiling

### Amdahl's Law
**Definition:** A formula predicting the theoretical speedup of a system when improving one part: Speedup = 1 / ((1 - P) + P/S), where P is the parallel portion and S is the speedup of that portion.
**Usage:** Use to set realistic expectations for parallelization. If 10% of a task is sequential, the maximum speedup is 10x regardless of how many processors you add. Distinguish from Gustafson's Law (workload scales with processors).
**Related:** Gustafson's Law (scaled workload), Parallel Efficiency (actual vs theoretical), Strong Scaling (fixed problem size), Weak Scaling (problem grows with processors)
**Tags:** performance, amdahls-law

## Patterns

### Producer-Consumer
**Definition:** A concurrency pattern where one or more producers generate data and place it in a buffer, while consumers take and process it, decoupling production from consumption.
**Usage:** Use for pipeline processing, task queues, or any scenario where producers and consumers operate at different speeds. The buffer (queue) handles rate mismatches. Distinguish from Pub/Sub (multiple subscribers, message routing).
**Related:** Bounded Buffer (fixed-size queue), Pipeline (multi-stage producer-consumer), Backpressure (rate control), Message Queue (distributed variant)
**Tags:** concurrency, patterns, producer-consumer

### Thread Pool
**Definition:** A collection of pre-created threads that are reused to execute tasks, avoiding the overhead of creating/destroying threads per task.
**Usage:** Use for executing many short-lived tasks without thread creation overhead. The pool manages thread lifecycle and task queue. Distinguish from Fork-Join (divides and conquers, not task-based).
**Related:** Executor (Java thread pool), Task Queue (waiting work), Work Stealing (idle threads steal from busy queues), Fiber (lightweight alternative)
**Tags:** concurrency, patterns, thread-pool

### Backpressure
**Definition:** A flow control mechanism where a slow consumer signals the producer to slow down, preventing buffer overflow or system overload.
**Usage:** Use in streaming systems, message queues, and reactive pipelines where producers can outpace consumers. The system applies pressure backward through the chain. Distinguish from Throttling (intentional rate limiting) — Backpressure is reactive.
**Related:** Reactive Streams (backpressure standard), Bounded Buffer (the limit), Dropping (alternative: throw away excess), Load Shedding (alternative: reject new work)
**Tags:** concurrency, patterns, backpressure
