import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OverseerWorkView from '../ui/src/views/Overseer/OverseerWorkView';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

describe('OverseerWorkView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/intelligence-surfaces/overseer')) {
        return jsonResponse({ id: 'overseer', name: 'Overseer', description: 'Local authority', status: 'ready', reasonCode: 'ready', checkedAt: '2026-08-07T10:00:00.000Z', prerequisites: [] });
      }
      if (url.includes('/api/overseer/work/v1/items/agent-action%3Asafe')) {
        return jsonResponse({ item: { id: 'agent-action:safe', title: 'Review the task', summary: 'Ready for review: outcome', kind: 'todo-create', bucket: 'needs-you', state: 'ready-for-review', stage: 'result-ready', runner: { kind: 'hermes', label: 'Hermes' }, privacy: 'hosted-redacted', createdAt: '2026-08-07T10:00:00.000Z', updatedAt: '2026-08-07T10:00:00.000Z', currentMessage: 'A result is ready for your review.', availableActions: ['preview', 'review'], timeline: [{ stage: 'queued', timestamp: '2026-08-07T10:00:00.000Z', actor: 'system', reasonCode: 'created', message: 'Work was added to the queue.' }], technicalDetails: { requestedModel: 'opencode-go/hidden' } } });
      }
      return jsonResponse({ items: [{ id: 'agent-action:safe', title: 'Review the task', summary: 'Ready for review: outcome', kind: 'todo-create', bucket: 'needs-you', state: 'ready-for-review', stage: 'result-ready', runner: { kind: 'hermes', label: 'Hermes' }, privacy: 'hosted-redacted', createdAt: '2026-08-07T10:00:00.000Z', updatedAt: '2026-08-07T10:00:00.000Z', currentMessage: 'A result is ready for your review.', availableActions: ['preview', 'review'] }], counts: { 'needs-you': 1, active: 0, history: 0 }, nextCursor: null });
    }));
  });

  it('renders grouped safe work and opens the New Work drawer', async () => {
    render(<OverseerWorkView />);
    expect(await screen.findByTestId('overseer-work-view')).toBeInTheDocument();
    expect(screen.getByText('Needs you')).toBeInTheDocument();
    expect(await screen.findByText('Review the task')).toBeInTheDocument();
    expect(screen.queryByText('opencode-go/hidden')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('overseer-new-work'));
    expect(screen.getByTestId('overseer-new-work-drawer')).toBeInTheDocument();
    expect(screen.getByText('Choose an outcome. Overseer will organize the details.')).toBeInTheDocument();
  });

  it('shows a recovery state when the source-owned service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/intelligence-surfaces/overseer')) return jsonResponse({ id: 'overseer', status: 'stopped', reasonCode: 'service_stopped', description: 'Start Overseer to continue.', prerequisites: [] });
      return Promise.reject(new Error('failed'));
    }));
    render(<OverseerWorkView />);
    await waitFor(() => expect(screen.getByTestId('overseer-recovery')).toBeInTheDocument());
    expect(screen.getByText('Overseer is unavailable')).toBeInTheDocument();
  });

  it('exposes an explicit review action for non-task review-ready work', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/intelligence-surfaces/overseer')) {
        return jsonResponse({ id: 'overseer', status: 'ready', reasonCode: 'ready', description: 'Ready', prerequisites: [] });
      }
      if (url.includes('/api/overseer/work/v1/items/')) {
        return jsonResponse({ item: { id: 'source-intake:review', title: 'Source intake', summary: 'A result is ready for your review.', kind: 'source-intake', bucket: 'needs-you', state: 'ready-for-review', stage: 'result-ready', runner: { kind: 'hermes', label: 'Hermes' }, privacy: 'public-safe', createdAt: '2026-08-07T10:00:00.000Z', updatedAt: '2026-08-07T10:00:00.000Z', currentMessage: 'A result is ready for your review.', availableActions: ['review', 'cancel'], timeline: [], technicalDetails: {} } });
      }
      return jsonResponse({ items: [{ id: 'source-intake:review', title: 'Source intake', summary: 'A result is ready for your review.', kind: 'source-intake', bucket: 'needs-you', state: 'ready-for-review', stage: 'result-ready', runner: { kind: 'hermes', label: 'Hermes' }, privacy: 'public-safe', createdAt: '2026-08-07T10:00:00.000Z', updatedAt: '2026-08-07T10:00:00.000Z', currentMessage: 'A result is ready for your review.', availableActions: ['review', 'cancel'] }], counts: { 'needs-you': 1, active: 0, history: 0 }, nextCursor: null });
    }));
    render(<OverseerWorkView />);
    expect(await screen.findByText('Source intake')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review result' })).toBeInTheDocument());
  });
});
