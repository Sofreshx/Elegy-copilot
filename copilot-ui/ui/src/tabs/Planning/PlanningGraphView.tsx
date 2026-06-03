import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Button } from '../../components';
import {
  getPlanningLiveRoadmap,
  getPlanningLiveGoal,
  listPlanningLivePlans,
  listPlanningLiveTodos,
} from '../../lib/api';
import type {
  PlanningLiveGoal,
  PlanningLiveRoadmapSummary,
  PlanningLiveWorkPoint,
  PlanningLivePlanSummary,
  PlanningLiveTodo,
} from '../../lib/types';
import { humanizeToken } from '../../lib/stateDiagnostics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

function getStatusColor(status: string | null): string {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'proposed' || s === 'in-progress') return 'var(--color-accent-500)';
  if (s === 'completed' || s === 'finished') return 'var(--color-success-500)';
  if (s === 'blocked') return 'var(--color-warning-500)';
  if (s === 'draft') return 'var(--color-ink-400)';
  if (s === 'cancelled' || s === 'invalidated') return 'var(--color-danger-500)';
  return 'var(--color-ink-300)';
}

// ---------------------------------------------------------------------------
// Graph types
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  type: 'goal' | 'roadmap' | 'workpoint' | 'plan' | 'todo';
  parentId: string | null;
  title: string;
  status: string | null;
  summary: string | null;
  originalData: unknown;
  children: GraphNode[];
}

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// buildGraphData — flatten API responses into a tree of GraphNode
// ---------------------------------------------------------------------------

function buildGraphData(
  goal: PlanningLiveGoal | null,
  roadmap: PlanningLiveRoadmapSummary | null,
  workPoints: PlanningLiveWorkPoint[],
  plans: PlanningLivePlanSummary[],
  todos: PlanningLiveTodo[],
): GraphNode | null {
  if (!roadmap) return null;

  const goalId = goal ? `goal-${goal.id}` : 'goal-missing';
  const roadmapId = `roadmap-${roadmap.id}`;

  const goalNode: GraphNode = {
    id: goalId,
    type: 'goal',
    parentId: null,
    title: goal?.title || 'Goal',
    status: goal?.status || null,
    summary: goal?.description || null,
    originalData: goal,
    children: [],
  };

  const roadmapNode: GraphNode = {
    id: roadmapId,
    type: 'roadmap',
    parentId: goalId,
    title: roadmap.title || roadmap.id,
    status: roadmap.status || null,
    summary: roadmap.summary || null,
    originalData: roadmap,
    children: [],
  };

  goalNode.children.push(roadmapNode);

  // Sort work points by their ordering field
  const sortedWorkPoints = [...workPoints].sort((a, b) => {
    const oa = a.ordering ?? Number.MAX_SAFE_INTEGER;
    const ob = b.ordering ?? Number.MAX_SAFE_INTEGER;
    return oa - ob;
  });

  // Map plan targetedWorkPointIds for efficient lookup
  const plansByWorkPointId = new Map<string, PlanningLivePlanSummary[]>();
  for (const plan of plans) {
    for (const wpId of plan.targetedWorkPointIds) {
      if (!plansByWorkPointId.has(wpId)) {
        plansByWorkPointId.set(wpId, []);
      }
      plansByWorkPointId.get(wpId)!.push(plan);
    }
  }

  // Group todos by planId
  const todosByPlanId = new Map<string, PlanningLiveTodo[]>();
  for (const todo of todos) {
    const pid = todo.planId;
    if (!pid) continue;
    if (!todosByPlanId.has(pid)) {
      todosByPlanId.set(pid, []);
    }
    todosByPlanId.get(pid)!.push(todo);
  }

  for (const wp of sortedWorkPoints) {
    const wpNode: GraphNode = {
      id: `workpoint-${wp.id}`,
      type: 'workpoint',
      parentId: roadmapId,
      title: wp.title || wp.id,
      status: wp.status || null,
      summary: wp.summary || null,
      originalData: wp,
      children: [],
    };

    const targetingPlans = plansByWorkPointId.get(wp.id) || [];

    for (const plan of targetingPlans) {
      const planNode: GraphNode = {
        id: `plan-${plan.id}`,
        type: 'plan',
        parentId: wpNode.id,
        title: plan.title || plan.id,
        status: plan.status || null,
        summary: plan.summary || null,
        originalData: plan,
        children: [],
      };

      const planTodos = todosByPlanId.get(plan.id) || [];
      // Sort todos by ordering
      const sortedTodos = [...planTodos].sort((a, b) => {
        const oa = a.ordering ?? Number.MAX_SAFE_INTEGER;
        const ob = b.ordering ?? Number.MAX_SAFE_INTEGER;
        return oa - ob;
      });

      for (const todo of sortedTodos) {
        const todoNode: GraphNode = {
          id: `todo-${todo.id}`,
          type: 'todo',
          parentId: planNode.id,
          title: todo.title || todo.id,
          status: todo.status || null,
          summary: todo.summary || null,
          originalData: todo,
          children: [],
        };
        planNode.children.push(todoNode);
      }

      wpNode.children.push(planNode);
    }

    roadmapNode.children.push(wpNode);
  }

  return goalNode;
}

