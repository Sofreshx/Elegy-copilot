import { tool } from "@opencode-ai/plugin/tool";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// --- Binary resolution ---
// Follows the same fallback chain as copilot-ui/lib/elegyPlanningCliResolver.js
// but simplified for plugin context (no source-build support).

function resolvePlanningBinary() {
  const isWin = process.platform === "win32";
  const binaryName = isWin ? "elegy-planning.exe" : "elegy-planning";

  // 1. Explicit env var
  const explicit = process.env.INSTRUCTION_ENGINE_ELEGY_PLANNING_CLI_PATH;
  if (explicit && (existsSync(explicit) || existsSync(explicit + ".exe"))) {
    return explicit;
  }

  // 2. ELEGY_HOME managed CLI
  const elegyHome = process.env.ELEGY_HOME
    || join(process.env.HOME || process.env.USERPROFILE || "~", ".elegy");
  const managedCandidates = [
    join(elegyHome, "managed-cli", "planning", "bin", binaryName),
    join(elegyHome, "managed-cli", "planning", binaryName),
    join(elegyHome, "bin", binaryName),
    join(elegyHome, "elegy-planning", binaryName),
  ];
  for (const candidate of managedCandidates) {
    if (existsSync(candidate)) return candidate;
  }

  // 3. PATH fallback (bare command name)
  return "elegy-planning";
}

const PLANNING_BINARY = resolvePlanningBinary();

// --- CLI execution ---

function runPlanningCommand(subcommand, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const correlationId = randomUUID();
    const fullArgs = [
      "--json",
      "--non-interactive",
      "--correlation-id",
      correlationId,
    ];
    if (opts.scope) {
      fullArgs.push("--scope", opts.scope);
    }
    fullArgs.push(...subcommand.split(" "), ...args);

    execFile(PLANNING_BINARY, fullArgs, { timeout: opts.timeout || 30000 }, (error, stdout, stderr) => {
      if (error) {
        const msg = stderr ? stderr.trim() : error.message;
        resolve({
          output: "elegy-planning error: " + msg,
          metadata: { status: "error", correlationId, subcommand },
        });
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        resolve({
          output: stdout.trim() || "(no output)",
          metadata: { status: "ok", correlationId, subcommand },
        });
        return;
      }

      const status = parsed.status || "ok";
      const data = parsed.data || parsed;
      const output = JSON.stringify(data, null, 2);

      resolve({
        output,
        metadata: { status, correlationId, subcommand },
      });
    });
  });
}

// --- Scope helper ---

function resolveScope(args) {
  if (args.scope) return args.scope;
  return undefined; // Never auto-derive — let the caller handle scope explicitly
}

const scopeArg = () => tool.schema.string().optional().describe("Planning scope key (e.g. 'repo:myproject'). Always pass explicitly.");

// --- Arg builders ---
// Build CLI args from tool args object. Multi-value flags are repeated per value.

