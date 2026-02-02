import { createContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { getAuthService, type GitHubUser } from '../services/authService';
import { getRelayConnection, resetRelayConnection } from '../services/relayConnection';

export interface AuthContextValue {
  user: GitHubUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
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

  useEffect(() => {
    const initAuth = async () => {
      const authService = getAuthService();
      const state = authService.getState();

      if (state.isAuthenticated && state.user) {
        setUser(state.user);
        
        // Connect to relay with auth token
        const relay = getRelayConnection();
        if (state.accessToken) {
          relay.connect(state.accessToken);
        }
      } else if (state.accessToken) {
        // Have token but no user, try to fetch
        const fetchedUser = await authService.fetchUser();
        if (fetchedUser) {
          setUser(fetchedUser);
          
          const relay = getRelayConnection();
          relay.connect(state.accessToken);
        }
      }

      // Check for OAuth callback
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const callbackState = url.searchParams.get('state');

      if (code && callbackState) {
        // Handle OAuth callback
        const success = await authService.handleCallback(code, callbackState);
        if (success) {
          setUser(authService.getUser());
          
          // Connect to relay
          const token = authService.getToken();
          if (token) {
            const relay = getRelayConnection();
            relay.connect(token);
          }
        }

        // Clean URL
        window.history.replaceState({}, '', '/');
      }

      setIsLoading(false);
    };

    initAuth();
  }, []);

  const login = useCallback(() => {
    const authService = getAuthService();
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
    login,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
