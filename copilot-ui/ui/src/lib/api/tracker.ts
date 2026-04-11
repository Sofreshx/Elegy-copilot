import type {
  SyncedNoteSourceDeleteResponse,
  SyncedNoteSourceLocator,
  SyncedNoteSourceRecord,
  TrackerPermissionsResponse,
  TrackerSessionsResponse,
} from '../types';
import { apiRequest } from './core';

export function getTrackerPermissions(baseUrl?: string): Promise<TrackerPermissionsResponse> {
  return apiRequest<TrackerPermissionsResponse>('/api/tracker/permissions', { baseUrl });
}

export function approveTrackerPermission(permissionId: string, baseUrl?: string): Promise<unknown> {
  return apiRequest<unknown>(`/api/tracker/permissions/${encodeURIComponent(permissionId)}/approve`, {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export function denyTrackerPermission(permissionId: string, baseUrl?: string): Promise<unknown> {
  return apiRequest<unknown>(`/api/tracker/permissions/${encodeURIComponent(permissionId)}/deny`, {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export function getTrackerSessions(baseUrl?: string): Promise<TrackerSessionsResponse | unknown[]> {
  return apiRequest<TrackerSessionsResponse | unknown[]>('/api/tracker/sessions', { baseUrl });
}

export function listTrackerSyncedNoteSources(baseUrl?: string): Promise<SyncedNoteSourceRecord[]> {
  return apiRequest<SyncedNoteSourceRecord[]>('/api/tracker/synced-notes/sources', { baseUrl });
}

export function createTrackerSyncedNoteSource(
  payload: SyncedNoteSourceLocator,
  baseUrl?: string,
): Promise<SyncedNoteSourceRecord> {
  return apiRequest<SyncedNoteSourceRecord>('/api/tracker/synced-notes/sources', {
    baseUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export function updateTrackerSyncedNoteSource(
  sourceId: string,
  payload: SyncedNoteSourceLocator,
  baseUrl?: string,
): Promise<SyncedNoteSourceRecord> {
  return apiRequest<SyncedNoteSourceRecord>(
    `/api/tracker/synced-notes/sources/${encodeURIComponent(sourceId)}`,
    {
      baseUrl,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );
}

export function deleteTrackerSyncedNoteSource(
  sourceId: string,
  baseUrl?: string,
): Promise<SyncedNoteSourceDeleteResponse> {
  return apiRequest<SyncedNoteSourceDeleteResponse>(
    `/api/tracker/synced-notes/sources/${encodeURIComponent(sourceId)}`,
    {
      baseUrl,
      method: 'DELETE',
    }
  );
}
