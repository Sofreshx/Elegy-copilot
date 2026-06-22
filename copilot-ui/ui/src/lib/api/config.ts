import { apiRequest } from './core';

export interface CollaborationProfileResponse {
  profile: {
    version: 1;
    enabled: boolean;
    presetId: 'constructive-coworker';
    customInstructions: string;
  };
  presets: Array<{
    id: string;
    label: string;
    description: string;
    content: string;
    isDefault: boolean;
  }>;
  targets: Array<{
    id: 'copilot' | 'codex' | 'opencode' | 'claude-code' | 'antigravity';
    path: string;
    installed: boolean;
  }>;
}

export interface CollaborationProfileSaveResponse {
  saved: true;
  profile: CollaborationProfileResponse['profile'];
  allApplied: boolean;
  results: Array<{
    id: string;
    path: string;
    status: 'applied' | 'unchanged' | 'not-installed' | 'error';
    error?: string;
  }>;
}

export async function getCollaborationProfile(): Promise<CollaborationProfileResponse> {
  return apiRequest<CollaborationProfileResponse>('/api/config/collaboration-profile');
}

export async function saveCollaborationProfile(update: {
  enabled?: boolean;
  presetId?: string;
  customInstructions?: string;
}): Promise<CollaborationProfileSaveResponse> {
  return apiRequest<CollaborationProfileSaveResponse>('/api/config/collaboration-profile', {
    method: 'PUT',
    body: JSON.stringify(update),
  });
}
