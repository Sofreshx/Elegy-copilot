---
created: 2026-06-03
updated: 2026-06-30
category: lexicon
status: current
doc_kind: node
id: process-glossary
summary: Glossary of software development methodologies, lifecycle models, and process concepts.
tags: [lexicon, process, methodology]
---

# Methodologies & Process

## Development Processes

### SDLC (Software Development Life Cycle)
**Definition:** The structured process of planning, creating, testing, deploying, and maintaining software — from concept to retirement.
**Usage:** Use as the umbrella term for the entire software lifecycle. SDLC models include Waterfall, Agile, Iterative, and Spiral. Distinguish from Agile (an SDLC model) — SDLC is the broader concept of structured software development.
**Related:** Waterfall (linear SDLC), Agile (iterative SDLC), V-Model (verification-focused SDLC), Spiral (risk-driven SDLC)
**Tags:** process, sdlc

### Waterfall
**Definition:** A linear, sequential SDLC model where each phase (requirements → design → implementation → verification → maintenance) completes before the next begins.
**Usage:** Use for projects with stable, well-understood requirements and low likelihood of change. Not suitable for most modern software projects where requirements evolve. Distinguish from Agile (iterative, flexible).
**Related:** Agile (the alternative), V-Model (Waterfall with testing), Requirements Lock (Waterfall assumption), Big Design Up Front (Waterfall philosophy)
**Tags:** process, waterfall

### Agile
**Definition:** An iterative SDLC approach emphasizing flexibility, customer collaboration, and rapid delivery of working software in short iterations.
**Usage:** The dominant modern software development approach. Includes frameworks like Scrum, Kanban, and XP. Distinguish from Waterfall (linear, plan-heavy) — Agile embraces change and iterates.
**Related:** Scrum (Agile framework), Kanban (Agile framework), Sprint (time-boxed iteration), Agile Manifesto (the principles)
**Tags:** process, agile

### Lean
**Definition:** A methodology derived from manufacturing (Toyota Production System) focused on eliminating waste, optimizing flow, and delivering value continuously.
**Usage:** Apply to eliminate non-value-adding activities (excessive documentation, handoffs, waiting, partially done work). Distinguish from Agile (development-focused) — Lean is broader, covering the entire value stream.
**Related:** Muda (waste), Continuous Improvement (Kaizen), Value Stream (the flow of value), Just-in-Time (deliver when needed)
**Tags:** process, lean

## Scrum

### Sprint
**Definition:** A time-boxed iteration (typically 1-4 weeks) during which a development team completes a set of work from the backlog.
**Usage:** Use as the core planning unit in Scrum. Each sprint produces a potentially releasable increment. Distinguish from Iteration (same concept, used in XP) — Sprint is Scrum-specific terminology.
**Related:** Sprint Planning (sprint start), Sprint Review (sprint end), Sprint Retrospective (improvement), Daily Standup (sprint sync)
**Tags:** process, scrum, sprint

### Backlog
**Definition:** An ordered list of work items (features, bugs, tech debt, improvements) maintained for a product, with the most valuable items at the top.
**Usage:** The single source of truth for what to work on next. The Product Owner prioritizes the backlog. Distinguish from Roadmap (strategic, longer-term) — Backlog is tactical and execution-focused.
**Related:** Product Backlog (features), Sprint Backlog (committed), Backlog Refinement (keeping it healthy), Prioritization (ordering)
**Tags:** process, scrum, backlog

### User Story
**Definition:** A concise, informal description of a feature from the end-user perspective, typically following the format: "As a [user], I want [goal] so that [reason]."
**Usage:** Use to capture requirements in user-centric language. Stories are placeholders for conversation, not detailed specifications. Distinguish from Task (developer-centric, technical) — Story captures the user value.
**Related:** Epic (large story), Task (sub-item), Acceptance Criteria (completion conditions), INVEST (good story criteria)
**Tags:** process, scrum, user-story

