# Elegy Copilot & Holon

## Agent Taxonomy

### Lane Agent
**Definition:** A primary OpenCode agent (quick, standard, spec, project) that enforces a workflow phase, delegates to subagents, and gates progress.
**Usage:** Use to distinguish the four primary workflow agents from subagents (impl, reviewer, explorer) and built-in agents (Build, Plan, Explore). Lane agents are user-visible in the TUI tab cycle.
**Related:** Subagent (invoked by lane agents), Built-in Agent (OpenCode native), Engine Agent (Copilot agent definition)
**Tags:** elegy, opencode, agent, lane-agent

### Subagent
**Definition:** A hidden agent invoked by a lane primary to perform bounded work — impl (write), reviewer (read-only review), explorer (read-only discovery).
**Usage:** Use to distinguish implementation/review/exploration roles from primary lane agents. Subagents have restricted permissions and are not user-invocable.
**Related:** Lane Agent (the invoker), Impl (write-capable subagent), Reviewer (review gate subagent), Explorer (discovery subagent)
**Tags:** elegy, opencode, agent, subagent

### Built-in Agent
**Definition:** An OpenCode-native agent (Build, Plan, Explore, Scout, General) that ships with OpenCode and does not live in the instruction-engine repo.
**Usage:** Use to distinguish OpenCode's native agents from custom lane/subagents defined in the instruction-engine workspace. Built-in agents are always available.
**Related:** Lane Agent (custom, workflow-enforcing), Engine Agent (Copilot format), Custom Agent (user-defined)
**Tags:** elegy, opencode, agent

### Copilot Agent
**Definition:** An agent defined in Copilot `.agent.md` format, installed as an engine asset under `engine-assets/agents/`.
**Usage:** Use to distinguish agents in Copilot's native format from OpenCode lane agents (`.md` with mode frontmatter) and Codex agents (`.toml` format). Copilot agents use `name`, `tools`, `user-invocable` frontmatter.
**Related:** OpenCode Agent (lane/subagent format), Engine Agent (Copilot ecosystem), Codex Agent (TOML format)
**Tags:** elegy, copilot, agent

### Engine Agent
**Definition:** An agent shipped as part of the instruction-engine control plane — search, execute, impl, code-reviewer, code-explorer, test-runner — in Copilot `.agent.md` format.
**Usage:** Use to refer to the set of agents installed via `engine-assets/agents/` that provide the Copilot runtime capability layer. They underpin the lane agent workflow.
**Related:** Lane Agent (orchestrator), Shared Skill (companion capability), Engine Asset (broader category)
**Tags:** elegy, engine, agent

## Skill System

### Skill
**Definition:** A structured playbook (SKILL.md) with frontmatter metadata (name, description, tags, stacks) that guides AI behavior for a specific domain — stateless, reusable, scoped.
**Usage:** Use to refer to a repeatable, well-scoped guidance document that an agent can load on-demand. Distinguish from Agent (orchestrator, decision-maker) and Prompt (no metadata, no structured frontmatter).
**Related:** Skill Vault (storage location), Agent (the orchestrator), Load Mode (always vs on-demand), Prompt (unstructured alternative)
**Tags:** elegy, skill

### Skill Vault
**Definition:** The on-demand storage location for skills installed with `loadMode: on-demand`, loaded only when resolved by the skill-discovery resolver chain.
**Usage:** Use to distinguish vault skills (loaded on-demand, not in default context) from installed skills (always loaded). Vault-first resolution checks the vault before the installed skills directory.
**Related:** Installed Skill (always in context), Skill Discovery (resolver chain), Load Mode (always vs on-demand)
**Tags:** elegy, skill, vault

### Installed Skill
**Definition:** A skill installed with `loadMode: always`, available in every session without explicit loading.
**Usage:** Use for foundational skills (project-conventions-governance, security, stack-detector) that should always be accessible. Distinguish from Vault skills which require resolution.
**Related:** Skill Vault (on-demand loading), Core Guardrails (always-installed policy), Shared Skill (cross-harness)
**Tags:** elegy, skill, installed

### Skill Discovery
**Definition:** The deterministic resolver chain that routes a user request to the most appropriate skill by: (1) matching explicit name, (2) stack detection, (3) catalog-backed metadata search, (4) semantic fallback.
**Usage:** Use to refer to the resolution mechanism, not to individual skills. The resolver returns the narrowest matching skill and stops at the first confident match.
**Related:** Search Agent (the resolver agent), Stack Detector (tech classification), Metadata Index (search catalog)
**Tags:** elegy, skill, discovery

