---
name: performance
description: "Performance optimization and bottleneck analysis. Identifies slow code, optimizes queries, reduces memory usage. Use this when asked to optimize code, investigate slowness, improve performance, or analyze bottlenecks."
---

# Performance Skill

## When to Use (LLM Routing Guide)
- User says "optimize this", "why is it slow?", "improve performance"
- Response time issues
- Memory usage concerns
- Database query optimization
- Bundle size / load time issues (frontend)
- Scaling concerns

## When NOT to Use
- General code quality → `code-review.agent.md`
- Debugging errors (not slowness) → `debug.agent.md`
- Architecture decisions → `design.agent.md`

## Inputs
- Code or area to optimize.
- Performance metrics if available (timings, profiles, benchmarks).
- `contexts/project.patterns.md`.
- `warnings.md` (known performance issues).

## Steps
1. Read existing performance context and warnings.
2. Identify performance concern type:
   - **Latency**: Response time too slow
   - **Throughput**: Can't handle load
   - **Memory**: High memory usage or leaks
   - **CPU**: High CPU usage
   - **I/O**: Database, network, file bottlenecks
   - **Bundle**: Frontend load time
3. Analyze code for common issues:
   - N+1 queries
   - Missing indexes
   - Unnecessary allocations
   - Synchronous where async possible
   - Missing caching
   - Inefficient algorithms
   - Overfetching data
4. Suggest diagnostic steps if metrics unavailable:
   - Profiling approach
   - Key metrics to capture
   - Benchmarking strategy
5. Propose optimizations with expected impact.
6. Consider trade-offs (complexity vs. performance gain).

## Performance Analysis Format
```markdown
## Performance Analysis: [area]

### Current State
- Observed behavior: [description]
- Metrics (if available): [numbers]

### Bottlenecks Identified
1. [issue]: [location] - [impact estimate]
2. [issue]: [location] - [impact estimate]

### Recommended Optimizations
| Priority | Change | Expected Impact | Complexity |
|----------|--------|-----------------|------------|
| 1 | [change] | [impact] | Low/Med/High |
| 2 | [change] | [impact] | Low/Med/High |

### Trade-offs
- [optimization]: [trade-off to consider]

### Diagnostic Steps (if metrics needed)
1. [what to measure]
2. [tool/approach]
```

## Output
- Performance analysis with recommendations.
- `raw.tasks.md` entries for optimization work.
- `warnings.md` entry if systemic performance issue.

## Session Summary Format
- **Done**: [analysis completed]
- **Changes**: [quick wins applied if any]
- **New tasks.md**: [none]
- **New raw.tasks.md**: [optimization tasks]
- **Warnings**: [systemic performance issues]
- **Next**: [implement top-priority optimization]


