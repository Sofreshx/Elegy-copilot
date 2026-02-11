import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { usePermissions } from './hooks/usePermissions';
import BottomNav from './components/BottomNav';
import PermissionModal from './components/permissions/PermissionModal';
import Dashboard from './pages/Dashboard';
import Sessions from './pages/Sessions';
import Ideas from './pages/Ideas';
import AiChat from './pages/AiChat';
import Settings from './pages/Settings';
import AuthCallback from './pages/AuthCallback';
import './App.css';

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  // Auth callback must be reachable before the user is authenticated
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={
        isAuthenticated ? <AuthenticatedApp /> : (
          <div className="app-login">
            <LoginPrompt />
          </div>
        )
      } />
    </Routes>
  );
}

function AuthenticatedApp() {
  const { currentRequest, pendingCount, approve, deny, approveAll, denyAll } = usePermissions();

  return (
    <div className="app">
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/ideas" element={<Ideas />} />
          <Route path="/chat" element={<AiChat />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <BottomNav />
      
      {currentRequest && (
        <PermissionModal
          request={currentRequest}
          onApprove={() => approve(currentRequest.id)}
          onDeny={() => deny(currentRequest.id)}
          pendingCount={pendingCount}
          onApproveAll={approveAll}
          onDenyAll={denyAll}
        />
      )}
    </div>
  );
}

function LoginPrompt() {
  const { login, configError } = useAuth();

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Instruction Engine</h1>
        <p>Mobile companion for AI-powered development</p>
        {configError && <p className="login-error">{configError}</p>}
        <button onClick={login} className="login-button" disabled={!!configError}>
          <GitHubIcon />
          Sign in with GitHub
        </button>
      </div>
    </div>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export default App;
