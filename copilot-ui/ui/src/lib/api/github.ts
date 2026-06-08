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

export function installGitHubCli(baseUrl?: string): Promise<{ installed: boolean; method?: string; version?: string | null; error?: string }> {
  return apiRequest<{ installed: boolean; method?: string; version?: string | null; error?: string }>('/api/git/github-install', {
    baseUrl,
    method: 'POST',
  });
}
