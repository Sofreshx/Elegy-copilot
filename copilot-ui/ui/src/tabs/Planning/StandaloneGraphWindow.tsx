import { Button } from '../../components';
import PlanningGraphView from './PlanningGraphView';

function readParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value && value.trim() ? value.trim() : undefined;
}

export default function StandaloneGraphWindow() {
  if (typeof window === 'undefined') {
    return <p className="state-message">Standalone graph window requires a browser environment.</p>;
  }

  const params = new URLSearchParams(window.location.search);
  const roadmapId = readParam(params, 'roadmapId');

  if (!roadmapId) {
    return (
      <div className="standalone-graph-error" style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>No roadmap specified</h2>
        <p className="state-message">
          This window is opened from the Planning Explorer when you click a roadmap card.
          Add <code>?roadmapId=...</code> to the URL to view a roadmap graph.
        </p>
        <Button
          onClick={() => window.close()}
          testId="standalone-graph-close"
          variant="secondary"
          size="sm"
          style={{ marginTop: '1rem' }}
        >
          Close Window
        </Button>
      </div>
    );
  }

  const repoQuery = {
    repoId: readParam(params, 'repoId'),
    repoPath: readParam(params, 'repoPath'),
    repoLabel: readParam(params, 'repoLabel'),
  };

  return (
    <PlanningGraphView
      roadmapId={roadmapId}
      repoQuery={repoQuery}
      onBack={() => window.close()}
      onRefreshNeeded={() => {
        // No-op: there is no parent tab to notify.
        // PlanningGraphView already fetches its own data and auto-polls.
      }}
    />
  );
}
