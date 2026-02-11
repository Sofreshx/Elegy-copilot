import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAuthService } from '../services/authService';
import { getRelayConnection } from '../services/relayConnection';

type CallbackState = 'loading' | 'success' | 'error';

export default function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const oauthState = searchParams.get('state');

    if (!code || !oauthState) {
      // No OAuth params — redirect to root
      navigate('/', { replace: true });
      return;
    }

    let cancelled = false;

    const exchange = async () => {
      const authService = getAuthService();
      const result = await authService.handleCallback(code, oauthState);

      if (cancelled) return;

      if (result.success) {
        // Connect relay with auto-refresh wired up
        const validToken = await authService.getValidToken();
        if (validToken) {
          const relay = getRelayConnection();
          relay.setTokenRefresher(() => authService.getValidToken());
          relay.connect(validToken);
        }

        setState('success');
        // Brief pause so the user sees the success state before redirect
        setTimeout(() => {
          if (!cancelled) navigate('/dashboard', { replace: true });
        }, 400);
      } else {
        setErrorMessage(result.error ?? 'Authentication failed');
        setState('error');
      }
    };

    void exchange();

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  const handleRetry = () => {
    const authService = getAuthService();
    authService.login();
  };

  if (state === 'loading') {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Signing you in…</p>
      </div>
    );
  }

  if (state === 'success') {
    return (
      <div className="app-loading">
        <p>Authenticated! Redirecting…</p>
      </div>
    );
  }

  // error state
  return (
    <div className="app-login">
      <div className="login-container">
        <div className="login-card">
          <h1>Sign-in failed</h1>
          <p className="login-error">{errorMessage}</p>
          <button onClick={handleRetry} className="login-button">
            Try Again
          </button>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="login-button"
            style={{ marginTop: 8, background: 'transparent', border: '1px solid currentColor' }}
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
