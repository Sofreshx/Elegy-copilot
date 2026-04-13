import { apiRequest } from './core';

// --- Types ---

export interface HookRule {
  id: string;
  name: string;
  category: 'safety' | 'anti-hang' | 'telemetry';
  description: string;
  enabled: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface HookRulesResponse {
  schemaVersion: number;
  rules: HookRule[];
}

export interface HookRuleTogglePayload {
  enabled: boolean;
}

export interface HookRuleBatchPayload {
  updates: Array<{ id: string; enabled: boolean }>;
}

// --- API functions ---

export function getHookRules(baseUrl?: string): Promise<HookRulesResponse> {
  return apiRequest<HookRulesResponse>('/api/hooks/rules', { baseUrl });
}

export function toggleHookRule(
  ruleId: string,
  enabled: boolean,
  baseUrl?: string,
): Promise<HookRule> {
  return apiRequest<HookRule>(`/api/hooks/rules/${ruleId}`, {
    baseUrl,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled } satisfies HookRuleTogglePayload),
  });
}

export function batchToggleHookRules(
  updates: Array<{ id: string; enabled: boolean }>,
  baseUrl?: string,
): Promise<HookRulesResponse> {
  return apiRequest<HookRulesResponse>('/api/hooks/rules/batch', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates } satisfies HookRuleBatchPayload),
  });
}
