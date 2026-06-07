import type { GitHubStatusResponse } from '../types';
import { apiRequest } from './core';

export function getGitHubStatus(baseUrl?: string): Promise<GitHubStatusResponse> {
  return apiRequest<GitHubStatusResponse>('/api/git/github-status', { baseUrl });
}

export function loginGitHub(baseUrl?: string): Promise<{ authenticated: boolean; error?: string }> {
  return apiRequest<{ authenticated: boolean; error?: string }>('/api/git/auth/login', {
    baseUrl,
    method: 'POST',
  });
}
