import { apiRequest } from './core';

// ── Types ──

export interface Note {
  id: string;
  title: string;
  content: string;
  theme: string | null;
  tags_json: string;
  created_at: string;
  updated_at: string;
  archived: number;
  repo_path: string | null;
  session_id: string | null;
  blocks?: NoteBlock[];
}

export interface NoteBlock {
  id: string;
  note_id: string;
  block_kind: string;
  position: number;
  body: string;
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteCreatePayload {
  title?: string;
  content: string;
  theme?: string;
  tags?: string[];
  repo_path?: string;
  session_id?: string;
}

export interface NoteUpdatePayload {
  id: string;
  title?: string;
  content: string;
  theme?: string;
  tags?: string[];
  archived?: boolean;
  repo_path?: string;
  session_id?: string;
}

export interface NoteListResponse {
  notes: Note[];
  count: number;
}

export interface NoteSearchResponse {
  results: Note[];
  query: string;
  count: number;
}

export interface NoteGetResponse extends Note {
  blocks: NoteBlock[];
}

export interface ExportPayload {
  version: number;
  exportedAt: string;
  notes: Note[];
}

export interface ExportMdResponse {
  format: 'markdown';
  files: { filename: string; content: string }[];
  count: number;
}

export interface ImportPayload {
  version: number;
  notes: Partial<Note>[];
}

export interface ImportResponse {
  imported: number;
  updated: number;
  errors?: { error: string; note: unknown }[];
  total: number;
}

export interface NoteSettingsEntry {
  key: string;
  value: string;
}

// ── API functions ──

export async function listNotes(params?: {
  theme?: string;
  tag?: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
  order?: string;
}): Promise<NoteListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.theme) searchParams.set('theme', params.theme);
  if (params?.tag) searchParams.set('tag', params.tag);
  if (params?.archived !== undefined) searchParams.set('archived', String(params.archived));
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));
  if (params?.order) searchParams.set('order', params.order);
  return apiRequest<NoteListResponse>(`/api/notes/list?${searchParams.toString()}`);
}

export async function getNote(id: string): Promise<NoteGetResponse> {
  return apiRequest<NoteGetResponse>(`/api/notes/get?id=${encodeURIComponent(id)}`);
}

export async function createNote(payload: NoteCreatePayload): Promise<Note> {
  return apiRequest<Note>('/api/notes/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateNote(payload: NoteUpdatePayload): Promise<Note> {
  return apiRequest<Note>('/api/notes/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteNote(id: string): Promise<{ deleted: boolean; id: string }> {
  return apiRequest<{ deleted: boolean; id: string }>(`/api/notes/delete?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function searchNotes(query: string, limit?: number): Promise<NoteSearchResponse> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (limit) params.set('limit', String(limit));
  return apiRequest<NoteSearchResponse>(`/api/notes/search?${params.toString()}`);
}

export async function exportNotes(format: 'json' | 'markdown' = 'json'): Promise<ExportPayload | ExportMdResponse> {
  return apiRequest<ExportPayload | ExportMdResponse>('/api/notes/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  });
}

export async function importNotes(payload: ImportPayload): Promise<ImportResponse> {
  return apiRequest<ImportResponse>('/api/notes/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function listNoteSettings(): Promise<{ settings: NoteSettingsEntry[] }> {
  return apiRequest<{ settings: NoteSettingsEntry[] }>('/api/notes/settings');
}

export async function getNoteSetting(key: string): Promise<{ key: string; value: unknown }> {
  return apiRequest<{ key: string; value: unknown }>(`/api/notes/settings/get?key=${encodeURIComponent(key)}`);
}

export async function setNoteSetting(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
  return apiRequest<{ key: string; value: unknown }>('/api/notes/settings/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

export async function deleteNoteSetting(key: string): Promise<{ deleted: boolean; key: string }> {
  return apiRequest<{ deleted: boolean; key: string }>(`/api/notes/settings/delete?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
}