## Workflows

### Spec-first
**Definition:** A development workflow where the spec is written before any code, serving as the primary contract between intent and implementation.
**Usage:** Use for contract boundaries, API surfaces, or user-facing features where correctness matters before speed. The spec may not be maintained after implementation.
**Related:** Spec-anchored (evolves alongside code), Spec-as-source (spec is the only truth), SDD (spec-driven development)
**Tags:** elegy, workflow, spec

### Spec-anchored
**Definition:** A development workflow where the spec evolves alongside the code, with tests enforcing alignment between them throughout the feature lifecycle.
**Usage:** The recommended sweet spot for most production work. Distinguish from Spec-first (written first, may become stale) and Spec-as-source (fully generated from spec).
**Related:** Spec-first (written first), Spec-as-source (generative), TDD (test-anchored equivalent)
**Tags:** elegy, workflow, spec

### Spec-as-source
**Definition:** A development workflow where the spec is the only artifact humans edit — all code, tests, and documentation are generated from the spec and never manually modified.
**Usage:** Use for high-discipline environments where spec-code divergence is unacceptable. Requires strong generation tooling and validation gates.
**Related:** Spec-first (written first, then manual code), Model-driven Development (similar concept), Generation Pipeline (the tooling)
**Tags:** elegy, workflow, spec

### Search/Execute
**Definition:** A two-phase workflow where phase 1 searches the capability space (documents, skills, agents) and phase 2 executes the found capability — never execute without search.
**Usage:** The default workflow for capability routing. The search agent resolves the best skill/agent/doc, then the execute agent runs it. Distinguish from Direct Routing (known capability, skip search).
**Related:** Search Agent (phase 1), Execute Agent (phase 2), Capability Discovery (the routing goal)
**Tags:** elegy, workflow, search-execute

### Evidence-first
**Definition:** A clarification protocol that requires attempting to discover the answer from repo evidence (code, docs, config) before asking the user a question.
**Usage:** Apply before any clarifying question to the user. Check canonical docs, then repo evidence, then carry an assumption. Only ask when the answer materially changes the outcome.
**Related:** Clarification Ladder (the three-step protocol), Ambiguity Resolution (the goal), Canonical Doc (the first evidence source)
**Tags:** elegy, workflow, clarification

## Planning

### Work Unit
**Definition:** A minimal, bounded unit of work with an ID pattern `WU-\d{3}`, tracked in plan packs with status (not-started, in-progress, done, blocked, skipped).
**Usage:** Use as the atomic unit in plan packs to break down work into testable chunks. Each WU should be independently completable and verifiable.
**Related:** Plan Pack (the grouping), Roadmap Item (higher-level), Todo (non-WU tracking item)
**Tags:** elegy, planning, work-unit

### Plan Pack
**Definition:** A structured document containing goal context, a set of ordered Work Units, their statuses, and validation evidence for a bounded scope of work.
**Usage:** Use for bounded implementation phases within a roadmap. A plan pack is the execution contract between planning and implementation — it defines what will be done and how it will be verified.
**Related:** Work Unit (the atomic item), Roadmap (the parent), Evidence Chain (validation artifacts)
**Tags:** elegy, planning, plan-pack

### Roadmap
**Definition:** A durable, ordered set of goals or milestones representing the long-term direction for a product or workstream.
**Usage:** Use for multi-session, multi-spec planning. A roadmap organizes goals chronologically and defines the relationship between them.
**Related:** Goal (a roadmap entry), Milestone (a checkpoint), Plan Pack (a bounded slice of work)
**Tags:** elegy, planning, roadmap

## Documentation

### Canonical Doc
**Definition:** An authoritative document in `docs/system/` that is the single source of truth for a given concept, policy, or workflow.
**Usage:** Use to refer to docs that agents should treat as authoritative over research notes, planning docs, or conversational artifacts. Canonical docs use the doc-graph spec frontmatter.
**Related:** Research Doc (exploratory, not authoritative), MOC (map of content), Node (canonical content page)
**Tags:** elegy, documentation, canonical

### Doc Graph
**Definition:** The structured document taxonomy using four doc_kind values (index, moc, node, redirect) with required frontmatter for linking, categorization, and lifecycle.
**Usage:** Use to refer to the system of structured docs under `docs/system/` that the agent navigates as a knowledge graph. Every canonical doc must belong to this graph.
**Related:** Canonical Doc (a node in the graph), MOC (map of content), Index (entry point)
**Tags:** elegy, documentation, doc-graph

