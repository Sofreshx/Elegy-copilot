import { useEffect, useCallback } from 'react';
import { Button } from '../../components';
import { useStoreValue } from '../../lib/store';
import { repositoriesStore } from './repositoriesStore';

interface GitHubAuthBannerProps {
  repoPath: string | null;
}

export default function GitHubAuthBanner({ repoPath }: GitHubAuthBannerProps) {
  const state = useStoreValue(repositoriesStore);

  useEffect(() => {
    if (repoPath) {
      void repositoriesStore.checkGitHubAuth(repoPath);
    }
  }, [repoPath]);

  const handleLogin = useCallback(() => {
    void repositoriesStore.loginGitHub();
  }, []);

  if (!repoPath) return null;

  if (state.githubAuthenticated) return null;

  if (state.githubAuthChecking) {
    return (
      <div className="github-auth-banner github-auth-banner-checking" data-testid="github-auth-checking">
        Checking GitHub authentication\u2026
      </div>
    );
  }

  return (
    <div className="github-auth-banner github-auth-banner-unauthenticated" data-testid="github-auth-unauthenticated">
      <span>
        \u26A0\uFE0F GitHub CLI not authenticated. Push, pull, and PR creation require authentication.
      </span>
      <Button variant="secondary" size="sm" testId="github-auth-login" onClick={handleLogin}>
        Connect GitHub
      </Button>
    </div>
  );
}
