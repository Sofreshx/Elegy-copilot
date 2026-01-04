---
name: quality-csharp
description: "C# quality standards enforcement. Checks DI patterns, async usage, nullability, naming conventions. Use this when asked to improve C# code quality, enforce .NET patterns, or fix C#-specific quality issues."
---

# Quality C# Skill

## Inputs
- Task from `tasks.md`.
- `warnings.md`, `contexts/project.patterns.md`, any coding standards doc.

## Steps
1. Review target code and patterns (DI, logging, naming, error handling, async, nullability).
2. Mode selection: auto -> deep if prior failures or architectural smell; shallow for local lint-level fixes.
3. Apply improvements (structure, readability, safety) without altering behavior unless requested.
4. Add/update tests if risk of regression.
5. Log systemic issues to `warnings.md` and add follow-up tasks if needed.

## Output
- Refined code and tests.
- Updated warnings/tasks/raw tasks as needed.

## Guidelines
- **Prefer async/await** for I/O-bound work and long-running operations. Provide asynchronous APIs for I/O-bound components, avoid blocking on async code (no `.Result`/`.Wait()`), and use `ConfigureAwait(false)` in library code where appropriate.
- **Avoid `dynamic` in normal application code.** `dynamic` is acceptable only for narrow scenarios (COM interop, dynamic scripting hosts, or when working with loosely-typed external systems). Any use of `dynamic` must be explicitly documented and justified in code review.
- **Use generics to reduce boilerplate and improve type-safety.** Favor generic interfaces and methods over object-typed APIs; apply constraints (`where T : class`, `struct`, `notnull`, etc.) to express intent and prevent misuse.
- **Be careful with boxing/unboxing.** Avoid passing value types into non-generic APIs or storing them in `object`/non-generic collections; prefer generic collections and `Span<T>`/`Memory<T>` when appropriate to minimize allocations.
- **Use `struct` / `record struct` judiciously.** Prefer small, immutable structs (ideally <= 16 bytes) or `readonly struct` when copy costs are acceptable; use `record struct` when value-based equality and concise syntax are beneficial. Avoid large mutable structs.
- **Favor nullable reference types** and explicit contracts to reduce null-related bugs and improve API clarity.
- **Profile before optimizing.** For performance-sensitive areas prefer low-allocation patterns (pools, `Span<T>`, `Memory<T>`) and validate improvements with benchmarks.

## Steps (updated)
1. Review target code and patterns (DI, logging, naming, error handling, async, nullability).
2. Mode selection: auto -> deep if prior failures or architectural smell; shallow for local lint-level fixes.
3. Apply improvements (structure, readability, safety) without altering behavior unless requested. Verify adherence to **Guidelines**: async usage, disallowed `dynamic`, appropriate use of generics, boxing avoidance, and correct use of `struct`/`record struct`.
4. Add/update tests if risk of regression.
5. Log systemic issues to `warnings.md` and add follow-up tasks if needed.

## Session Summary Format
- **Done**: [what was completed]
- **Changes**: [files/links modified]
- **New tasks.md**: [any new structured tasks]
- **New raw.tasks.md**: [any new unrefined tasks]
- **Warnings**: [any warnings.md updates]
- **Next**: [suggested next actions]