### Epic
**Definition:** A large user story that is too big to complete in a single sprint and must be decomposed into smaller stories.
**Usage:** Use for high-level features or initiatives that span multiple sprints. Epics are decomposed during refinement. Distinguish from Theme (strategic grouping) and Feature (product capability).
**Related:** User Story (decomposed epic), Theme (strategic grouping), Initiative (enterprise-level), Milestone (time-based grouping)
**Tags:** process, scrum, epic

### Velocity
**Definition:** A metric measuring the amount of work a team completes in a sprint, used for capacity planning and forecasting.
**Usage:** Use to estimate how much work the team can commit to in future sprints. Velocity is team-specific and should stabilize over time. Distinguish from Productivity (individual) — Velocity is team throughput.
**Related:** Story Point (estimation unit), Capacity (available hours), Burndown (tracking), Lead Time (story to completion)
**Tags:** process, scrum, velocity

### Story Point
**Definition:** A relative unit of estimation measuring the effort, complexity, and risk of a user story, not tied to clock time.
**Usage:** Use for estimation in Agile teams. Teams calibrate their own point scale. Story points are relative (a 5 is roughly twice a 2). Distinguish from Ideal Hours (clock time) — Points account for uncertainty and complexity.
**Related:** Velocity (points per sprint), Planning Poker (estimation technique), T-Shirt Size (alternative sizing), Affinity Estimation (grouped sizing)
**Tags:** process, scrum, story-point

## Kanban

### Kanban
**Definition:** An Agile framework focusing on visualizing work, limiting work-in-progress (WIP), and optimizing flow, without fixed iterations.
**Usage:** Use for teams with continuous, unpredictable work (support, operations, maintenance). Work is pulled through a board as capacity allows. Distinguish from Scrum (fixed iterations) — Kanban is flow-based.
**Related:** WIP Limit (work-in-progress cap), Pull System (work is pulled, not pushed), Cycle Time (work item completion time), Cumulative Flow Diagram (visualization)
**Tags:** process, kanban

### WIP Limit (Work-in-Progress Limit)
**Definition:** The maximum number of work items allowed in a given Kanban column or state at any time, preventing overloading the team.
**Usage:** Set per column/state based on team capacity. When the limit is reached, no new work enters that state until existing work moves forward. Distinguish from Capacity (broader team capacity) — WIP is per-column.
**Related:** Kanban (the framework), Bottleneck (WIP reveals bottlenecks), Pull System (limited WIP enables pull), Flow Efficiency (active time / total time)
**Tags:** process, kanban, wip-limit

### Cycle Time
**Definition:** The time from when work starts on an item to when it's completed — a key metric for flow-based processes.
**Usage:** Use to measure process efficiency. Shorter cycle times mean faster delivery. Distinguish from Lead Time (from request to delivery, includes wait time) — Cycle Time starts when work begins.
**Related:** Lead Time (includes waiting), Throughput (items per time), Flow Efficiency (cycle vs lead time), Little's Law (relationship between WIP, cycle time, throughput)
**Tags:** process, kanban, cycle-time

## Estimation

### T-Shirt Sizing
**Definition:** A relative estimation technique using T-shirt sizes (XS, S, M, L, XL, XXL) to roughly categorize work items by size.
**Usage:** Use for initial, quick estimation when precision isn't needed. T-shirt sizes are later converted to story points or hours during refinement. Distinguish from Story Points (more granular) — T-shirt sizing is coarser.
**Related:** Story Point (more granular), Planning Poker (detailed estimation), Affinity Estimation (grouped by size), Order of Magnitude (rough estimate)
**Tags:** process, estimation, t-shirt-sizing

