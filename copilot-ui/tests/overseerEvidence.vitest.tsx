import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OverseerEvidenceView from '../ui/src/views/Overseer/OverseerEvidenceView';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

function evidencePayload(focus: string | null = null) {
  return {
    format: 'overseer.evidence/v1',
    asOf: '2026-08-07T10:00:00.000Z',
    query: 'ReplyGuard',
    search: { status: 'ready', mode: 'hybrid', total: 1, results: [{ title: 'ReplyGuard', snippet: 'A bounded mailbox proof.', kind: 'idea', score: 0.91, freshness: '2026-08-06T12:00:00.000Z', technical: { id: 'chunk:one', subjectId: 'idea:replyguard' } }] },
    graph: { focus, depth: 1, nodes: [{ label: 'ReplyGuard', kind: 'idea', status: 'committed', summary: 'A bounded mailbox proof.', scope: 'shared', reviewState: 'confirmed', freshness: '2026-08-06T12:00:00.000Z', technical: { id: 'idea:replyguard' } }, { label: 'Project One', kind: 'project', status: 'active', summary: 'The delivery lane.', scope: 'shared', reviewState: 'needs-review', freshness: null, technical: { id: 'project:one' } }], edges: [{ from: 'ReplyGuard', relation: 'supports', to: 'Project One', rationale: 'Declared relationship.', technical: { from: 'idea:replyguard', to: 'project:one' } }] },
    repositories: { status: 'ready', items: [{ label: 'one', state: 'completed', scope: 'shared', summary: 'One bounded change.', nextActions: ['Review the proof.'], updatedAt: '2026-08-06T12:00:00.000Z', technical: { id: 'repository:one' } }] },
  };
}

describe('OverseerEvidenceView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/intelligence-surfaces/overseer')) return jsonResponse({ id: 'overseer', status: 'ready', reasonCode: 'ready', description: 'Ready', prerequisites: [] });
      const focus = new URL(url, 'http://127.0.0.1').searchParams.get('focus');
      return jsonResponse(evidencePayload(focus));
    }));
  });

  it('shows search, relationship context, and repository intelligence without opaque ids', async () => {
    render(<OverseerEvidenceView />);
    expect(await screen.findByTestId('overseer-evidence-view')).toBeInTheDocument();
    expect(await screen.findByText('Find the proof behind a decision')).toBeInTheDocument();
    expect(screen.getByText('Search results')).toBeInTheDocument();
    expect(screen.getAllByText('Project One').length).toBeGreaterThan(0);
    expect(screen.getByText('One bounded change.')).toBeInTheDocument();
    expect(screen.queryByText('idea:replyguard')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show context' }));
    await waitFor(() => expect(screen.getByText('Focused evidence')).toBeInTheDocument());
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([value]) => String(value).includes('focus=idea%3Areplyguard'))).toBe(true));
  });

  it('submits a bounded search query through the native facade', async () => {
    render(<OverseerEvidenceView />);
    const input = await screen.findByLabelText('Search notes, decisions, and repository evidence');
    fireEvent.change(input, { target: { value: 'evidence gate' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([value]) => String(value).includes('q=evidence+gate'))).toBe(true));
  });
});
