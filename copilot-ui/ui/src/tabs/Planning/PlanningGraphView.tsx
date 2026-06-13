import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Button } from '../../components';
import {
  getPlanningLiveGoal,
  getPlanningLivePlan,
  getPlanningLiveRoadmap,
  listPlanningLiveRoadmaps,
  listPlanningLivePlans,
  listPlanningLiveTodos,
} from '../../lib/api';
import type {
  PlanningLiveGoal,
  PlanningLivePlanSummary,
  PlanningLiveReviewPoint,
  PlanningLiveRoadmapSection,
  PlanningLiveRoadmapSummary,
  PlanningLiveTodo,
  PlanningLiveValidationSummary,
  PlanningLiveWorkPoint,
} from '../../lib/types';
import { humanizeToken } from '../../lib/stateDiagnostics';

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2.0;
const ZOOM_WHEEL_FACTOR = 1.08;
const ZOOM_BUTTON_FACTOR = 1.2;
const PAN_ARROW_STEP = 50;

const NODE_WIDTH = 190;
const NODE_HEIGHT = 70;
const VERTICAL_SPACING = 130;
const HORIZONTAL_SPACING = 210;
const ROOT_Y = 90;

type GraphNodeType = 'goal' | 'roadmap' | 'section' | 'workpoint' | 'plan' | 'todo' | 'reviewPoint' | 'validationFinding';

interface GraphNode {
  id: string;
  type: GraphNodeType;
  parentId: string | null;
  title: string;
  status: string | null;
  summary: string | null;
  originalData: Record<string, unknown> | null;
  children: GraphNode[];
  childCount: number;
}

interface RoadmapDetail {
  roadmap: PlanningLiveRoadmapSummary;
  sections: PlanningLiveRoadmapSection[];
  workPoints: PlanningLiveWorkPoint[];
  validation: PlanningLiveValidationSummary | null;
}

interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlanningGraphViewProps {
  goalId?: string | null;
  roadmapId?: string | null;
  repoQuery: { repoId?: string; repoPath?: string; repoLabel?: string };
  onBack: () => void;
  onRefreshNeeded: () => void;
}

const TYPE_LABELS: Record<GraphNodeType, string> = {
  goal: 'Goal',
  roadmap: 'Roadmap',
  section: 'Section',
  workpoint: 'Work Point',
  plan: 'Plan',
  todo: 'Todo',
  reviewPoint: 'Review',
  validationFinding: 'Finding',
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatTimestamp(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return raw;
  return new Date(ts).toLocaleString();
}

function formatScalar(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function statusColor(status: string | null | undefined): string {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'proposed' || s === 'in-progress' || s === 'warning') return 'var(--color-accent-500)';
  if (s === 'completed' || s === 'finished' || s === 'done' || s === 'pass' || s === 'valid') return 'var(--color-success-500)';
  if (s === 'blocked' || s === 'fail' || s === 'failed' || s === 'error') return 'var(--color-danger-500)';
  if (s === 'draft' || s === 'skip' || s === 'skipped') return 'var(--color-ink-400)';
  return 'var(--color-ink-300)';
}

function sortByOrdering<T extends { ordering?: number | null; title?: string | null; id?: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ao = a.ordering ?? Number.MAX_SAFE_INTEGER;
    const bo = b.ordering ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.title || a.id || '').localeCompare(String(b.title || b.id || ''));
  });
}

function makeNode(
  type: GraphNodeType,
  id: string,
  parentId: string | null,
  title: string,
  status: string | null,
  summary: string | null,
  originalData: Record<string, unknown> | null,
): GraphNode {
  return {
    id,
    type,
    parentId,
    title,
    status,
    summary,
    originalData,
    children: [],
    childCount: 0,
  };
}