### Planning Poker
**Definition:** A consensus-based estimation technique where team members privately select story point values, reveal simultaneously, and discuss discrepancies.
**Usage:** Use for estimating user stories in Agile teams. Reduces anchoring bias (one person's estimate influencing others). Distinguish from T-Shirt Sizing (coarser, no discussion rounds).
**Related:** Story Point (the unit), Consensus (the goal), Anchoring Bias (what it prevents), Fibonacci Sequence (common point scale)
**Tags:** process, estimation, planning-poker

## Versioning

### SemVer (Semantic Versioning)
**Definition:** A versioning scheme using MAJOR.MINOR.PATCH: MAJOR for breaking changes, MINOR for backward-compatible additions, PATCH for backward-compatible fixes.
**Usage:** The standard versioning scheme for libraries and packages. Communicates change impact to consumers. Before 1.0.0, anything goes. Distinguish from CalVer (date-based) and ZeroVer (pre-1.0).
**Related:** Breaking Change (MAJOR bump), Backward Compatible (MINOR/PATCH), Pre-release (semver suffix), Version Range (dependency specification)
**Tags:** process, versioning, semver

### CalVer (Calendar Versioning)
**Definition:** A versioning scheme based on the calendar date — YYYY.MM (Ubuntu), YYYY.MM.DD (Twisted), or YY.MINOR.MICRO.
**Usage:** Use for projects with regular, time-based releases where SemVer's breaking-change signals are less meaningful (end-user applications, not libraries). Distinguish from SemVer (change-based) — CalVer is time-based.
**Related:** SemVer (change-based), Release Cadence (regular schedule), LTS (Long Term Support, often CalVer)
**Tags:** process, versioning, calver

### Git Flow
**Definition:** A branching model with two main branches (main, develop), supporting branches (feature, release, hotfix), and strict merging rules.
**Usage:** Use for projects with scheduled releases and separate maintenance of production and development lines. More complex than modern alternatives. Distinguish from Trunk-based Development (single branch, frequent merges).
**Related:** Trunk-based (simpler alternative), Main (production-ready), Develop (integration), Hotfix (emergency fix)
**Tags:** process, versioning, git-flow

### Trunk-based Development
**Definition:** A branching model where developers merge small changes frequently (daily or more) into a single shared branch (trunk/main), avoiding long-lived feature branches.
**Usage:** Use for CI/CD, continuous deployment, or teams prioritizing fast feedback. Requires feature flags for incomplete work. Distinguish from Git Flow (multiple long-lived branches) — Trunk-based is simpler and faster.
**Related:** Git Flow (alternative), Feature Flag (hide incomplete work), Short-lived Branch (hours/days, not weeks), Continuous Integration (enabled by trunk-based)
**Tags:** process, versioning, trunk-based

### Monorepo
**Definition:** A version control strategy where multiple projects reside in a single repository, sharing tooling, dependencies, and CI.
**Usage:** Use for tightly coupled projects, shared codebases, or organizations benefiting from atomic cross-project changes. Google, Meta, and Microsoft use monorepos. Distinguish from Polyrepo (separate repos per project).
**Related:** Polyrepo (alternative), Workspace (monorepo management), Shared Dependency (monorepo benefit), Atomic Commit (cross-project change)
**Tags:** process, versioning, monorepo

## Documentation

### ADR (Architecture Decision Record)
**Definition:** A structured document capturing a significant architectural decision, its context, alternatives considered, and the chosen approach with rationale.
**Usage:** Use for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Not for ordinary implementation choices. ADRs are durable and should be reviewed but rarely changed.
**Related:** RFC (proposal, not yet decided), Spec (broader contract), Decision Log (all decisions), Y-Statement (ADR format: "In the context of...")
**Tags:** process, documentation, adr

### RFC (Request for Comments)
**Definition:** A proposal document seeking feedback and consensus on a design or process change before implementation.
**Usage:** Use for significant changes that need team-wide input before committing to a solution. An RFC is a conversation starter, not a final decision. Distinguish from ADR (the decision record) — RFC is before the decision.
**Related:** ADR (the outcome), Design Doc (similar concept), Spec (formal requirements), Proposal (the genre)
**Tags:** process, documentation, rfc