// ---------------------------------------------------------------------------
// layoutTree — compute x/y positions for each node
// ---------------------------------------------------------------------------

const NODE_WIDTH = 180;
const NODE_HEIGHT = 60;
const VERTICAL_SPACING = 120;
const HORIZONTAL_SPACING = 200;
const ROOT_Y = 80;

function layoutTree(root: GraphNode, containerWidth: number): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (!root) return positions;

  // Count total leaf-width for a subtree to estimate horizontal span
  function subtreeLeafCount(node: GraphNode): number {
    if (node.children.length === 0) return 1;
    return node.children.reduce((sum, c) => sum + subtreeLeafCount(c), 0);
  }

  function layoutNode(node: GraphNode, x: number, y: number) {
    positions.set(node.id, {
      x: x - NODE_WIDTH / 2,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });

    if (node.children.length === 0) return;

    // Compute total width needed for children based on their own subtree sizes
    const childLeafCounts = node.children.map((c) => subtreeLeafCount(c));
    const totalLeafs = childLeafCounts.reduce((s, v) => s + v, 0);
    const totalWidth = totalLeafs * HORIZONTAL_SPACING;

    // Position each child proportionally to its subtree leaf count, centered under parent
    let cursorX = x - totalWidth / 2 + (childLeafCounts[0] * HORIZONTAL_SPACING) / 2;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childY = y + VERTICAL_SPACING;
      layoutNode(child, cursorX, childY);

      // Advance cursor by the span of this child's subtree
      cursorX += childLeafCounts[i] * HORIZONTAL_SPACING;
    }
  }

  // Compute ideal root X so the tree is centered in the container, but don't
  // let it collapse to the left for small trees
  const treeTotalLeafs = subtreeLeafCount(root);
  const treeWidth = treeTotalLeafs * HORIZONTAL_SPACING;
  const rootX = Math.max(containerWidth / 2, treeWidth / 2);

  layoutNode(root, rootX, ROOT_Y);

  return positions;
}

// ---------------------------------------------------------------------------
// computeViewBox — bounding box from all node positions
// ---------------------------------------------------------------------------