function appendPlanChildren(
  planNode: GraphNode,
  todosByPlanId: Map<string, PlanningLiveTodo[]>,
  reviewPointsByPlanId: Map<string, PlanningLiveReviewPoint[]>,
) {
  const plan = planNode.originalData;
  const planId = asString(plan && plan.id);
  if (!planId) return;

  for (const todo of sortByOrdering(todosByPlanId.get(planId) || [])) {
    planNode.children.push(makeNode(
      'todo',
      `todo-${todo.id}`,
      planNode.id,
      todo.title || todo.id,
      todo.status || null,
      todo.summary || null,
      asRecord(todo),
    ));
  }

  for (const reviewPoint of reviewPointsByPlanId.get(planId) || []) {
    const record = asRecord(reviewPoint) || {};
    const title = asString(record.title) || asString(record.summary) || reviewPoint.id;
    planNode.children.push(makeNode(
      'reviewPoint',
      `review-${reviewPoint.id}`,
      planNode.id,
      title,
      asString(record.status),
      asString(record.summary) || asString(record.details),
      record,
    ));
  }
}

function buildGraphData(
  goal: PlanningLiveGoal | null,
  roadmapDetails: RoadmapDetail[],
  plans: PlanningLivePlanSummary[],
  todos: PlanningLiveTodo[],
  reviewPointsByPlanId: Map<string, PlanningLiveReviewPoint[]>,
): GraphNode | null {
  if (!goal && roadmapDetails.length === 0) return null;

  const rootId = goal ? `goal-${goal.id}` : 'goal-missing';
  const root = makeNode(
    'goal',
    rootId,
    null,
    goal?.title || 'Goal',
    goal?.status || null,
    goal?.description || null,
    goal ? asRecord(goal) : null,
  );

  const plansByRoadmapId = new Map<string, PlanningLivePlanSummary[]>();
  const plansByWorkPointId = new Map<string, PlanningLivePlanSummary[]>();
  const unassignedPlans = new Set<string>();
  for (const plan of plans) {
    if (plan.roadmapId) {
      if (!plansByRoadmapId.has(plan.roadmapId)) plansByRoadmapId.set(plan.roadmapId, []);
      plansByRoadmapId.get(plan.roadmapId)!.push(plan);
    }
    if (plan.targetedWorkPointIds.length === 0) {
      unassignedPlans.add(plan.id);
    }
    for (const wpId of plan.targetedWorkPointIds) {
      if (!plansByWorkPointId.has(wpId)) plansByWorkPointId.set(wpId, []);
      plansByWorkPointId.get(wpId)!.push(plan);
    }
  }

  const todosByPlanId = new Map<string, PlanningLiveTodo[]>();
  for (const todo of todos) {
    if (!todo.planId) continue;
    if (!todosByPlanId.has(todo.planId)) todosByPlanId.set(todo.planId, []);
    todosByPlanId.get(todo.planId)!.push(todo);
  }

  const renderedPlanIds = new Set<string>();

  for (const detail of roadmapDetails) {
    const roadmap = detail.roadmap;
    const roadmapNode = makeNode(
      'roadmap',
      `roadmap-${roadmap.id}`,
      root.id,
      roadmap.title || roadmap.id,
      roadmap.status || detail.validation?.status || null,
      roadmap.summary || null,
      asRecord(roadmap),
    );
    root.children.push(roadmapNode);

    const sectionNodes = new Map<string, GraphNode>();
    for (const section of sortByOrdering(detail.sections)) {
      const sectionId = section.id || `${roadmap.id}-section-${section.ordering ?? section.title ?? sectionNodes.size}`;
      const node = makeNode(
        'section',
        `section-${sectionId}`,
        roadmapNode.id,
        section.title || sectionId,
        null,
        section.summary || null,
        asRecord(section),
      );
      sectionNodes.set(sectionId, node);
      roadmapNode.children.push(node);
    }

    const attachWorkPoint = (workPoint: PlanningLiveWorkPoint, parent: GraphNode) => {
      const wpNode = makeNode(
        'workpoint',
        `workpoint-${workPoint.id}`,
        parent.id,
        workPoint.title || workPoint.id,
        workPoint.status || null,
        workPoint.summary || null,
        asRecord(workPoint),
      );
      parent.children.push(wpNode);

      for (const plan of plansByWorkPointId.get(workPoint.id) || []) {
        if (renderedPlanIds.has(plan.id)) continue;
        const planNode = makeNode(
          'plan',
          `plan-${plan.id}`,
          wpNode.id,
          plan.title || plan.id,
          plan.status || null,
          plan.summary || null,
          asRecord(plan),
        );
        renderedPlanIds.add(plan.id);
        appendPlanChildren(planNode, todosByPlanId, reviewPointsByPlanId);
        wpNode.children.push(planNode);
      }
    };

    for (const workPoint of sortByOrdering(detail.workPoints)) {
      const sectionParent = workPoint.sectionId ? sectionNodes.get(workPoint.sectionId) : null;
      attachWorkPoint(workPoint, sectionParent || roadmapNode);
    }

    for (const plan of sortByOrdering(plansByRoadmapId.get(roadmap.id) || [])) {
      if (renderedPlanIds.has(plan.id) || (!unassignedPlans.has(plan.id) && plan.targetedWorkPointIds.length > 0)) continue;
      const planNode = makeNode(
        'plan',
        `plan-${plan.id}`,
        roadmapNode.id,
        plan.title || plan.id,
        plan.status || null,
        plan.summary || null,
        asRecord(plan),
      );
      renderedPlanIds.add(plan.id);
      appendPlanChildren(planNode, todosByPlanId, reviewPointsByPlanId);
      roadmapNode.children.push(planNode);
    }

    for (const finding of detail.validation?.findings || []) {
      const title = finding.message || finding.code || finding.findingId || 'Validation finding';
      roadmapNode.children.push(makeNode(
        'validationFinding',
        `finding-${roadmap.id}-${finding.findingId || finding.code || title}`,
        roadmapNode.id,
        title,
        finding.severity || detail.validation?.status || null,
        finding.message || null,
        asRecord(finding),
      ));
    }
  }

  function updateCounts(node: GraphNode): number {
    node.childCount = node.children.length;
    for (const child of node.children) updateCounts(child);
    return node.childCount;
  }
  updateCounts(root);

  return root;
}

