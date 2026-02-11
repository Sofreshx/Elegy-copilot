import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { getAuthService, type GitHubUser } from '../services/authService';
import { getRelayConnection, resetRelayConnection } from '../services/relayConnection';

export interface AuthContextValue {
  user: GitHubUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  configError: string | null;
  login: () => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  useEffect(() => {
    const initAuth = async () => {
      const authService = getAuthService();
      const state = authService.getState();
      setConfigError(authService.getConfigError());

      if (state.isAuthenticated && state.user) {
        setUser(state.user);
        
        // Connect to relay with a valid (possibly refreshed) token
        const validToken = await authService.getValidToken();
        if (validToken) {
          const relay = getRelayConnection();
          relay.setTokenRefresher(() => authService.getValidToken());
          relay.connect(validToken);
        }
      } else if (state.accessToken && !state.user) {
        // Have token but no user — user info should have been stored during
        // handleCallback(). Missing user means stale state; require re-login.
        authService.logout();
      }

      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = useCallback(() => {
    const authService = getAuthService();
    const error = authService.getConfigError();
    if (error) {
      setConfigError(error);
      return;
    }
    setConfigError(null);
    authService.login();
  }, []);

  const logout = useCallback(() => {
    const authService = getAuthService();
    authService.logout();
    resetRelayConnection();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    isLoading,
    configError,
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
