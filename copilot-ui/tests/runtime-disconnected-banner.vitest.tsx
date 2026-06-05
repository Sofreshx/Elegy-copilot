import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import RuntimeDisconnectedBanner from '../ui/src/components/RuntimeDisconnectedBanner';
import { createRuntimeHealthStore } from '../ui/src/stores/runtimeHealthStore';

interface FakeResponseInit {
  ok?: boolean;
  status?: number;
}

function createFakeFetch(impl: (url: string) => Promise<FakeResponseInit> | FakeResponseInit) {
  return vi.fn(async (_input: RequestInfo | URL) => {
    const url = typeof _input === 'string' ? _input : _input.toString();
    const init = await impl(url);
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => ({}),
    } as Response;
  });
}

describe('RuntimeDisconnectedBanner', () => {
  it('renders nothing when the store is connected', () => {
    const store = createRuntimeHealthStore({ fetchImpl: createFakeFetch(async () => ({ ok: true })) });
    const view = render(<RuntimeDisconnectedBanner store={store} />);
    expect(view.queryByTestId('runtime-disconnected-banner')).toBeNull();
    view.unmount();
    store.reset();
  });

  it('renders the banner with the last error code and endpoint when disconnected', () => {
    const store = createRuntimeHealthStore({ fetchImpl: createFakeFetch(async () => ({ ok: true })) });
    store.recordConnectionFailure('/api/foo', 'connection_refused');
    store.recordConnectionFailure('/api/bar', 'aborted');

    const view = render(<RuntimeDisconnectedBanner store={store} />);
    const banner = screen.getByTestId('runtime-disconnected-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute('data-error-code')).toBe('aborted');
    expect(banner.textContent).toContain('Backend unavailable');
    expect(banner.textContent).toContain('~/.copilot/logs/');
    expect(banner.textContent).toContain('aborted');
    expect(banner.textContent).toContain('/api/bar');

    view.unmount();
    store.reset();
  });

  it('triggers a fresh health check when the retry button is clicked', async () => {
    let healthCalls = 0;
    const fetchImpl = createFakeFetch(async (url) => {
      if (url === '/api/health') {
        healthCalls += 1;
        return { ok: true };
      }
      throw new Error('should not hit non-health endpoint');
    });
    const store = createRuntimeHealthStore({ fetchImpl, healthEndpoint: '/api/health' });

    store.recordConnectionFailure('/api/foo', 'connection_refused');
    store.recordConnectionFailure('/api/foo', 'connection_refused');

    const view = render(<RuntimeDisconnectedBanner store={store} />);
    const retry = screen.getByTestId('runtime-disconnected-banner-retry');
    fireEvent.click(retry);

    await waitFor(() => {
      expect(healthCalls).toBeGreaterThanOrEqual(1);
    });

    view.unmount();
    store.reset();
  });
});