function layoutTree(root: GraphNode, containerWidth: number): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();

  function subtreeLeafCount(node: GraphNode): number {
    if (node.children.length === 0) return 1;
    return node.children.reduce((sum, child) => sum + subtreeLeafCount(child), 0);
  }

  function layoutNode(node: GraphNode, x: number, y: number) {
    positions.set(node.id, { x: x - NODE_WIDTH / 2, y, width: NODE_WIDTH, height: NODE_HEIGHT });
    if (node.children.length === 0) return;

    const childLeafCounts = node.children.map((child) => subtreeLeafCount(child));
    const totalLeafs = childLeafCounts.reduce((sum, count) => sum + count, 0);
    const totalWidth = totalLeafs * HORIZONTAL_SPACING;
    let cursorX = x - totalWidth / 2 + (childLeafCounts[0] * HORIZONTAL_SPACING) / 2;

    for (let i = 0; i < node.children.length; i += 1) {
      layoutNode(node.children[i], cursorX, y + VERTICAL_SPACING);
      cursorX += childLeafCounts[i] * HORIZONTAL_SPACING;
    }
  }

  const treeWidth = subtreeLeafCount(root) * HORIZONTAL_SPACING;
  layoutNode(root, Math.max(containerWidth / 2, treeWidth / 2), ROOT_Y);
  return positions;
}

