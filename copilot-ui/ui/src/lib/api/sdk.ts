import type {
  SdkHealthResponse,
  SdkModelsResponse,
  SdkSessionSummary,
  SdkSessionsResponse,
  SdkSendResponse,
} from '../types';
import {
  apiRequest,
  createUrl,
  normalizeSdkHealthResponse,
  normalizeSdkSessionSummary,
  normalizeSdkSessionsResponse,
  asRecord,
  asTrimmedString,
} from './core';
import type {
  SdkCreateSessionPayload,
  SdkSendPayload,
} from './core';

export async function getSdkHealth(baseUrl?: string): Promise<SdkHealthResponse> {
  const payload = await apiRequest<unknown>('/api/sdk/health', { baseUrl });
  return normalizeSdkHealthResponse(payload);
}

export async function createSdkSession(
  payload: SdkCreateSessionPayload = {},
  baseUrl?: string
): Promise<SdkSessionSummary> {
  const response = await apiRequest<unknown>('/api/sdk/session', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const normalized = normalizeSdkSessionSummary(response);
  if (!normalized) {
    throw new Error('invalid_sdk_session_response');
  }

  return normalized;
}

export async function listSdkSessions(baseUrl?: string): Promise<SdkSessionsResponse> {
  const payload = await apiRequest<unknown>('/api/sdk/sessions', { baseUrl });
  return normalizeSdkSessionsResponse(payload);
}

export function deleteSdkSession(
  sessionId: string,
  baseUrl?: string
): Promise<{ ok?: boolean; sessionId?: string; error?: string; [key: string]: unknown }> {
  return apiRequest<{ ok?: boolean; sessionId?: string; error?: string; [key: string]: unknown }>(
    `/api/sdk/session/${encodeURIComponent(sessionId)}`,
    {
      baseUrl,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );
}

export async function sendSdkMessage(payload: SdkSendPayload, baseUrl?: string): Promise<SdkSendResponse> {
  const response = await apiRequest<unknown>('/api/sdk/send', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const record = asRecord(response);
  return {
    messageId: asTrimmedString(record.messageId),
  };
}

export function createSdkStreamUrl(sessionId: string, baseUrl?: string): string {
  const endpoint = `/api/sdk/stream/${encodeURIComponent(sessionId)}`;
  if (baseUrl) {
    return createUrl(endpoint, baseUrl).toString();
  }

  if (typeof window !== 'undefined') {
    return endpoint;
  }

  return createUrl(endpoint, 'http://127.0.0.1').toString();
}

export async function listSdkModels(baseUrl?: string): Promise<SdkModelsResponse> {
  return apiRequest<SdkModelsResponse>('/api/sdk/models', { baseUrl });
}

export async function answerSdkQuestion(
  payload: { sessionId: string; toolCallId: string; answer: string },
  baseUrl?: string
): Promise<{ answered?: boolean; toolCallId?: string }> {
  return apiRequest<{ answered?: boolean; toolCallId?: string }>('/api/sdk/answer', {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function enableRemoteSession(
  sessionId: string,
  baseUrl?: string
): Promise<{ sessionId?: string; messageId?: string; alreadyRemote?: boolean; remoteUrl?: string; experimental?: boolean }> {
  return apiRequest(`/api/sdk/session/${encodeURIComponent(sessionId)}/enable-remote`, {
    baseUrl,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function getRemotePreference(baseUrl?: string): Promise<{ enabled: boolean }> {
  return apiRequest<{ enabled: boolean }>('/api/config/remote-sessions', { baseUrl });
}

export async function setRemotePreference(
  enabled: boolean,
  baseUrl?: string
): Promise<{ enabled: boolean; warning?: string }> {
  return apiRequest<{ enabled: boolean; warning?: string }>('/api/config/remote-sessions', {
    baseUrl,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}
