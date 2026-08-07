import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OverseerSystemView from '../ui/src/views/Overseer/OverseerSystemView';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

const payload = {
  format: 'overseer.system/v1',
  generatedAt: '2026-08-07T10:00:00.000Z',
  overview: { status: 'attention', message: 'Some system areas need review.', attentionCount: 2, checkedAt: '2026-08-07T10:00:00.000Z', snapshotStatus: 'coherent', dispatcher: { state: 'running', healthy: true, observedAt: '2026-08-07T10:00:00.000Z' } },
  services: [{ label: 'Overseer', status: 'ready', message: 'Healthy and ready.', checkedAt: '2026-08-07T10:00:00.000Z', healthStatus: 'ok', readiness: 'ready', latestAction: null, availableActions: ['observe'] }],
  reflection: { openFindings: 1, proposalsAwaitingReview: 1, activeExperiments: 0, latestAssessmentAt: null, findings: [{ title: 'Work projector', summary: 'Review bounded copy.', severity: 'medium', state: 'open', updatedAt: '2026-08-07T09:00:00.000Z' }], proposals: [{ title: 'System UI', summary: 'Make attention visible.', state: 'pending', updatedAt: '2026-08-07T09:00:00.000Z' }], experiments: [], selfModels: [{ label: 'Overseer', status: 'needs-assessment', assessedAt: null }] },
  skills: { profiles: [{ label: 'Overseer stable', status: 'ready', skillCount: 4, pendingCount: 0, attention: false }], items: [{ label: 'Todo review', summary: 'Review tasks safely.', lifecycle: 'promoted', provenance: 'distribution', useCount: 2, lastUsedAt: null, attention: false }], pendingCount: 0, attentionCount: 0 },
  cohort: { label: 'Hermes acceptance', status: 'pending', reviewedCount: 4, acceptableCount: 3, gates: [{ label: 'Intake triage', status: 'pending', summary: 'Still needs reviewed sample.' }] },
  migration: { pendingCount: 2, acceptedCount: 1, batchCount: 1, duplicateCount: 0, originalsPreserved: true, status: 'needs attention' },
};

describe('OverseerSystemView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('/api/intelligence-surfaces/overseer')
      ? jsonResponse({ id: 'overseer', status: 'ready', reasonCode: 'ready', description: 'Ready', checkedAt: '2026-08-07T10:00:00.000Z' })
      : jsonResponse(payload)));
  });

  it('shows a grouped System overview with advanced details collapsed', async () => {
    render(<OverseerSystemView />);
    expect(await screen.findByTestId('overseer-system-view')).toBeInTheDocument();
    expect(await screen.findByText('Some system areas need review.')).toBeInTheDocument();
    expect(screen.getByTestId('overseer-system-services')).toBeInTheDocument();
    expect(screen.getByTestId('overseer-system-reflection')).toBeInTheDocument();
    expect(screen.getByTestId('overseer-system-skills')).toBeInTheDocument();
    expect(screen.getByText('Legacy task cleanup')).toBeInTheDocument();
    expect(screen.getByText('Review details').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByText('Show governed skills').closest('details')).not.toHaveAttribute('open');
  });
});
