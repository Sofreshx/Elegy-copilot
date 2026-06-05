import { apiRequest } from './core';

export interface ProviderUsageResponse {
  opencode: {
    totalRequests: number;
    sampledRequests: number;
    logFiles: number;
    providers: Array<{ name: string; count: number }>;
    topModels: Array<{ name: string; count: number; provider: string }>;
    topAgents: Array<{ name: string; count: number }>;
  };
  codex: {
    sessionCount: number;
    recentSessions: Array<{ id: string; updatedAt: string | null; name: string | null }>;
  };
  generatedAt: string;
}

export async function getProviderUsage(baseUrl?: string): Promise<ProviderUsageResponse> {
  return apiRequest<ProviderUsageResponse>('/api/stats/provider-usage', { baseUrl });
}
