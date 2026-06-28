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

export interface CollaborationInstructionLayerSummary {
  name: 'baseline' | 'preset' | 'appendix' | 'composed' | 'installed';
  available: boolean;
  bytes: number;
  lines: number;
  sha256: string | null;
  overBudget: boolean;
}

export interface CollaborationInstructionBudget {
  maxBytes: number;
  maxLines: number;
}

export interface CollaborationInstructionInspectorResponse {
  budgets: {
    baseline: CollaborationInstructionBudget;
    preset: CollaborationInstructionBudget;
    appendix: Record<string, CollaborationInstructionBudget>;
    composed: Record<string, CollaborationInstructionBudget>;
  };
  targets: Array<{
    id: 'copilot' | 'codex' | 'opencode' | 'claude-code' | 'antigravity';
    instructionFile: string;
    path: string;
    installed: boolean;
    managedBlock: boolean;
    drift: boolean;
    layers: {
      baseline: CollaborationInstructionLayerSummary;
      preset: CollaborationInstructionLayerSummary;
      appendix: CollaborationInstructionLayerSummary;
      composed: CollaborationInstructionLayerSummary;
      installed: CollaborationInstructionLayerSummary;
    };
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

export async function getCollaborationInstructions(): Promise<CollaborationInstructionInspectorResponse> {
  return apiRequest<CollaborationInstructionInspectorResponse>('/api/config/collaboration-profile/instructions');
}

export async function getCollaborationInstructionLayer(target: string, layer: string): Promise<string> {
  return apiRequest<string>('/api/config/collaboration-profile/instructions/view', {
    query: {
      target,
      layer,
    },
  });
}