function computeViewBox(positions: Map<string, NodePosition>): string {
  if (positions.size === 0) return '0 0 800 600';

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + pos.width);
    maxY = Math.max(maxY, pos.y + pos.height);
  }

  const pad = 100;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  return `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;
}

// ---------------------------------------------------------------------------
// Edge path helper
// ---------------------------------------------------------------------------

function getEdgePath(parent: NodePosition, child: NodePosition, curved = true): string {
  const x1 = parent.x + parent.width / 2;
  const y1 = parent.y + parent.height;
  const x2 = child.x + child.width / 2;
  const y2 = child.y;

  if (!curved) {
    return `M${x1},${y1} L${x2},${y2}`;
  }

  const cy = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
}

// ---------------------------------------------------------------------------
// Detail panel content components
// ---------------------------------------------------------------------------

function GoalDetailContent({ goal }: { goal: PlanningLiveGoal | null }) {
  if (!goal) return <p className="state-message">No goal data available.</p>;

  return (
    <div className="planning-section-stack">
      <p className="planning-item-title">{goal.title || goal.id}</p>
      {goal.description && <p className="planning-item-copy">{goal.description}</p>}
      <dl className="planning-definition-grid">
        <div>
          <dt>Status</dt>
          <dd>{humanizeToken(goal.status)}</dd>
        </div>
      </dl>
      {goal.acceptanceCriteria.length > 0 && (
        <div>
          <p className="planning-metric-label">Acceptance Criteria</p>
          <ul className="planning-guidance-list">
            {goal.acceptanceCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {goal.rejectionCriteria.length > 0 && (
        <div>
          <p className="planning-metric-label">Rejection Criteria</p>
          <ul className="planning-guidance-list">
            {goal.rejectionCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RoadmapDetailContent({ roadmap }: { roadmap: PlanningLiveRoadmapSummary | null }) {
  if (!roadmap) return <p className="state-message">No roadmap data available.</p>;

  return (
    <div className="planning-section-stack">
      <p className="planning-item-title">{roadmap.title || roadmap.id}</p>
      {roadmap.summary && <p className="planning-item-copy">{roadmap.summary}</p>}
      <dl className="planning-definition-grid">
        <div>
          <dt>Status</dt>
          <dd>{humanizeToken(roadmap.status)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatTimestamp(roadmap.updatedAt)}</dd>
        </div>
      </dl>
      {roadmap.tags.length > 0 && (
        <div className="planning-chip-row">
          {roadmap.tags.map((tag) => (
            <span key={tag} className="planning-chip">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkPointDetailContent({ workPoint }: { workPoint: PlanningLiveWorkPoint | null }) {
  if (!workPoint) return <p className="state-message">No work point data available.</p>;

  return (
    <div className="planning-section-stack">
      <p className="planning-item-title">{workPoint.title || workPoint.id}</p>
      {workPoint.summary && <p className="planning-item-copy">{workPoint.summary}</p>}
      <dl className="planning-definition-grid">
        <div>
          <dt>Status</dt>
          <dd>{humanizeToken(workPoint.status)}</dd>
        </div>
        <div>
          <dt>Ordering</dt>
          <dd>{workPoint.ordering != null ? workPoint.ordering : 'Unordered'}</dd>
        </div>
      </dl>
      {workPoint.dependencyIds.length > 0 && (
        <div>
          <p className="planning-metric-label">Dependencies</p>
          <div className="planning-chip-row">
            {workPoint.dependencyIds.map((d) => (
              <span key={d} className="planning-chip">
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
      {workPoint.validationExpectations.length > 0 && (
        <div>
          <p className="planning-metric-label">Validation Expectations</p>
          <ul className="planning-guidance-list">
            {workPoint.validationExpectations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PlanDetailContent({ plan }: { plan: PlanningLivePlanSummary | null }) {
  if (!plan) return <p className="state-message">No plan data available.</p>;

  return (
    <div className="planning-section-stack">
      <p className="planning-item-title">{plan.title || plan.id}</p>
      {plan.summary && <p className="planning-item-copy">{plan.summary}</p>}
      <dl className="planning-definition-grid">
        <div>
          <dt>Status</dt>
          <dd>{humanizeToken(plan.status)}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{plan.scope ? humanizeToken(plan.scope) : 'Unscoped'}</dd>
        </div>
      </dl>
      {plan.assumptions.length > 0 && (
        <div>
          <p className="planning-metric-label">Assumptions</p>
          <ul className="planning-guidance-list">
            {plan.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.stopConditions.length > 0 && (
        <div>
          <p className="planning-metric-label">Stop Conditions</p>
          <ul className="planning-guidance-list">
            {plan.stopConditions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.validationSteps.length > 0 && (
        <div>
          <p className="planning-metric-label">Validation Steps</p>
          <ul className="planning-guidance-list">
            {plan.validationSteps.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.targetedWorkPointIds.length > 0 && (
        <div>
          <p className="planning-metric-label">Targeted Work Points</p>
          <div className="planning-chip-row">
            {plan.targetedWorkPointIds.map((wpId) => (
              <span key={wpId} className="planning-chip">
                {wpId}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TodoDetailContent({ todo }: { todo: PlanningLiveTodo | null }) {
  if (!todo) return <p className="state-message">No todo data available.</p>;

  return (
    <div className="planning-section-stack">
      <p className="planning-item-title">{todo.title || todo.id}</p>
      {todo.summary && <p className="planning-item-copy">{todo.summary}</p>}
      <dl className="planning-definition-grid">
        <div>
          <dt>Status</dt>
          <dd>{humanizeToken(todo.status)}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{todo.priority ? humanizeToken(todo.priority) : 'None'}</dd>
        </div>
      </dl>
      {todo.evidenceRefs.length > 0 && (
        <div>
          <p className="planning-metric-label">Evidence Refs</p>
          <ul className="planning-guidance-list">
            {todo.evidenceRefs.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node label helper
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<GraphNode['type'], string> = {
  goal: 'Goal',
  roadmap: 'Roadmap',
  workpoint: 'Work Point',
  plan: 'Plan',
  todo: 'Todo',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PlanningGraphViewProps {
  roadmapId: string | null;
  repoQuery: { repoId?: string; repoPath?: string; repoLabel?: string };
  onBack: () => void;
  onRefreshNeeded: () => void;
}

export default function PlanningGraphView(props: PlanningGraphViewProps) {
  const { roadmapId, repoQuery, onBack, onRefreshNeeded } = props;

  // ---- Data state ----
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [goal, setGoal] = useState<PlanningLiveGoal | null>(null);
  const [roadmap, setRoadmap] = useState<PlanningLiveRoadmapSummary | null>(null);
  const [workPoints, setWorkPoints] = useState<PlanningLiveWorkPoint[]>([]);
  const [plans, setPlans] = useState<PlanningLivePlanSummary[]>([]);
  const [todos, setTodos] = useState<PlanningLiveTodo[]>([]);

  // ---- Interaction state ----
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [zoomNodeId, setZoomNodeId] = useState<string | null>(null);

  // Refs for pan gesture
  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Data fetching ----

  const fetchData = useCallback(async () => {
    if (!roadmapId) {
      setLoading(false);
      setFetchError(null);
      setGoal(null);
      setRoadmap(null);
      setWorkPoints([]);
      setPlans([]);
      setTodos([]);
      return;
    }

    try {
      setLoading(true);
      setFetchError(null);

      const roadmapResponse = await getPlanningLiveRoadmap(roadmapId, repoQuery);
      const fetchedRoadmap = roadmapResponse.roadmap || null;
      const fetchedWorkPoints = roadmapResponse.workPoints || [];
      const goalId = fetchedRoadmap?.goalId || '';

      const [goalResult, plansResult, todosResult] = await Promise.allSettled([
        goalId ? getPlanningLiveGoal(goalId, repoQuery) : Promise.resolve(null),
        listPlanningLivePlans({ ...repoQuery, roadmapId }),
        listPlanningLiveTodos({ ...repoQuery, roadmapId }),
      ]);

      setRoadmap(fetchedRoadmap);
      setWorkPoints(fetchedWorkPoints);
      setGoal(
        goalResult.status === 'fulfilled' && goalResult.value
          ? goalResult.value.goal
          : null,
      );
      setPlans(
        plansResult.status === 'fulfilled' && Array.isArray(plansResult.value.plans)
          ? plansResult.value.plans
          : [],
      );
      setTodos(
        todosResult.status === 'fulfilled' && Array.isArray(todosResult.value.todos)
          ? todosResult.value.todos
          : [],
      );
      setFetchError(null);
    } catch (err) {
      setGoal(null);
      setRoadmap(null);
      setWorkPoints([]);
      setPlans([]);
      setTodos([]);
      setFetchError(toErrorMessage(err, 'Unable to load planning graph data.'));
    } finally {
      setLoading(false);
    }
  }, [roadmapId, repoQuery]);

  // Initial fetch
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Auto-poll every 10s for active roadmaps
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (roadmap && roadmap.status === 'active') {
      pollRef.current = setInterval(() => {
        void fetchData();
      }, 10000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [roadmap?.status, fetchData]);

  // Reset zoom when roadmapId changes
  useEffect(() => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
    setSelectedNodeId(null);
    setZoomNodeId(null);
  }, [roadmapId]);

  // ---- Graph construction (memoised) ----

  const rootNode = useMemo<GraphNode | null>(
    () => buildGraphData(goal, roadmap, workPoints, plans, todos),
    [goal, roadmap, workPoints, plans, todos],
  );

  // ---- Container width (for layout centering) ----
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    function updateWidth() {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    }

    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // ---- Tree layout (memoised) ----

  const positions = useMemo<Map<string, NodePosition>>(
    () => (rootNode ? layoutTree(rootNode, containerWidth) : new Map()),
    [rootNode, containerWidth],
  );

  const viewBox = useMemo<string>(() => computeViewBox(positions), [positions]);

  // ---- Current selected node data ----

  const selectedGraphNode = useMemo<GraphNode | null>(() => {
    if (!selectedNodeId || !rootNode) return null;

    function findNode(node: GraphNode, id: string): GraphNode | null {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = findNode(child, id);
        if (found) return found;
      }
      return null;
    }

    return findNode(rootNode, selectedNodeId);
  }, [selectedNodeId, rootNode]);

  // ---- Pan handlers ----

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start pan on left-click when not clicking a node
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.graph-node')) return;

      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        tx: translateX,
        ty: translateY,
      };
    },
    [translateX, translateY],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning || !panStartRef.current) return;

      const dx = (e.clientX - panStartRef.current.x) / scale;
      const dy = (e.clientY - panStartRef.current.y) / scale;
      setTranslateX(panStartRef.current.tx + dx);
      setTranslateY(panStartRef.current.ty + dy);
    },
    [isPanning, scale],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  // ---- Wheel zoom ----

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setScale((prev) => Math.min(2.0, Math.max(0.3, prev * factor)));
    },
    [],
  );

  // ---- Zoom-to-node on double-click ----

  const handleNodeDoubleClick = useCallback(
    (node: GraphNode) => {
      const pos = positions.get(node.id);
      if (!pos) return;

      const svgEl = svgRef.current;
      if (!svgEl) return;

      const vb = svgEl.getAttribute('viewBox');
      if (!vb) return;

      const parts = vb.split(/\s+/).map(Number);
      const vbWidth = parts[2] || 800;
      const vbHeight = parts[3] || 600;

      // Target: zoom to 1.5x, center on the node
      const targetScale = 1.5;
      const targetTx = -(pos.x + pos.width / 2) + vbWidth / 2 / targetScale;
      const targetTy = -(pos.y + pos.height / 2) + vbHeight / 2 / targetScale;

      setScale(targetScale);
      setTranslateX(targetTx);
      setTranslateY(targetTy);
      setZoomNodeId(node.id);
    },
    [positions],
  );

  // ---- Render: Detail Panel ----

  const detailPanel = useMemo(() => {
    if (!selectedGraphNode) return null;

    const originalData = selectedGraphNode.originalData;
    let content: React.ReactNode = null;

    switch (selectedGraphNode.type) {
      case 'goal':
        content = <GoalDetailContent goal={originalData as PlanningLiveGoal | null} />;
        break;
      case 'roadmap':
        content = <RoadmapDetailContent roadmap={originalData as PlanningLiveRoadmapSummary | null} />;
        break;
      case 'workpoint':
        content = <WorkPointDetailContent workPoint={originalData as PlanningLiveWorkPoint | null} />;
        break;
      case 'plan':
        content = <PlanDetailContent plan={originalData as PlanningLivePlanSummary | null} />;
        break;
      case 'todo':
        content = <TodoDetailContent todo={originalData as PlanningLiveTodo | null} />;
        break;
    }

    return (
      <div className="planning-detail-panel" style={detailPanelStyle}>
        <div style={detailPanelHeaderStyle}>
          <span className="planning-chip" style={{ textTransform: 'uppercase', fontSize: '0.72rem' }}>
            {TYPE_LABELS[selectedGraphNode.type]}
          </span>
          <button
            type="button"
            onClick={() => setSelectedNodeId(null)}
            style={closeButtonStyle}
            aria-label="Close detail panel"
          >
            ✕
          </button>
        </div>
        {content}
      </div>
    );
  }, [selectedGraphNode]);

  // ---- Render ----

  const scalePercent = Math.round(scale * 100);

  // Flatten all nodes for rendering (pre-order traversal)
  const flatNodes = useMemo<GraphNode[]>(() => {
    if (!rootNode) return [];
    const result: GraphNode[] = [];

    function walk(node: GraphNode) {
      result.push(node);
      for (const child of node.children) {
        walk(child);
      }
    }

    walk(rootNode);
    return result;
  }, [rootNode]);

  // Build edges array from parent-child relationships
  const edges = useMemo<Array<{ from: string; to: string }>>(() => {
    const result: Array<{ from: string; to: string }> = [];

    function walk(node: GraphNode) {
      for (const child of node.children) {
        result.push({ from: node.id, to: child.id });
        walk(child);
      }
    }

    if (rootNode) walk(rootNode);
    return result;
  }, [rootNode]);

  // ---- States: Loading / Error / Empty ----

  if (!roadmapId) {
    return (
      <div ref={containerRef} style={containerStyle} data-testid="planning-graph-view">
        <div style={centerMessageStyle}>
          <p className="state-message">No roadmap selected. Select a roadmap to visualize.</p>
        </div>
      </div>
    );
  }

  if (loading && !roadmap) {
    return (
      <div ref={containerRef} style={containerStyle} data-testid="planning-graph-view">
        <div style={centerMessageStyle}>
          <p className="state-message">Loading planning graph...</p>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div ref={containerRef} style={containerStyle} data-testid="planning-graph-view">
        <div style={centerMessageStyle}>
          <p className="planning-error" role="alert">
            {fetchError}
          </p>
          <div style={{ marginTop: 12 }}>
            <Button onClick={() => void fetchData()} testId="planning-graph-retry" variant="secondary">
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!rootNode || flatNodes.length === 0) {
    return (
      <div ref={containerRef} style={containerStyle} data-testid="planning-graph-view">
        <div style={centerMessageStyle}>
          <p className="state-message">No data to visualize.</p>
        </div>
      </div>
    );
  }

  // ---- Normal render ----

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      data-testid="planning-graph-view"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* ---- SVG Graph ---- */}
      <svg
        ref={svgRef}
        viewBox={viewBox}
        style={svgStyle}
        data-testid="planning-graph-svg"
      >
        <g
          style={{
            transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* Edges */}
          {edges.map((edge) => {
            const parentPos = positions.get(edge.from);
            const childPos = positions.get(edge.to);
            if (!parentPos || !childPos) return null;

            return (
              <path
                key={`edge-${edge.from}-${edge.to}`}
                d={getEdgePath(parentPos, childPos, true)}
                fill="none"
                stroke="var(--color-ink-400)"
                strokeWidth={1.5}
                style={{ transition: 'd 0.3s ease' }}
              />
            );
          })}

          {/* Nodes */}
          {flatNodes.map((node) => {
            const pos = positions.get(node.id);
            if (!pos) return null;

            const isSelected = node.id === selectedNodeId;
            const statusColor = getStatusColor(node.status);

            return (
              <g
                key={node.id}
                className="graph-node"
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  transition: 'transform 0.3s ease',
                  cursor: 'pointer',
                }}
                onClick={() => setSelectedNodeId(node.id)}
                onDoubleClick={() => handleNodeDoubleClick(node)}
                data-testid={`graph-node-${node.id}`}
              >
                {/* Node rectangle */}
                <rect
                  rx={8}
                  ry={8}
                  width={pos.width}
                  height={pos.height}
                  fill={
                    isSelected
                      ? 'var(--color-surface-3)'
                      : 'var(--color-surface-1)'
                  }
                  stroke={
                    isSelected
                      ? 'var(--color-brand-400)'
                      : 'var(--color-border-200)'
                  }
                  strokeWidth={isSelected ? 2 : 1}
                  style={{
                    transition: 'fill 0.15s ease, stroke 0.15s ease',
                  }}
                />

                {/* Status indicator dot (top-right corner) */}
                <circle
                  cx={pos.width - 12}
                  cy={12}
                  r={4}
                  fill={statusColor}
                  stroke="var(--color-surface-1)"
                  strokeWidth={1}
                />

                {/* Type label */}
                <text
                  x={12}
                  y={20}
                  fill="var(--color-ink-400)"
                  fontSize={10}
                  fontFamily="inherit"
                >
                  {TYPE_LABELS[node.type]}
                </text>

                {/* Title */}
                <text
                  x={12}
                  y={38}
                  fill="var(--color-ink-950)"
                  fontSize={13}
                  fontWeight={600}
                  fontFamily="inherit"
                >
                  <tspan
                    dx={0}
                    dy={0}
                    style={{
                      maxWidth: pos.width - 24,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {node.title.length > 20
                      ? node.title.slice(0, 20) + '…'
                      : node.title}
                  </tspan>
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* ---- Controls overlay (top-left) ---- */}
      <div style={controlsOverlayStyle} data-testid="planning-graph-controls">
        <div style={controlsRowStyle}>
          <Button
            onClick={() => onBack()}
            testId="planning-graph-back"
            variant="secondary"
            size="sm"
          >
            ← Back
          </Button>
          <Button
            onClick={() => {
              void fetchData();
              onRefreshNeeded();
            }}
            testId="planning-graph-refresh"
            variant="secondary"
            size="sm"
          >
            Refresh
          </Button>
        </div>
        <div style={controlsRowStyle}>
          <Button
            onClick={() => setScale((s) => Math.min(2.0, s * 1.25))}
            testId="planning-graph-zoom-in"
            variant="ghost"
            size="sm"
          >
            +
          </Button>
          <span style={scaleIndicatorStyle}>{scalePercent}%</span>
          <Button
            onClick={() => setScale((s) => Math.max(0.3, s / 1.25))}
            testId="planning-graph-zoom-out"
            variant="ghost"
            size="sm"
          >
            −
          </Button>
          <Button
            onClick={() => {
              setScale(1);
              setTranslateX(0);
              setTranslateY(0);
              setZoomNodeId(null);
            }}
            testId="planning-graph-zoom-reset"
            variant="ghost"
            size="sm"
          >
            Reset
          </Button>
        </div>
      </div>

      {/* ---- Detail panel (slide-in right) ---- */}
      {detailPanel}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 400,
  overflow: 'hidden',
  background: 'var(--color-surface-0)',
  userSelect: 'none',
};

const svgStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
};

const centerMessageStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  minHeight: 300,
  textAlign: 'center',
  padding: 24,
};

const controlsOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  zIndex: 10,
};

const controlsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const scaleIndicatorStyle: React.CSSProperties = {
  color: 'var(--color-ink-500)',
  fontSize: '0.78rem',
  fontWeight: 600,
  minWidth: 40,
  textAlign: 'center',
  fontVariantNumeric: 'tabular-nums',
};

const detailPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  width: 350,
  height: '100%',
  overflowY: 'auto',
  background: 'var(--color-surface-1)',
  borderLeft: '1px solid var(--color-border-200)',
  padding: '16px',
  zIndex: 20,
  boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
};

const detailPanelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-ink-500)',
  fontSize: 18,
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: 4,
  lineHeight: 1,
};
