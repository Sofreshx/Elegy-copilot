import { useState, useEffect, useCallback, useRef } from 'react';
import { readRepoDoc } from '../../lib/api/repoDocs';
import type { RepoDocEntry } from '../../lib/api/repoDocs';

/* ── Types ── */

export interface GraphNode {
  id: string;        // file path
  label: string;     // display name (basename)
  path: string;      // full path
  x: number;         // position
  y: number;
  depth: number;     // directory depth (0=root)
}

export interface GraphEdge {
  source: string;    // node id
  target: string;    // node id
  type: 'link' | 'wiki';  // what kind of link
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/* ── Props ── */

interface DocumentationGraphViewProps {
  repoPath: string;
  files: RepoDocEntry[];
  onSelectDoc: (path: string) => void;
  testId?: string;
}

/* ── Pure helpers (exported for testability) ── */

export function normalizePath(path: string): string {
  // Remove leading ./ or /, resolve ../
  let p = path.replace(/^\.\//, '').replace(/^\//, '');
  const parts = p.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === '..') resolved.pop();
    else if (part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

export function extractDocLinks(content: string): { path: string; type: 'link' | 'wiki' }[] {
  const links: { path: string; type: 'link' | 'wiki' }[] = [];

  // Extract markdown links: [text](path.md)
  const mdRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/gi;
  let match;
  while ((match = mdRegex.exec(content)) !== null) {
    links.push({ path: normalizePath(match[2]), type: 'link' });
  }

  // Extract wiki links: [[target]] or [[target|alias]]
  const wikiRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  while ((match = wikiRegex.exec(content)) !== null) {
    links.push({ path: normalizePath(match[1] + '.md'), type: 'wiki' });
  }

  return links;
}

function getDepth(path: string): number {
  const normalized = path.replace(/\\/g, '/');
  // If path starts with specs/, depth is 1 (but we classify separately for layout)
  return normalized.split('/').length - (normalized.endsWith('/') ? 1 : 0);
}

function isSpecsFile(path: string): boolean {
  return path.replace(/\\/g, '/').startsWith('specs/');
}

function truncateLabel(label: string, max = 20): string {
  if (label.length <= max) return label;
  return label.slice(0, max - 3) + '...';
}

function computeRadialLayout(nodes: GraphNode[], svgW: number, svgH: number): GraphNode[] {
  const centerX = svgW / 2;
  const centerY = svgH / 2;

  // Group nodes by ring type: center (root), middle (specs), outer (docs/other depth 1+)
  const root: GraphNode[] = [];
  const specs: GraphNode[] = [];
  const outer: GraphNode[] = [];

  for (const node of nodes) {
    if (node.depth === 0) {
      root.push(node);
    } else if (isSpecsFile(node.path)) {
      specs.push(node);
    } else {
      outer.push(node);
    }
  }

  const radii: [number, GraphNode[]][] = [
    [60, root],
    [160, specs],
    [260, outer],
  ];

  const positioned: GraphNode[] = [];

  for (const [radius, group] of radii) {
    const count = group.length;
    if (count === 0) continue;

    const startAngle = -Math.PI / 2; // start from top
    const angleStep = (2 * Math.PI) / count;

    group.forEach((node, i) => {
      const angle = startAngle + angleStep * i;
      positioned.push({
        ...node,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });
  }

  return positioned;
}

/* ── Component ── */

export default function DocumentationGraphView({
  repoPath,
  files,
  onSelectDoc,
  testId = 'workspace-docs-graph',
}: DocumentationGraphViewProps) {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Drag state
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);

  const svgW = 800;
  const svgH = 500;

  // Build graph data
  useEffect(() => {
    let cancelled = false;

    async function buildGraph() {
      setLoading(true);
      setGraphData(null);

      try {
        // Filter out blocked files
        const validFiles = files.filter((f) => !f.blockedReason);
        if (validFiles.length === 0) {
          if (!cancelled) {
            setGraphData({ nodes: [], edges: [] });
            setLoading(false);
          }
          return;
        }

        // Create nodes
        const nodes: GraphNode[] = validFiles.map((f) => ({
          id: f.path,
          label: f.name,
          path: f.path,
          x: 0,
          y: 0,
          depth: getDepth(f.path),
        }));

        // Compute initial layout
        const positionedNodes = computeRadialLayout(nodes, svgW, svgH);
        const posMap = new Map<string, { x: number; y: number }>();
        for (const n of positionedNodes) {
          posMap.set(n.id, { x: n.x, y: n.y });
        }
        if (!cancelled) {
          setNodePositions(posMap);
        }

        // Fetch each doc content and extract links
        const filePaths = new Set(validFiles.map((f) => f.path));
        const edges: GraphEdge[] = [];
        const existingPaths = new Map<string, string>();
        for (const f of validFiles) {
          existingPaths.set(f.path.toLowerCase(), f.path);
        }

        for (const file of validFiles) {
          if (cancelled) return;
          try {
            const doc = await readRepoDoc(repoPath, file.path);
            const links = extractDocLinks(doc.content);
            for (const link of links) {
              // Try exact match first, then case-insensitive
              let targetPath: string | undefined;
              if (filePaths.has(link.path)) {
                targetPath = link.path;
              } else {
                targetPath = existingPaths.get(link.path.toLowerCase());
              }
              if (targetPath && targetPath !== file.path) {
                edges.push({
                  source: file.path,
                  target: targetPath,
                  type: link.type,
                });
              }
            }
          } catch {
            // Skip files that fail to read
          }
        }

        if (!cancelled) {
          setGraphData({ nodes: positionedNodes, edges });
        }
      } catch {
        // Silently handle errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void buildGraph();
    return () => { cancelled = true; };
  }, [repoPath, files, svgW, svgH]);

  // Currently displayed positions (initial layout + drag updates)
  const currentPositions = useCallback((nodeId: string): { x: number; y: number } => {
    const dragPos = nodePositions.get(nodeId);
    if (dragPos) return dragPos;
    const node = graphData?.nodes.find((n) => n.id === nodeId);
    return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  }, [nodePositions, graphData]);

  // Drag handlers
  function handleMouseDown(nodeId: string, e: React.MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = currentPositions(nodeId);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    setDragging(nodeId);
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragging) return;
    const newX = e.clientX - dragOffset.current.x;
    const newY = e.clientY - dragOffset.current.y;
    setNodePositions((prev) => {
      const next = new Map(prev);
      next.set(dragging, { x: newX, y: newY });
      return next;
    });
  }

  function handleMouseUp() {
    setDragging(null);
  }

  function handleMouseLeave() {
    setDragging(null);
  }

  function handleNodeClick(node: GraphNode) {
    setSelectedNode(node.id);
    onSelectDoc(node.path);
  }

  // Edge key for React
  function edgeKey(edge: GraphEdge, i: number): string {
    return `${edge.source}→${edge.target}@${i}`;
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const n of graphData?.nodes ?? []) {
    nodeMap.set(n.id, n);
  }

  // Colors by depth
  function getNodeColor(depth: number, path: string): string {
    if (depth === 0) return 'var(--color-brand-400, #2FA59D)';
    if (isSpecsFile(path)) return 'var(--color-accent-500, #E6B650)';
    return 'var(--color-brand-300, #5EC5BE)';
  }

  function getNodeStroke(depth: number, path: string): string {
    if (depth === 0) return 'var(--color-brand-600, #1A7A73)';
    if (isSpecsFile(path)) return 'var(--color-accent-600, #C99A2E)';
    return 'var(--color-brand-500, #2FA59D)';
  }

  const nodeCount = graphData?.nodes.length ?? 0;
  const edgeCount = graphData?.edges.length ?? 0;

  return (
    <div className="workspace-docs-graph" data-testid={testId}>
      <div className="workspace-docs-graph-header">
        <span className="workspace-docs-graph-summary" data-testid={`${testId}-summary`}>
          {loading
            ? 'Loading graph...'
            : graphData
              ? `${nodeCount} docs, ${edgeCount} links`
              : ''}
        </span>
      </div>

      {loading ? (
        <div className="workspace-docs-graph-svg" data-testid={`${testId}-loading`}>
          <div className="state-message" style={{ padding: '2rem', textAlign: 'center' }}>
            Loading graph...
          </div>
        </div>
      ) : !graphData || nodeCount === 0 ? (
        <div className="workspace-docs-graph-svg" data-testid={`${testId}-empty`}>
          <div className="state-message" style={{ padding: '2rem', textAlign: 'center' }}>
            No documentation files found to graph.
          </div>
        </div>
      ) : (
        <div className="workspace-docs-graph-svg" data-testid={`${testId}-svg-container`}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${svgW} ${svgH}`}
            xmlns="http://www.w3.org/2000/svg"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{ cursor: dragging ? 'grabbing' : 'default' }}
            data-testid={`${testId}-svg`}
          >
            <defs>
              <marker
                id="arrowhead"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <polygon points="0 0, 10 5, 0 10" fill="var(--color-ink-300, #999)" />
              </marker>
              <marker
                id="arrowhead-wiki"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <polygon points="0 0, 10 5, 0 10" fill="var(--color-ink-200, #CCC)" />
              </marker>
            </defs>

            {/* Edges */}
            <g data-testid={`${testId}-edges`}>
              {graphData.edges.map((edge, i) => {
                const sourcePos = currentPositions(edge.source);
                const targetPos = currentPositions(edge.target);
                const isWiki = edge.type === 'wiki';
                return (
                  <line
                    key={edgeKey(edge, i)}
                    x1={sourcePos.x}
                    y1={sourcePos.y}
                    x2={targetPos.x}
                    y2={targetPos.y}
                    className={isWiki ? 'graph-edge-line-wiki' : 'graph-edge-line'}
                    markerEnd={isWiki ? 'url(#arrowhead-wiki)' : 'url(#arrowhead)'}
                    data-testid={`${testId}-edge-${i}`}
                  />
                );
              })}
            </g>

            {/* Nodes */}
            <g data-testid={`${testId}-nodes`}>
              {graphData.nodes.map((node) => {
                const pos = currentPositions(node.id);
                const isHovered = hoveredNode === node.id;
                const isSelected = selectedNode === node.id;
                const r = isHovered ? 13 : 10;
                const isDragging = dragging === node.id;

                return (
                  <g
                    key={node.id}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    data-testid={`${testId}-node-${node.id}`}
                  >
                    {/* Tooltip */}
                    <title>{node.path}</title>

                    {/* Hover ring */}
                    {isHovered && !isSelected && (
                      <circle
                        r={r + 4}
                        fill="none"
                        stroke="var(--color-brand-300, #5EC5BE)"
                        strokeWidth={2}
                        opacity={0.5}
                      />
                    )}

                    {/* Main circle */}
                    <circle
                      r={r}
                      fill={getNodeColor(node.depth, node.path)}
                      stroke={
                        isSelected
                          ? 'var(--color-brand-700, #13605A)'
                          : getNodeStroke(node.depth, node.path)
                      }
                      strokeWidth={isSelected ? 3 : 2}
                      style={{ cursor: 'pointer' }}
                      className={
                        isSelected
                          ? 'graph-node-circle-selected'
                          : 'graph-node-circle'
                      }
                      onClick={() => handleNodeClick(node)}
                      onMouseEnter={() => setHoveredNode(node.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onMouseDown={(e) => handleMouseDown(node.id, e)}
                      data-testid={`${testId}-node-circle-${node.id}`}
                    />

                    {/* Label */}
                    <text
                      y={r + 14}
                      className="graph-node-text"
                      data-testid={`${testId}-node-label-${node.id}`}
                    >
                      {truncateLabel(node.label)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
