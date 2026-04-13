import { useStoreValue } from '../../lib/store';
import { enableRemoteSession } from '../../lib/api/sdk';
import { sessionDetailStore } from './sessionDetailStore';
import type { SessionDetailState } from './sessionDetailStore';
import { notificationStore } from '../../stores/notificationStore';
import { useState } from 'react';

export default function RemoteSessionBanner() {
  const { sessionId, isRemote, remoteUrl, remoteSessionId, sdkStreamStatus } =
    useStoreValue<SessionDetailState>(sessionDetailStore);
  const [enabling, setEnabling] = useState(false);

  const isActive = sdkStreamStatus === 'connected' || sdkStreamStatus === 'connecting' || sdkStreamStatus === 'reconnecting';

  if (!sessionId || !isActive) return null;

  async function handleEnableRemote() {
    if (!sessionId) return;
    setEnabling(true);
    try {
      await enableRemoteSession(sessionId);
      notificationStore.info('Remote session requested', {
        message: 'Sending /remote command — this is experimental and may require session restart.',
        duration: 5000,
      });
    } catch (err) {
      notificationStore.error('Failed to enable remote', {
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setEnabling(false);
    }
  }

  if (!isRemote) {
    return (
      <div className="remote-session-banner remote-session-banner--inactive" data-testid="remote-session-banner-inactive">
        <span className="remote-session-banner-label">🌐 Remote Access</span>
        <button
          className="remote-session-banner-enable"
          data-testid="remote-session-enable-button"
          onClick={handleEnableRemote}
          disabled={enabling}
        >
          {enabling ? 'Enabling…' : 'Enable Remote (Experimental)'}
        </button>
      </div>
    );
  }

  return (
    <div className="remote-session-banner remote-session-banner--active" data-testid="remote-session-banner-active">
      <span className="remote-session-banner-badge" data-testid="remote-session-badge">🌐 Remote Active</span>
      {remoteUrl && (
        <a
          className="remote-session-banner-url"
          href={remoteUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="remote-session-url"
          title="Open remote session on GitHub"
        >
          {remoteUrl}
        </a>
      )}
      {remoteSessionId && (
        <span className="remote-session-banner-id" data-testid="remote-session-id">
          Task: {remoteSessionId}
        </span>
      )}
    </div>
  );
}