function buildGoalCreateArgs(args) {
  const a = ["--id", args.id, "--title", args.title];
  if (args.description) a.push("--description", args.description);
  if (args.status) a.push("--status", args.status);
  if (args.acceptance) { for (const v of args.acceptance) a.push("--acceptance", v); }
  if (args.rejection) { for (const v of args.rejection) a.push("--rejection", v); }
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildRoadmapCreateArgs(args) {
  const a = ["--id", args.id, "--goal-id", args.goalId, "--title", args.title];
  if (args.summary) a.push("--summary", args.summary);
  if (args.status) a.push("--status", args.status);
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildRoadmapAddWorkPointArgs(args) {
  const a = [
    "--roadmap-id", args.roadmapId,
    "--work-point-id", args.id,
    "--title", args.title,
  ];
  if (args.summary) a.push("--summary", args.summary);
  if (args.status) a.push("--status", args.status);
  if (args.ordering) a.push("--ordering", args.ordering);
  if (args.effortTier) a.push("--effort-tier", args.effortTier);
  if (args.sectionId) a.push("--section-id", args.sectionId);
  if (args.dependencyId) { for (const v of args.dependencyId) a.push("--dependency-id", v); }
  if (args.fileScope) { for (const v of args.fileScope) a.push("--file-scope", v); }
  if (args.validation) { for (const v of args.validation) a.push("--validation", v); }
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildPlanCreateArgs(args) {
  const a = ["--id", args.id, "--roadmap-id", args.roadmapId, "--title", args.title];
  if (args.summary) a.push("--summary", args.summary);
  if (args.effortTier) a.push("--effort-tier", args.effortTier);
  if (args.routingHint) a.push("--routing-hint", args.routingHint);
  if (args.fileScope) { for (const v of args.fileScope) a.push("--file-scope", v); }
  return a;
}

function buildIssueRecordArgs(args) {
  const a = ["--entity-type", args.entityType, "--entity-id", args.entityId, "--title", args.title];
  if (args.description) a.push("--description", args.description);
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildReviewPointRecordArgs(args) {
  const a = ["--entity-type", args.entityType, "--entity-id", args.entityId, "--decision", args.decision];
  if (args.rationale) a.push("--rationale", args.rationale);
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

// --- New arg builders (2026 additions) ---

function buildRoadmapAddSectionArgs(args) {
  const a = [
    "--roadmap-id", args.roadmapId,
    "--section-id", args.id,
    "--title", args.title,
  ];
  if (args.summary) a.push("--summary", args.summary);
  if (args.ordering) a.push("--ordering", args.ordering);
  return a;
}

function buildTodoCreateArgs(args) {
  const a = ["--plan-id", args.planId, "--title", args.title];
  if (args.description) a.push("--description", args.description);
  if (args.status) a.push("--status", args.status);
  if (args.effortTier) a.push("--effort-tier", args.effortTier);
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildInsightRecordArgs(args) {
  const a = ["--insight-type", args.insightType];
  if (args.entityType) a.push("--entity-type", args.entityType);
  if (args.entityId) a.push("--entity-id", args.entityId);
  if (args.content) a.push("--content", args.content);
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildProjectRunClaimArgs(args) {
  const a = [
    "--goal-id", args.goalId,
    "--roadmap-id", args.roadmapId,
    "--work-point-id", args.workPointId,
    "--repo", args.repo,
    "--branch", args.branch,
    "--worktree", args.worktree,
    "--session", args.session,
    "--profile", args.profile,
  ];
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildProjectRunActivateArgs(args) {
  const a = ["--run-id", args.runId];
  if (args.worktreePath) a.push("--worktree-path", args.worktreePath);
  return a;
}

function buildProjectRunAddEvidenceArgs(args) {
  const a = ["--run-id", args.runId, "--evidence-type", args.evidenceType];
  if (args.content) a.push("--content", args.content);
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildProjectRunReleaseArgs(args) {
  const a = ["--run-id", args.runId];
  if (args.status) a.push("--status", args.status);
  return a;
}

// --- Plugin definition ---

export const PlanningPlugin = async ({ project, directory }) => {
  const projectPath = (project && project.path) || directory;

  return {
    tool: {
      // ============================================================
      // Read tools (11)
      // ============================================================

      planning_health: tool({
        description: "Check elegy-planning database health, schema version, FTS5 index state, and lease status.",
        args: {
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Checking planning health" });
          return runPlanningCommand("health", [], { scope: resolveScope(args) });
        },
      }),

      planning_goal_list: tool({
        description: "List goals in the active scope. Returns array of goal objects.",
        args: {
          limit: tool.schema.string().optional().describe("Maximum number of goals to return"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing goals" });
          const a = [];
          if (args.limit) a.push("--limit", args.limit);
          return runPlanningCommand("goal", ["list", ...a], { scope: resolveScope(args) });
        },
      }),

      planning_goal_show: tool({
        description: "Show a goal's details including linked roadmaps and validation status.",
        args: {
          goalId: tool.schema.string().describe("Goal ID to inspect"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Reading goal " + args.goalId });
          return runPlanningCommand("goal", ["show", "--goal-id", args.goalId], { scope: resolveScope(args) });
        },
      }),

      planning_roadmap_list: tool({
        description: "List roadmaps in the active scope.",
        args: {
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing roadmaps" });
          return runPlanningCommand("roadmap", ["list"], { scope: resolveScope(args) });
        },
      }),

      planning_roadmap_show: tool({
        description: "Show a roadmap with its sections and work points.",
        args: {
          roadmapId: tool.schema.string().describe("Roadmap ID to inspect"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Reading roadmap " + args.roadmapId });
          return runPlanningCommand("roadmap", ["show", "--roadmap-id", args.roadmapId], { scope: resolveScope(args) });
        },
      }),

      planning_plan_list: tool({
        description: "List plans in the active scope.",
        args: {
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing plans" });
          return runPlanningCommand("plan", ["list"], { scope: resolveScope(args) });
        },
      }),

      planning_plan_show: tool({
        description: "Show a plan's details including todos and evidence.",
        args: {
          planId: tool.schema.string().describe("Plan ID to inspect"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Reading plan " + args.planId });
          return runPlanningCommand("plan", ["show", "--plan-id", args.planId], { scope: resolveScope(args) });
        },
      }),

      planning_work_point_next_runnable: tool({
        description: "List runnable work points ordered by effort and readiness. Use to find the next work point to plan.",
        args: {
          limit: tool.schema.string().optional().describe("Maximum number of work points to return"),
          includeBlocked: tool.schema.boolean().optional().describe("If true, include work points with unvalidated upstream dependencies"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Finding next runnable work points" });
          const a = [];
          if (args.limit) a.push("--limit", args.limit);
          if (args.includeBlocked) a.push("--include-blocked");
          return runPlanningCommand("work-point", ["next-runnable", ...a], { scope: resolveScope(args) });
        },
      }),

      planning_scope_list: tool({
        description: "List scopes in the planning database.",
        args: {
          limit: tool.schema.string().optional().describe("Maximum number of scopes to return"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing scopes" });
          const a = [];
          if (args.limit) a.push("--limit", args.limit);
          return runPlanningCommand("scope", ["list", ...a], { scope: resolveScope(args) });
        },
      }),

      planning_tags_list: tool({
        description: "List all tags in the active scope.",
        args: {
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing tags" });
          return runPlanningCommand("tags", ["list"], { scope: resolveScope(args) });
        },
      }),

      planning_search_extended: tool({
        description: "Extended search across planning entities.",
        args: {
          query: tool.schema.string().describe("Search query"),
          entityType: tool.schema.string().optional().describe("Entity type filter"),
          limit: tool.schema.string().optional().describe("Maximum results to return"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Searching: " + args.query });
          const a = ["--query", args.query];
          if (args.entityType) a.push("--entity-type", args.entityType);
          if (args.limit) a.push("--limit", args.limit);
          return runPlanningCommand("search-extended", a, { scope: resolveScope(args) });
        },
      }),

      // ============================================================
      // Write tools (15)
      // ============================================================

      planning_goal_create: tool({
        description: "Create a durable goal with acceptance and rejection criteria. Requires id and title.",
        args: {
          id: tool.schema.string().describe("Goal slug ID (e.g. 'auth-migration-v1')"),
          title: tool.schema.string().describe("Goal title"),
          description: tool.schema.string().optional().describe("Goal description"),
          status: tool.schema.string().optional().describe("Initial status (default: 'draft')"),
          acceptance: tool.schema.array(tool.schema.string()).optional().describe("Acceptance criteria (one per item, repeated flag)"),
          rejection: tool.schema.array(tool.schema.string()).optional().describe("Rejection criteria (one per item, repeated flag)"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags (one per item, repeated flag)"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Creating goal: " + args.title });
          return runPlanningCommand("goal", ["create", ...buildGoalCreateArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_roadmap_create: tool({
        description: "Create a roadmap under a goal.",
        args: {
          id: tool.schema.string().describe("Roadmap slug ID"),
          goalId: tool.schema.string().describe("Parent goal ID"),
          title: tool.schema.string().describe("Roadmap title"),
          summary: tool.schema.string().optional().describe("Roadmap summary"),
          status: tool.schema.string().optional().describe("Initial status (default: 'draft')"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Creating roadmap: " + args.title });
          return runPlanningCommand("roadmap", ["create", ...buildRoadmapCreateArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_roadmap_add_work_point: tool({
        description: "Attach a work point to a roadmap with file scopes and effort tier.",
        args: {
          roadmapId: tool.schema.string().describe("Parent roadmap ID"),
          id: tool.schema.string().describe("Work point slug ID"),
          title: tool.schema.string().describe("Work point title"),
          summary: tool.schema.string().optional().describe("Work point summary"),
          status: tool.schema.string().optional().describe("Initial status (default: 'draft')"),
          ordering: tool.schema.string().optional().describe("Ordering hint (e.g. '1', '2')"),
          effortTier: tool.schema.string().describe("Effort tier: 'fast', 'balanced', or 'deep' (required by CLI)"),
          sectionId: tool.schema.string().optional().describe("Section ID to place work point under"),
          dependencyId: tool.schema.array(tool.schema.string()).optional().describe("Work point dependency IDs"),
          fileScope: tool.schema.array(tool.schema.string()).optional().describe("File scope selectors (format: <type>:<intent>:<selector>)"),
          validation: tool.schema.array(tool.schema.string()).optional().describe("Validation expectations"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Adding work point: " + args.title });
          return runPlanningCommand("roadmap", ["add-work-point", ...buildRoadmapAddWorkPointArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_plan_create: tool({
        description: "Create a plan under a roadmap for a specific work point.",
        args: {
          id: tool.schema.string().describe("Plan slug ID"),
          roadmapId: tool.schema.string().describe("Parent roadmap ID"),
          title: tool.schema.string().describe("Plan title"),
          summary: tool.schema.string().optional().describe("Plan summary"),
          effortTier: tool.schema.string().optional().describe("Effort tier: 'fast', 'balanced', or 'deep'"),
          routingHint: tool.schema.string().optional().describe("Routing hint for the plan"),
          fileScope: tool.schema.array(tool.schema.string()).optional().describe("File scope selectors (format: <type>:<intent>:<selector>)"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Creating plan: " + args.title });
          return runPlanningCommand("plan", ["create", ...buildPlanCreateArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_plan_update_status: tool({
        description: "Transition a plan to a new lifecycle state (e.g. 'active', 'completed', 'blocked').",
        args: {
          planId: tool.schema.string().describe("Plan ID to update"),
          status: tool.schema.string().describe("New status value"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Updating plan status: " + args.status });
          return runPlanningCommand("plan", ["update-status", "--plan-id", args.planId, "--status", args.status], { scope: resolveScope(args) });
        },
      }),

      planning_roadmap_add_section: tool({
        description: "Add a section to a roadmap.",
        args: {
          roadmapId: tool.schema.string().describe("Parent roadmap ID"),
          id: tool.schema.string().describe("Section slug ID"),
          title: tool.schema.string().describe("Section title"),
          summary: tool.schema.string().optional().describe("Section summary"),
          ordering: tool.schema.string().optional().describe("Ordering hint (e.g. '1', '2')"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Adding section: " + args.title });
          return runPlanningCommand("roadmap", ["add-section", ...buildRoadmapAddSectionArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_todo_create: tool({
        description: "Create a todo under a plan.",
        args: {
          planId: tool.schema.string().describe("Parent plan ID"),
          title: tool.schema.string().describe("Todo title"),
          description: tool.schema.string().optional().describe("Todo description"),
          status: tool.schema.string().optional().describe("Initial status"),
          effortTier: tool.schema.string().optional().describe("Effort tier: 'fast', 'balanced', or 'deep'"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Creating todo: " + args.title });
          return runPlanningCommand("todo", ["create", ...buildTodoCreateArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_todo_list: tool({
        description: "List todos in the active scope, optionally filtered by plan.",
        args: {
          planId: tool.schema.string().optional().describe("Filter by plan ID"),
          limit: tool.schema.string().optional().describe("Maximum results to return"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing todos" });
          const a = [];
          if (args.planId) a.push("--plan-id", args.planId);
          if (args.limit) a.push("--limit", args.limit);
          return runPlanningCommand("todo", ["list", ...a], { scope: resolveScope(args) });
        },
      }),

      planning_insight_record: tool({
        description: "Record an insight linked to a planning entity.",
        args: {
          insightType: tool.schema.string().describe("Type of insight (e.g. 'observation', 'decision', 'risk')"),
          entityType: tool.schema.string().optional().describe("Entity type the insight is about"),
          entityId: tool.schema.string().optional().describe("Entity ID the insight is about"),
          content: tool.schema.string().optional().describe("Insight content"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Recording insight" });
          return runPlanningCommand("insight", ["record", ...buildInsightRecordArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_project_run_claim: tool({
        description: "Claim a project run for execution tracking.",
        args: {
          goalId: tool.schema.string().describe("Goal ID"),
          roadmapId: tool.schema.string().describe("Roadmap ID"),
          workPointId: tool.schema.string().describe("Work point ID"),
          repo: tool.schema.string().describe("Repository URL or path"),
          branch: tool.schema.string().describe("Branch name"),
          worktree: tool.schema.string().describe("Worktree path"),
          session: tool.schema.string().describe("Session identifier"),
          profile: tool.schema.string().describe("Profile name"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Claiming project run" });
          return runPlanningCommand("project-run", ["claim", ...buildProjectRunClaimArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_project_run_activate: tool({
        description: "Activate a claimed project run.",
        args: {
          runId: tool.schema.string().describe("Run ID to activate"),
          worktreePath: tool.schema.string().optional().describe("Worktree path override"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Activating project run" });
          return runPlanningCommand("project-run", ["activate", ...buildProjectRunActivateArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_project_run_add_evidence: tool({
        description: "Add evidence to a project run.",
        args: {
          runId: tool.schema.string().describe("Run ID"),
          evidenceType: tool.schema.string().describe("Evidence type (e.g. 'test-result', 'build-log', 'review-verdict')"),
          content: tool.schema.string().optional().describe("Evidence content (JSON string)"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Adding evidence to run" });
          return runPlanningCommand("project-run", ["add-evidence", ...buildProjectRunAddEvidenceArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_project_run_release: tool({
        description: "Release (complete) a project run.",
        args: {
          runId: tool.schema.string().describe("Run ID to release"),
          status: tool.schema.string().optional().describe("Final status (e.g. 'completed', 'failed')"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Releasing project run" });
          return runPlanningCommand("project-run", ["release", ...buildProjectRunReleaseArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_project_run_list: tool({
        description: "List project runs, optionally filtered by plan.",
        args: {
          planId: tool.schema.string().optional().describe("Filter by plan ID"),
          limit: tool.schema.string().optional().describe("Maximum results to return"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing project runs" });
          const a = [];
          if (args.planId) a.push("--plan-id", args.planId);
          if (args.limit) a.push("--limit", args.limit);
          return runPlanningCommand("project-run", ["list", ...a], { scope: resolveScope(args) });
        },
      }),

      planning_project_run_show: tool({
        description: "Show details of a project run.",
        args: {
          runId: tool.schema.string().describe("Run ID to inspect"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Showing project run" });
          return runPlanningCommand("project-run", ["show", "--run-id", args.runId], { scope: resolveScope(args) });
        },
      }),

      planning_project_run_summary: tool({
        description: "Generate a closure summary for a project run. Aggregates evidence, review points, issues, and validation data from the run.",
        args: {
          runId: tool.schema.string().describe("Run ID to summarize"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Summarizing project run " + args.runId });
          return runPlanningCommand("project-run", ["show", "--run-id", args.runId], { scope: resolveScope(args) }).then((raw) => {
            let parsed;
            try { parsed = JSON.parse(raw.output); } catch { return raw; }
            const data = parsed.data || parsed;
            const evidence = (data.evidence || []).map(e => ({ type: e.evidenceType || e.type || "unknown", content: e.content || e.value || "" }));
            const evidenceByType = {};
            for (const e of evidence) {
              if (!evidenceByType[e.type]) evidenceByType[e.type] = [];
              evidenceByType[e.type].push(e.content);
            }
            const summary = [
              "PLANNING_RUN_SUMMARY",
              "- runId: " + args.runId,
              "- status: " + (data.status || "unknown"),
              "- evidence_by_type:",
              ...Object.entries(evidenceByType).map(([type, items]) => "  - " + type + ": " + items.length + " entries"),
              "- review_points: " + ((data.reviewPoints || data.review_points || []).length),
              "- issues: " + ((data.issues || []).length),
              "- validation_coverage: " + (evidenceByType["validation"] ? evidenceByType["validation"].length + " entries" : "none"),
              "- note: " + ("Summary is derived from project-run show -- evidence types, review points, and issues are grouped at display time."),
            ].join("\n");
            return { output: summary, metadata: { status: "ok", subcommand: "project-run-summary", runId: args.runId } };
          });
        },
      }),

      // ============================================================
      // Utility tools (4)
      // ============================================================

      planning_validate: tool({
        description: "Run a full referential integrity and freshness validation pass. Surfaces orphaned entities, dangling references, and stale records.",
        args: {
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Running full validation" });
          return runPlanningCommand("validate", ["all"], { timeout: 60000, scope: resolveScope(args) });
        },
      }),

      planning_context: tool({
        description: "Get a progressive disclosure context bundle for a planning entity, including linked insights and token estimates.",
        args: {
          entityType: tool.schema.string().describe("Entity type: 'goal', 'roadmap', 'plan', 'work-point', 'todo', 'issue'"),
          entityId: tool.schema.string().describe("Entity ID to inspect"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Loading context for " + args.entityType + " " + args.entityId });
          return runPlanningCommand("context", ["--entity-type", args.entityType, "--entity-id", args.entityId], { scope: resolveScope(args) });
        },
      }),

      planning_issue_record: tool({
        description: "Record an issue tied to a planning entity.",
        args: {
          entityType: tool.schema.string().describe("Entity type the issue is about"),
          entityId: tool.schema.string().describe("Entity ID the issue is about"),
          title: tool.schema.string().describe("Issue title"),
          description: tool.schema.string().optional().describe("Issue description"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Recording issue: " + args.title });
          return runPlanningCommand("issue", ["record", ...buildIssueRecordArgs(args)], { scope: resolveScope(args) });
        },
      }),

      planning_review_point_record: tool({
        description: "Record a review point on a planning entity (e.g. review verdict from a gate).",
        args: {
          entityType: tool.schema.string().describe("Entity type being reviewed"),
          entityId: tool.schema.string().describe("Entity ID being reviewed"),
          decision: tool.schema.string().describe("Review decision (e.g. 'approved', 'blocked', 'needs-changes')"),
          rationale: tool.schema.string().optional().describe("Rationale for the decision"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
          scope: scopeArg(),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Recording review point: " + args.decision });
          return runPlanningCommand("review-point", ["record", ...buildReviewPointRecordArgs(args)], { scope: resolveScope(args) });
        },
      }),
    },

    "shell.env": async function(_input, output) {
      output.env.ELEGY_PLANNING_BINARY = PLANNING_BINARY;
    },
  };
};

export default PlanningPlugin;
