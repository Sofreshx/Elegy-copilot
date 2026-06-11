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
      ...subcommand.split(" "),
      ...args,
    ];

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
    "--id", args.id,
    "--title", args.title,
  ];
  if (args.summary) a.push("--summary", args.summary);
  if (args.status) a.push("--status", args.status);
  if (args.ordering) a.push("--ordering", args.ordering);
  if (args.effortTier) a.push("--effort-tier", args.effortTier);
  if (args.validation) { for (const v of args.validation) a.push("--validation", v); }
  if (args.tag) { for (const v of args.tag) a.push("--tag", v); }
  return a;
}

function buildPlanCreateArgs(args) {
  const a = ["--id", args.id, "--roadmap-id", args.roadmapId, "--title", args.title];
  if (args.effortTier) a.push("--effort-tier", args.effortTier);
  if (args.routingHint) a.push("--routing-hint", args.routingHint);
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

// --- Plugin definition ---

export const PlanningPlugin = async ({ project, directory }) => {
  const projectPath = (project && project.path) || directory;

  return {
    tool: {
      // ============================================================
      // Read tools (8)
      // ============================================================

      planning_health: tool({
        description: "Check elegy-planning database health, schema version, FTS5 index state, and lease status.",
        args: {},
        async execute(_args, ctx) {
          ctx.metadata({ title: "Checking planning health" });
          return runPlanningCommand("health", []);
        },
      }),

      planning_goal_list: tool({
        description: "List goals in the active scope. Returns array of goal objects.",
        args: {
          limit: tool.schema.string().optional().describe("Maximum number of goals to return"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Listing goals" });
          const a = [];
          if (args.limit) a.push("--limit", args.limit);
          return runPlanningCommand("goal", ["list", ...a]);
        },
      }),

      planning_goal_show: tool({
        description: "Show a goal's details including linked roadmaps and validation status.",
        args: {
          goalId: tool.schema.string().describe("Goal ID to inspect"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Reading goal " + args.goalId });
          return runPlanningCommand("goal", ["show", "--goal-id", args.goalId]);
        },
      }),

      planning_roadmap_list: tool({
        description: "List roadmaps in the active scope.",
        args: {},
        async execute(_args, ctx) {
          ctx.metadata({ title: "Listing roadmaps" });
          return runPlanningCommand("roadmap", ["list"]);
        },
      }),

      planning_roadmap_show: tool({
        description: "Show a roadmap with its sections and work points.",
        args: {
          roadmapId: tool.schema.string().describe("Roadmap ID to inspect"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Reading roadmap " + args.roadmapId });
          return runPlanningCommand("roadmap", ["show", "--roadmap-id", args.roadmapId]);
        },
      }),

      planning_plan_list: tool({
        description: "List plans in the active scope.",
        args: {},
        async execute(_args, ctx) {
          ctx.metadata({ title: "Listing plans" });
          return runPlanningCommand("plan", ["list"]);
        },
      }),

      planning_plan_show: tool({
        description: "Show a plan's details including todos and evidence.",
        args: {
          planId: tool.schema.string().describe("Plan ID to inspect"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Reading plan " + args.planId });
          return runPlanningCommand("plan", ["show", "--plan-id", args.planId]);
        },
      }),

      planning_work_point_next_runnable: tool({
        description: "List runnable work points ordered by effort and readiness. Use to find the next work point to plan.",
        args: {
          limit: tool.schema.string().optional().describe("Maximum number of work points to return"),
          includeBlocked: tool.schema.boolean().optional().describe("If true, include work points with unvalidated upstream dependencies"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Finding next runnable work points" });
          const a = [];
          if (args.limit) a.push("--limit", args.limit);
          if (args.includeBlocked) a.push("--include-blocked");
          return runPlanningCommand("work-point", ["next-runnable", ...a]);
        },
      }),

      // ============================================================
      // Write tools (5)
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
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Creating goal: " + args.title });
          return runPlanningCommand("goal", ["create", ...buildGoalCreateArgs(args)]);
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
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Creating roadmap: " + args.title });
          return runPlanningCommand("roadmap", ["create", ...buildRoadmapCreateArgs(args)]);
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
          effortTier: tool.schema.string().optional().describe("Effort tier: 'fast', 'balanced', or 'deep'"),
          validation: tool.schema.array(tool.schema.string()).optional().describe("Validation expectations"),
          tag: tool.schema.array(tool.schema.string()).optional().describe("Tags"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Adding work point: " + args.title });
          return runPlanningCommand("roadmap", ["add-work-point", ...buildRoadmapAddWorkPointArgs(args)]);
        },
      }),

      planning_plan_create: tool({
        description: "Create a plan under a roadmap for a specific work point.",
        args: {
          id: tool.schema.string().describe("Plan slug ID"),
          roadmapId: tool.schema.string().describe("Parent roadmap ID"),
          title: tool.schema.string().describe("Plan title"),
          effortTier: tool.schema.string().optional().describe("Effort tier: 'fast', 'balanced', or 'deep'"),
          routingHint: tool.schema.string().optional().describe("Routing hint for the plan"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Creating plan: " + args.title });
          return runPlanningCommand("plan", ["create", ...buildPlanCreateArgs(args)]);
        },
      }),

      planning_plan_update_status: tool({
        description: "Transition a plan to a new lifecycle state (e.g. 'active', 'completed', 'blocked').",
        args: {
          planId: tool.schema.string().describe("Plan ID to update"),
          status: tool.schema.string().describe("New status value"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Updating plan status: " + args.status });
          return runPlanningCommand("plan", ["update-status", "--plan-id", args.planId, "--status", args.status]);
        },
      }),

      // ============================================================
      // Utility tools (4)
      // ============================================================

      planning_validate: tool({
        description: "Run a full referential integrity and freshness validation pass. Surfaces orphaned entities, dangling references, and stale records.",
        args: {},
        async execute(_args, ctx) {
          ctx.metadata({ title: "Running full validation" });
          return runPlanningCommand("validate", ["all"], { timeout: 60000 });
        },
      }),

      planning_context: tool({
        description: "Get a progressive disclosure context bundle for a planning entity, including linked insights and token estimates.",
        args: {
          entityType: tool.schema.string().describe("Entity type: 'goal', 'roadmap', 'plan', 'work-point', 'todo', 'issue'"),
          entityId: tool.schema.string().describe("Entity ID to inspect"),
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Loading context for " + args.entityType + " " + args.entityId });
          return runPlanningCommand("context", ["--entity-type", args.entityType, "--entity-id", args.entityId]);
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
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Recording issue: " + args.title });
          return runPlanningCommand("issue", ["record", ...buildIssueRecordArgs(args)]);
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
        },
        async execute(args, ctx) {
          ctx.metadata({ title: "Recording review point: " + args.decision });
          return runPlanningCommand("review-point", ["record", ...buildReviewPointRecordArgs(args)]);
        },
      }),
    },

    "shell.env": async function(_input, output) {
      output.env.ELEGY_PLANNING_BINARY = PLANNING_BINARY;
    },
  };
};

export default PlanningPlugin;