### ADR (Architecture Decision Record)
**Definition:** A structured document capturing a significant architectural decision, its context, alternatives considered, and the chosen approach.
**Usage:** Use for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Not for ordinary implementation choices. ADRs are durable and should be reviewed but rarely changed.
**Related:** Spec (broader contract), RFC (proposal, not yet decided), Decision Log (all decisions)
**Tags:** elegy, documentation, adr

## Quality

### Lane
**Definition:** A governance or workflow boundary — either a lane agent (quick/standard/spec/project) or a conceptual concern area in governance docs.
**Usage:** Use with context to distinguish: "which lane?" refers to the workflow agent; "lane governance" refers to a concern area. Avoid using "lane" without qualification.
**Related:** Lane Agent (the workflow agent), Gate (quality checkpoint), Review (the gate mechanism)
**Tags:** elegy, quality, lane

### Gate
**Definition:** A quality checkpoint — spec review, plan review, implementation review, evidence review — that must pass before progress continues.
**Usage:** Use for review points that block advancement. Each lane has defined gates. Distinguish from Check (automated validation, no blocking) and Review (the gate activity).
**Related:** Review (the activity), Check (non-blocking validation), Evidence Chain (what gates validate)
**Tags:** elegy, quality, gate

### Evidence Chain
**Definition:** The collected artifacts (test results, type-check passes, lint reports, validation output) demonstrating that a work unit meets its acceptance criteria.
**Usage:** Use to refer to the full set of evidence collected during implementation and validation. A complete evidence chain is required before a work unit can be marked done.
**Related:** Work Unit (what generates evidence), Validation (evidence collection), Drift (evidence that contradicts spec)
**Tags:** elegy, quality, evidence

### Drift
**Definition:** The divergence between spec intent, implementation behavior, and collected evidence — detected by comparing expected outcomes against actual results.
**Usage:** Use to describe the gap between what was specified and what was built. Drift is not necessarily bad (it may reflect better understanding), but it must be documented.
**Related:** Evidence Chain (what detects drift), Validation (measure drift), Spec (the baseline)
**Tags:** elegy, quality, drift

## Holon / SaaSTools

### Workspace
**Definition:** An isolated environment within a multi-tenant system containing its own resources, configurations, and user access boundaries.
**Usage:** Use for tenant-level isolation in SaaSTools. Each workspace has its own data, settings, and member roster. Distinguish from Project (may be within a workspace) and Organization (billing/administrative entity).
**Related:** Tenant (the customer entity), Project (within a workspace), Organization (billing entity)
**Tags:** holon, saastools, workspace

### Tenant
**Definition:** A customer or organizational entity that owns a workspace and has its own billing, user management, and resource isolation.
**Usage:** Use for the top-level customer entity in a multi-tenant system. A tenant may have multiple workspaces. Distinguish from Workspace (a contained environment within a tenant) and User (an individual within a tenant).
**Related:** Workspace (within a tenant), Organization (synonym or admin entity), Multi-tenant (the architecture)
**Tags:** holon, saastools, tenant

### Integration
**Definition:** A connection between SaaSTools and an external service, handling authentication, data sync, and event subscription.
**Usage:** Use for third-party connections (Slack, GitHub, Jira, etc.). An integration includes auth flow, data mapping, and sync schedule. Distinguish from Connector (the technical adapter) and Webhook (the event delivery mechanism).
**Related:** Connector (the adapter), Webhook (event push), API (the interface), Pipeline (data flow)
**Tags:** holon, saastools, integration

### Connector
**Definition:** The technical adapter that implements the protocol-level communication with an external service — handles HTTP, WebSocket, rate limiting, auth refresh.
**Usage:** Use for the lower-level implementation of an Integration. A connector is the code that talks to the API; an integration is the configured connection.
**Related:** Integration (the configured connection), Webhook (event listener), API Client (raw interface)
**Tags:** holon, saastools, connector

### Pipeline
**Definition:** A configured sequence of data processing steps — trigger, transform, route, action — that operates on events or scheduled intervals.
**Usage:** Use for automated workflows that process data between services. Distinguish from Workflow (human-involved multi-step flow) and Automation (generic, may include pipelines).
**Related:** Trigger (pipeline start), Transform (data mutation), Action (pipeline end), Schedule (time-based pipeline)
**Tags:** holon, saastools, pipeline
