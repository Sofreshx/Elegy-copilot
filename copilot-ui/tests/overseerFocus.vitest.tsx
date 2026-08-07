import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OverseerFocusView from '../ui/src/views/Overseer/OverseerFocusView';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

describe('OverseerFocusView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/intelligence-surfaces/overseer')) return jsonResponse({ id: 'overseer', status: 'ready', reasonCode: 'ready', description: 'Ready', prerequisites: [] });
      if (url.includes('/api/overseer/focus/v1/ideas/idea%3Aone')) return jsonResponse({ format: 'overseer.focus-detail/v1', idea: { id: 'idea:one', name: 'Idea One', maturity: 'committed', reviewState: 'needs-review', readiness: 'unscored-missing-evidence', confidence: 'low', nextProof: 'Run the proof', summary: { problem: 'A bounded problem', beneficiary: 'A bounded audience', productWedge: 'A narrow wedge', mvpBoundary: 'One workflow', evidence: 'A reviewed fixture', relationshipSummary: 'A capability', risks: 'Prompt injection', nextDecision: 'Run the proof' } }, related: [] });
      return jsonResponse({ format: 'overseer.focus/v1', asOf: '2026-08-07T10:00:00.000Z', freshness: { status: 'fresh' }, recommendation: { title: 'Unblock Project One', summary: 'It is blocked.', nextAction: 'Request access', confidence: 'medium', horizon: 'now', rationale: [], counterpoint: 'Access arrives.' }, activeOutcomes: [{ id: 'workstream:one', projectName: 'Project One', title: 'A proof', state: 'blocked', summary: 'A proof', blocker: 'Needs access', nextAction: 'Request access', freshness: 'fresh', attention: true }], horizon: [{ id: 'now', label: 'Now', items: [{ id: 'goal:now', title: 'Close the gate', summary: 'Record an outcome', status: 'active' }] }, { id: 'next', label: 'Next', items: [] }, { id: 'later', label: 'Later', items: [] }], ideas: [{ id: 'idea:one', name: 'Idea One', maturity: 'committed', readiness: 'unscored-missing-evidence', confidence: 'low', summary: 'A bounded problem', nextProof: 'Run the proof' }], attention: [] });
    }));
  });

  it('shows one recommendation, active outcomes, horizon map, and idea detail', async () => {
    render(<OverseerFocusView />);
    expect(await screen.findByTestId('overseer-focus-view')).toBeInTheDocument();
    expect(await screen.findByText('Unblock Project One')).toBeInTheDocument();
    expect(screen.getByText('Active outcomes')).toBeInTheDocument();
    expect(screen.getByText('Close the gate')).toBeInTheDocument();
    expect(screen.getAllByText('Idea One').length).toBeGreaterThan(0);
    const idea = screen.getByRole('button', { name: /Idea One/ });
    fireEvent.click(idea);
    await waitFor(() => expect(screen.getByText('A bounded audience')).toBeInTheDocument());
    expect(screen.queryByText('idea:one')).not.toBeInTheDocument();
  });
});
