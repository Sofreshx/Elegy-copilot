import './workflow-pipeline.css';

// ── Types ──

export interface PipelineNode {
  stepId: string;
  label: string;
  type: string;       // 'session' | 'approval' | 'hook'
  status: string;     // 'pending' | 'running' | 'completed' | 'failed' | 'awaiting-approval' | 'skipped'
  isCurrent?: boolean;
  sessionId?: string | null;
}

export interface WorkflowPipelineProps {
  nodes: PipelineNode[];
  onNodeClick?: (node: PipelineNode) => void;
  compact?: boolean;
}

// ── Helpers ──

const TYPE_ICONS: Record<string, string> = {
  session: '▶',
  approval: '✋',
  hook: '⚡',
};

const STATUS_OVERLAY_ICONS: Record<string, string> = {
  completed: '✓',
  failed: '✗',
  'awaiting-approval': '⚠',
  running: '◉',
};

function statusClass(status: string): string {
  switch (status) {
    case 'pending':            return 'pipeline-node-pending';
    case 'running':            return 'pipeline-node-running';
    case 'completed':          return 'pipeline-node-completed';
    case 'failed':             return 'pipeline-node-failed';
    case 'awaiting-approval':  return 'pipeline-node-awaiting-approval';
    case 'skipped':            return 'pipeline-node-skipped';
    default:                   return 'pipeline-node-pending';
  }
}

// ── Component ──

export default function WorkflowPipeline({ nodes, onNodeClick, compact = false }: WorkflowPipelineProps) {
  const containerClass = `workflow-pipeline${compact ? ' pipeline-compact' : ''}`;

  return (
    <div className={containerClass} data-testid="workflow-pipeline" role="list" aria-label="Workflow pipeline">
      {nodes.map((node) => {
        const isClickable = !!(onNodeClick && (node.sessionId || node.status !== 'pending'));
        const nodeClasses = [
          'pipeline-node',
          statusClass(node.status),
          node.isCurrent ? 'pipeline-node-current' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const typeIcon = TYPE_ICONS[node.type] ?? '●';
        const overlayIcon = STATUS_OVERLAY_ICONS[node.status] ?? null;

        return (
          <div
            key={node.stepId}
            className={nodeClasses}
            data-testid={`pipeline-node-${node.stepId}`}
            data-clickable={isClickable ? 'true' : 'false'}
            role="listitem"
            aria-current={node.isCurrent ? 'step' : undefined}
            title={`${node.label} (${node.type}) — ${node.status}`}
            onClick={isClickable ? () => onNodeClick!(node) : undefined}
          >
            <span className="pipeline-node-type-icon" aria-hidden="true">
              {typeIcon}
            </span>
            <span className="pipeline-node-label">
              {node.label}
            </span>
            {overlayIcon && (
              <span className="pipeline-node-status-icon" aria-hidden="true">
                {overlayIcon}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
