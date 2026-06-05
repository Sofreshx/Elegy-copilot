import { useCallback, useState } from 'react';

import { useStoreValue } from '../lib/store';
import { runtimeHealthStore, type RuntimeHealthStore } from '../stores/runtimeHealthStore';

interface RuntimeDisconnectedBannerProps {
  testId?: string;
  store?: RuntimeHealthStore;
}

export default function RuntimeDisconnectedBanner({
  testId = 'runtime-disconnected-banner',
  store = runtimeHealthStore,
}: RuntimeDisconnectedBannerProps) {
  const state = useStoreValue(store);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = useCallback(() => {
    if (retrying) return;
    setRetrying(true);
    void store
      .runHealthCheck()
      .finally(() => {
        setRetrying(false);
      });
  }, [retrying, store]);

  if (!state.disconnected) {
    return null;
  }

  const lastErrorLabel = state.lastErrorCode
    ? `Last failure: ${state.lastErrorCode}${state.lastFailureEndpoint ? ` (${state.lastFailureEndpoint})` : ''}`
    : null;

  return (
    <div
      className="runtime-disconnected-banner"
      role="alert"
      data-testid={testId}
      data-error-code={state.lastErrorCode ?? undefined}
    >
      <div className="runtime-disconnected-banner__body">
        <span className="runtime-disconnected-banner__icon" aria-hidden="true">
          ⚠
        </span>
        <div className="runtime-disconnected-banner__copy">
          <span className="runtime-disconnected-banner__title">Backend unavailable</span>
          <span className="runtime-disconnected-banner__message">
            Repeated requests have failed. The most recent runtime diagnostics live under{' '}
            <code>~/.copilot/logs/</code> in your home directory.
          </span>
          {lastErrorLabel && (
            <span className="runtime-disconnected-banner__detail">{lastErrorLabel}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        className="runtime-disconnected-banner__retry"
        onClick={handleRetry}
        disabled={retrying}
        data-testid={`${testId}-retry`}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
