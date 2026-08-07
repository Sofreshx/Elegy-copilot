import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OverseerShell from '../ui/src/views/Overseer/OverseerShell';

const briefing = {
  format: 'overseer.topic/v1', topic: 'briefing', freshness: { status: 'fresh', observedAt: '2026-08-07T10:00:00.000Z' }, source: { status: 'ready', label: 'Observed by Overseer' },
  state: { activeProjects: [{ id: 'project:one', name: 'Project One', state: 'blocked', summary: 'Needs proof', blocker: 'Access' }], taskPressure: { open: 2, needsReview: 1 }, activeRuns: [], needsYou: [], recentObservedChanges: [] },
  projection: { kind: 'interpretation', recommendation: { title: 'Close the evidence gate', summary: 'One proof is missing.', nextAction: 'Collect it' }, rankedConcerns: [], proposedFollowUps: [], confidence: 'medium' },
  actions: [{ key: 'create-task', label: 'Create task', description: 'Turn an outcome into a task.', operation: 'todo-create', enabled: true }],
};

function jsonResponse(body: unknown, status = 200) { return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }); }

describe('topic-centered Overseer shell', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/overseer/briefing/v1/summary')) return jsonResponse(briefing);
      if (url.includes('/api/overseer/runs/v1/items')) return jsonResponse({ format: 'overseer.runs/v1', items: [], counts: { 'needs-you': 0, active: 0, history: 0 } });
      return jsonResponse({ format: 'overseer.topic/v1', topic: 'projects', freshness: { status: 'missing' }, source: { status: 'missing', label: 'No observation' }, state: {}, projection: { kind: 'interpretation' }, actions: [] });
    }));
  });

  it('opens on Briefing and keeps the State / Projection / Actions anatomy visible', async () => {
    render(<OverseerShell />);
    expect(await screen.findByTestId('overseer-briefing-view')).toBeInTheDocument();
    expect(await screen.findByText('Close the evidence gate')).toBeInTheDocument();
    expect(screen.getByText('What is moving')).toBeInTheDocument();
    expect(screen.getByText('What you can ask Overseer to do')).toBeInTheDocument();
  });

  it('switches to Projects and exposes the global Runs drawer', async () => {
    render(<OverseerShell />);
    fireEvent.click(screen.getByTestId('overseer-section-projects'));
    expect(await screen.findByTestId('overseer-projects-view')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Runs/ }));
    expect(await screen.findByTestId('overseer-runs-drawer')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Each row is one bounded operation. Hermes is not a chat session.')).toBeInTheDocument());
  });

  it('opens contextual companion chat and sends the active topic', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/overseer/briefing/v1/summary')) return jsonResponse(briefing);
      if (url.includes('/api/overseer/chat/v1/conversations') && init?.method === 'POST' && !url.includes('/turns')) return jsonResponse({ conversation: { id: 'companion:one' } }, 201);
      if (url.includes('/api/overseer/chat/v1/conversations/companion%3Aone/turns')) return jsonResponse({ turn: { id: 'turn:one', role: 'assistant', text: 'Briefing context is ready.', topic: 'briefing', mentions: [] } }, 201);
      if (url.includes('/api/overseer/runs/v1/items')) return jsonResponse({ format: 'overseer.runs/v1', items: [], counts: { 'needs-you': 0, active: 0, history: 0 } });
      return jsonResponse({ format: 'overseer.topic/v1', topic: 'briefing', freshness: { status: 'fresh' }, source: { status: 'ready', label: 'Observed' }, state: {}, projection: {}, actions: [] });
    }));
    render(<OverseerShell />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask companion/ }));
    expect(await screen.findByTestId('overseer-companion-chat')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Ask about this context/), { target: { value: 'What matters now?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Briefing context is ready.')).toBeInTheDocument();
  });
});
