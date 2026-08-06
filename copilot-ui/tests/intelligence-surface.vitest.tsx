import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import IntelligenceSurfaceView from '../ui/src/views/Intelligence/IntelligenceSurfaceView';

describe('IntelligenceSurfaceView', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a stopped service with an explicit start action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'overseer',
      name: 'Overseer',
      status: 'stopped',
      reasonCode: 'no_state',
      consoleUrl: 'http://127.0.0.1:4173/dashboard/?embed=elegy',
      healthUrl: 'http://127.0.0.1:4173/api/health',
      prerequisites: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    render(<IntelligenceSurfaceView surfaceId="overseer" />);
    await waitFor(() => expect(screen.getByText('Overseer is stopped')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Start Overseer' })).toBeInTheDocument();
    expect(screen.queryByTitle('Overseer console')).not.toBeInTheDocument();
  });

  it('starts a stopped service and embeds its console when ready', async () => {
    const responses = [
      { status: 'stopped', reasonCode: 'no_state', checkedAt: '2026-08-06T18:00:00.000Z', consoleUrl: 'http://127.0.0.1:4173/dashboard/?embed=elegy', healthUrl: 'http://127.0.0.1:4173/api/health', prerequisites: [] },
      { status: 'ready', reasonCode: 'health_ready', checkedAt: '2026-08-06T18:00:01.000Z', consoleUrl: 'http://127.0.0.1:4173/dashboard/?embed=elegy', healthUrl: 'http://127.0.0.1:4173/api/health', prerequisites: [] },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify(responses[1]), { status: 200 });
      return new Response(JSON.stringify({ id: 'overseer', name: 'Overseer', ...responses.shift() }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<IntelligenceSurfaceView surfaceId="overseer" />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Overseer' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Start Overseer' }));
    await waitFor(() => expect(screen.getByTitle('Overseer console')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/intelligence-surfaces/overseer/start', expect.objectContaining({ method: 'POST' }));
    const startCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(startCall?.[1]?.body).toContain('observedAt');
  });
});