function getEdgePath(parent: NodePosition, child: NodePosition): string {
  const x1 = parent.x + parent.width / 2;
  const y1 = parent.y + parent.height;
  const x2 = child.x + child.width / 2;
  const y2 = child.y;
  const cy = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${cy} ${x2},${cy} ${x2},${y2}`;
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  const formatted = label.toLowerCase().includes('created') || label.toLowerCase().includes('updated')
    ? formatTimestamp(value)
    : formatScalar(value);
  if (!formatted) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatted}</dd>
    </div>
  );
}

function DetailList({ label, values }: { label: string; values: unknown }) {
  const items = Array.isArray(values)
    ? values.map((item) => formatScalar(item)).filter((item): item is string => Boolean(item))
    : [];
  if (items.length === 0) return null;
  return (
    <div>
      <p className="planning-metric-label">{label}</p>
      <ul className="planning-guidance-list">
        {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

function DetailChips({ label, values }: { label: string; values: unknown }) {
  const items = Array.isArray(values)
    ? values.map((item) => formatScalar(item)).filter((item): item is string => Boolean(item))
    : [];
  if (items.length === 0) return null;
  return (
    <div>
      <p className="planning-metric-label">{label}</p>
      <div className="planning-chip-row">
        {items.map((item) => <span key={item} className="planning-chip">{item}</span>)}
      </div>
    </div>
  );
}

function NodeInspector({ node, onClose }: { node: GraphNode | null; onClose: () => void }) {
  if (!node) {
    return (
      <aside className="planning-detail-panel planning-detail-panel--external" data-testid="planning-graph-inspector">
        <p className="state-message">Select a graph item to view details.</p>
      </aside>
    );
  }

  const record = node.originalData || {};
  return (
    <aside className="planning-detail-panel planning-detail-panel--external" data-testid="planning-graph-inspector">
      <div className="planning-detail-header">
        <span className="planning-chip">{TYPE_LABELS[node.type]}</span>
        <button type="button" className="planning-detail-close" onClick={onClose} aria-label="Close detail panel">x</button>
      </div>
      <div className="planning-section-stack">
        <p className="planning-item-title">{node.title}</p>
        {node.summary && <p className="planning-item-copy">{node.summary}</p>}
        <dl className="planning-definition-grid">
          <DetailField label="ID" value={record.id || node.id} />
          <DetailField label="Status" value={humanizeToken(node.status)} />
          <DetailField label="Created" value={record.createdAt} />
          <DetailField label="Updated" value={record.updatedAt} />
          <DetailField label="Revision" value={record.revision} />
          <DetailField label="Goal" value={record.goalId} />
          <DetailField label="Roadmap" value={record.roadmapId} />
          <DetailField label="Section" value={record.sectionId} />
          <DetailField label="Plan" value={record.planId} />
          <DetailField label="Work Point" value={record.workPointId} />
          <DetailField label="Scope" value={record.scope} />
          <DetailField label="Ordering" value={record.ordering} />
          <DetailField label="Priority" value={record.priority} />
          <DetailField label="Children" value={node.childCount || null} />
          <DetailField label="Severity" value={record.severity} />
          <DetailField label="Code" value={record.code} />
        </dl>
        <DetailChips label="Tags" values={record.tags} />
        <DetailChips label="Dependencies" values={record.dependencyIds} />
        <DetailChips label="Targeted Work Points" values={record.targetedWorkPointIds} />
        <DetailList label="Acceptance Criteria" values={record.acceptanceCriteria} />
        <DetailList label="Rejection Criteria" values={record.rejectionCriteria} />
        <DetailList label="Validation Expectations" values={record.validationExpectations} />
        <DetailList label="Validation Steps" values={record.validationSteps} />
        <DetailList label="Assumptions" values={record.assumptions} />
        <DetailList label="Stop Conditions" values={record.stopConditions} />
        <DetailList label="Evidence Refs" values={record.evidenceRefs} />
      </div>
    </aside>
  );
}

export default function PlanningGraphView({ goalId, roadmapId, repoQuery, onBack, onRefreshNeeded }: PlanningGraphViewProps) {
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [goal, setGoal] = useState<PlanningLiveGoal | null>(null);
  const [roadmapDetails, setRoadmapDetails] = useState<RoadmapDetail[]>([]);
  const [plans, setPlans] = useState<PlanningLivePlanSummary[]>([]);
  const [todos, setTodos] = useState<PlanningLiveTodo[]>([]);
  const [reviewPointsByPlanId, setReviewPointsByPlanId] = useState<Map<string, PlanningLiveReviewPoint[]>>(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 520 });

  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const centeredEntityRef = useRef<string | null>(null);

  const activeEntityId = goalId || roadmapId || null;

  const fetchData = useCallback(async () => {
    if (!activeEntityId) {
      setLoading(false);
      setFetchError(null);
      setGoal(null);
      setRoadmapDetails([]);
      setPlans([]);
      setTodos([]);
      setReviewPointsByPlanId(new Map());
      return;
    }

    try {
      setLoading(true);
      setFetchError(null);

      let fetchedGoal: PlanningLiveGoal | null = null;
      let roadmaps: PlanningLiveRoadmapSummary[] = [];
      let fetchedPlans: PlanningLivePlanSummary[] = [];

      if (goalId) {
        const goalResponse = await getPlanningLiveGoal(goalId, repoQuery);
        fetchedGoal = goalResponse.goal || null;
        roadmaps = goalResponse.roadmaps || [];
        if (roadmaps.length === 0) {
          const roadmapsResponse = await listPlanningLiveRoadmaps({ ...repoQuery, includeUnscoped: true });
          roadmaps = (roadmapsResponse.roadmaps || []).filter((roadmap) => roadmap.goalId === goalId);
        }
        const plansResponse = await listPlanningLivePlans({ ...repoQuery, goalId });
        fetchedPlans = plansResponse.plans || [];
      } else if (roadmapId) {
        const roadmapResponse = await getPlanningLiveRoadmap(roadmapId, repoQuery);
        const roadmap = roadmapResponse.roadmap || null;
        if (roadmap) {
          roadmaps = [roadmap];
          if (roadmap.goalId) {
            const goalResponse = await getPlanningLiveGoal(roadmap.goalId, repoQuery).catch(() => null);
            fetchedGoal = goalResponse?.goal || null;
          }
        }
        const plansResponse = await listPlanningLivePlans({ ...repoQuery, roadmapId });
        fetchedPlans = plansResponse.plans || [];
      }

      const roadmapResponses = await Promise.all(
        roadmaps.map((roadmap) => getPlanningLiveRoadmap(roadmap.id, repoQuery).catch(() => null)),
      );
      const details = roadmapResponses
        .map((response, index): RoadmapDetail | null => {
          const roadmap = response?.roadmap || roadmaps[index];
          if (!roadmap) return null;
          return {
            roadmap,
            sections: response?.sections || [],
            workPoints: response?.workPoints || [],
            validation: response?.validation || null,
          };
        })
        .filter((entry): entry is RoadmapDetail => entry !== null);

      const planDetails = await Promise.all(
        fetchedPlans.map((plan) => getPlanningLivePlan(plan.id, repoQuery).catch(() => null)),
      );
      const allTodos: PlanningLiveTodo[] = [];
      const reviewMap = new Map<string, PlanningLiveReviewPoint[]>();
      planDetails.forEach((detail, index) => {
        const planId = fetchedPlans[index]?.id;
        if (!planId || !detail) return;
        for (const todo of detail.todos || []) allTodos.push(todo);
        if (detail.reviewPoints?.length) reviewMap.set(planId, detail.reviewPoints);
      });

      if (allTodos.length === 0 && roadmapId) {
        const todosResponse = await listPlanningLiveTodos({ ...repoQuery, roadmapId }).catch(() => null);
        if (todosResponse?.todos) allTodos.push(...todosResponse.todos);
      }

      setGoal(fetchedGoal);
      setRoadmapDetails(details);
      setPlans(fetchedPlans);
      setTodos(allTodos);
      setReviewPointsByPlanId(reviewMap);
    } catch (err) {
      setGoal(null);
      setRoadmapDetails([]);
      setPlans([]);
      setTodos([]);
      setReviewPointsByPlanId(new Map());
      setFetchError(toErrorMessage(err, 'Unable to load planning graph data.'));
    } finally {
      setLoading(false);
    }
  }, [activeEntityId, goalId, roadmapId, repoQuery]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
    setSelectedNodeId(null);
    centeredEntityRef.current = null;
  }, [activeEntityId]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setScale((s) => Math.min(ZOOM_MAX, s * ZOOM_BUTTON_FACTOR));
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          setScale((s) => Math.max(ZOOM_MIN, s / ZOOM_BUTTON_FACTOR));
          return;
        }
        if (e.key === '0') {
          e.preventDefault();
          setScale(1);
          setTranslateX(0);
          setTranslateY(0);
          return;
        }
      }
      if (e.key === 'Escape') setSelectedNodeId(null);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setTranslateY((ty) => ty + PAN_ARROW_STEP);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setTranslateY((ty) => ty - PAN_ARROW_STEP);
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setTranslateX((tx) => tx + PAN_ARROW_STEP);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setTranslateX((tx) => tx - PAN_ARROW_STEP);
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    function updateSize() {
      if (containerRef.current) {
        setContainerSize({
          width: Math.max(containerRef.current.clientWidth, 800),
          height: Math.max(containerRef.current.clientHeight, 520),
        });
      }
    }
    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(updateSize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const rootNode = useMemo(
    () => buildGraphData(goal, roadmapDetails, plans, todos, reviewPointsByPlanId),
    [goal, roadmapDetails, plans, todos, reviewPointsByPlanId],
  );
  const positions = useMemo(() => (rootNode ? layoutTree(rootNode, containerSize.width) : new Map<string, NodePosition>()), [rootNode, containerSize.width]);
  const viewBox = useMemo(() => `0 0 ${containerSize.width} ${containerSize.height}`, [containerSize]);

  const flatNodes = useMemo<GraphNode[]>(() => {
    const result: GraphNode[] = [];
    function walk(node: GraphNode) {
      result.push(node);
      for (const child of node.children) walk(child);
    }
    if (rootNode) walk(rootNode);
    return result;
  }, [rootNode]);

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

  const selectedGraphNode = useMemo(() => flatNodes.find((node) => node.id === selectedNodeId) || null, [flatNodes, selectedNodeId]);
  const scalePercent = Math.round(scale * 100);

  useEffect(() => {
    if (!activeEntityId || !rootNode || centeredEntityRef.current === activeEntityId) return;
    const rootPos = positions.get(rootNode.id);
    if (!rootPos) return;
    setScale(1);
    setTranslateX((containerSize.width / 2) - (rootPos.x + rootPos.width / 2));
    setTranslateY(36 - rootPos.y);
    centeredEntityRef.current = activeEntityId;
  }, [activeEntityId, rootNode, positions, containerSize]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.graph-node')) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, tx: translateX, ty: translateY };
  }, [translateX, translateY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !panStartRef.current) return;
    const dx = (e.clientX - panStartRef.current.x) / scale;
    const dy = (e.clientY - panStartRef.current.y) / scale;
    setTranslateX(panStartRef.current.tx + dx);
    setTranslateY(panStartRef.current.ty + dy);
  }, [isPanning, scale]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_WHEEL_FACTOR : 1 / ZOOM_WHEEL_FACTOR;
    setScale((prev) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor)));
  }, []);

  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    const pos = positions.get(node.id);
    const svgEl = svgRef.current;
    if (!pos || !svgEl) return;
    const vb = svgEl.getAttribute('viewBox');
    if (!vb) return;
    const parts = vb.split(/\s+/).map(Number);
    const vbWidth = parts[2] || 800;
    const vbHeight = parts[3] || 600;
    const targetScale = 1.5;
    setScale(targetScale);
    setTranslateX(-(pos.x + pos.width / 2) + vbWidth / 2 / targetScale);
    setTranslateY(-(pos.y + pos.height / 2) + vbHeight / 2 / targetScale);
  }, [positions]);

  if (!activeEntityId) {
    return (
      <div className="planning-graph-shell" data-testid="planning-graph-view">
        <div className="planning-graph-canvas" ref={containerRef}>
          <div style={centerMessageStyle}><p className="state-message">Select a goal to visualize.</p></div>
        </div>
      </div>
    );
  }

  if (loading && roadmapDetails.length === 0) {
    return (
      <div className="planning-graph-shell" data-testid="planning-graph-view">
        <div className="planning-graph-canvas" ref={containerRef}>
          <div style={centerMessageStyle}><p className="state-message">Loading planning graph...</p></div>
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="planning-graph-shell" data-testid="planning-graph-view">
        <div className="planning-graph-canvas" ref={containerRef}>
          <div style={centerMessageStyle}>
            <p className="planning-error" role="alert">{fetchError}</p>
            <div style={{ marginTop: 12 }}>
              <Button onClick={() => void fetchData()} testId="planning-graph-retry" variant="secondary">Retry</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!rootNode || flatNodes.length === 0) {
    return (
      <div className="planning-graph-shell" data-testid="planning-graph-view">
        <div className="planning-graph-canvas" ref={containerRef}>
          <div style={centerMessageStyle}><p className="state-message">No data to visualize.</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`planning-graph-shell${selectedGraphNode ? ' planning-graph-shell--with-detail' : ''}`} data-testid="planning-graph-view">
      <div
        ref={containerRef}
        className="planning-graph-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <svg ref={svgRef} viewBox={viewBox} style={svgStyle} data-testid="planning-graph-svg">
          <g style={{ transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`, transformOrigin: '0 0' }}>
            {edges.map((edge) => {
              const parentPos = positions.get(edge.from);
              const childPos = positions.get(edge.to);
              if (!parentPos || !childPos) return null;
              return (
                <path
                  key={`edge-${edge.from}-${edge.to}`}
                  d={getEdgePath(parentPos, childPos)}
                  fill="none"
                  stroke="var(--color-ink-400)"
                  strokeWidth={1.5}
                />
              );
            })}
            {flatNodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;
              const isSelected = node.id === selectedNodeId;
              const color = statusColor(node.status);
              return (
                <g
                  key={node.id}
                  className="graph-node"
                  style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, cursor: 'pointer' }}
                  onClick={() => setSelectedNodeId(node.id)}
                  onDoubleClick={() => handleNodeDoubleClick(node)}
                  data-testid={`graph-node-${node.id}`}
                >
                  <rect
                    rx={8}
                    ry={8}
                    width={pos.width}
                    height={pos.height}
                    fill={isSelected ? 'var(--color-surface-3)' : 'var(--color-surface-1)'}
                    stroke={isSelected ? 'var(--color-brand-400)' : color}
                    strokeWidth={isSelected ? 2 : 1.5}
                  />
                  <circle cx={pos.width - 14} cy={14} r={4} fill={color} />
                  <text x={12} y={20} fill="var(--color-ink-400)" fontSize={10} fontFamily="inherit">
                    {TYPE_LABELS[node.type]}
                  </text>
                  <text x={12} y={40} fill="var(--color-ink-950)" fontSize={13} fontWeight={600} fontFamily="inherit">
                    {node.title.length > 22 ? `${node.title.slice(0, 22)}...` : node.title}
                  </text>
                  {node.childCount > 0 && (
                    <text x={12} y={58} fill="var(--color-ink-500)" fontSize={10} fontFamily="inherit">
                      {node.childCount} child{node.childCount === 1 ? '' : 'ren'}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div style={controlsOverlayStyle} data-testid="planning-graph-controls">
          <div style={controlsRowStyle}>
            <Button onClick={() => onBack()} testId="planning-graph-back" variant="secondary" size="sm">Back</Button>
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
          <span className="planning-graph-summary" data-testid="planning-graph-summary">
            {flatNodes.length} nodes / {edges.length} links
          </span>
          <div style={controlsRowStyle}>
            <Button onClick={() => setScale((s) => Math.min(ZOOM_MAX, s * ZOOM_BUTTON_FACTOR))} testId="planning-graph-zoom-in" variant="ghost" size="sm">+</Button>
            <span style={scaleIndicatorStyle}>{scalePercent}%</span>
            <Button onClick={() => setScale((s) => Math.max(ZOOM_MIN, s / ZOOM_BUTTON_FACTOR))} testId="planning-graph-zoom-out" variant="ghost" size="sm">-</Button>
            <Button
              onClick={() => {
                setScale(1);
                setTranslateX(0);
                setTranslateY(0);
              }}
              testId="planning-graph-zoom-reset"
              variant="ghost"
              size="sm"
            >
              Reset
            </Button>
          </div>
        </div>
      </div>
      {selectedGraphNode && <NodeInspector node={selectedGraphNode} onClose={() => setSelectedNodeId(null)} />}
    </div>
  );
}

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
