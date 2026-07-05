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

// ── Vault types ──

export interface VaultStatus {
  ok: boolean;
  vaultPath: string;
  vaultExists: boolean;
  fileCount: number;
  configured: boolean;
  gitEnabled: boolean;
  gdriveEnabled: boolean;
  gdriveFolderName: string;
  error?: string;
}

export interface GitStatus {
  ok: boolean;
  isClean?: boolean;
  changes?: { status: string; file: string }[];
  raw?: string;
  error?: string;
}

export interface GitDiff {
  ok: boolean;
  diff: string;
  error?: string;
}

export interface GitCommitResult {
  ok: boolean;
  committed?: boolean;
  message: string;
  output?: string;
  error?: string;
}

export interface GitLogEntry {
  hash: string;
  date: string;
  author: string;
  subject: string;
}

export interface GitLogResult {
  ok: boolean;
  entries: GitLogEntry[];
  error?: string;
}

export interface DriveSyncResult {
  ok: boolean;
  uploaded?: number;
  downloaded?: number;
  skipped?: number;
  conflicts?: number;
  conflictedFiles?: { file: string; conflictPath: string }[];
  failed?: number;
  failedFiles?: { file: string; error: string }[];
  needsSetup?: boolean;
  needsAuth?: boolean;
  message?: string;
  error?: string;
}

export interface DriveSyncStatus {
  ok: boolean;
  configured: boolean;
  vaultPath: string | null;
  vaultExists: boolean;
  gdriveEnabled: boolean;
  gdriveFolderName: string;
  rcloneInstalled: boolean;
  rclonePath: string | null;
  rcloneConfigured: boolean;
  authenticated: boolean;
  authenticatedEmail: string | null;
  driveFolderExists: boolean;
  lastSync?: { tokenExpiresAt?: string };
}

// ── Vault API functions ──

export async function getVaultStatus(): Promise<VaultStatus> {
  return apiRequest<VaultStatus>('/api/notes/vault/status');
}

export async function getGitStatus(): Promise<GitStatus> {
  return apiRequest<GitStatus>('/api/notes/git/status');
}

export async function getGitDiff(file?: string): Promise<GitDiff> {
  const params = file ? `?file=${encodeURIComponent(file)}` : '';
  return apiRequest<GitDiff>(`/api/notes/git/diff${params}`);
}

export async function gitCommit(message?: string): Promise<GitCommitResult> {
  return apiRequest<GitCommitResult>('/api/notes/git/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

export async function getGitLog(max?: number): Promise<GitLogResult> {
  const params = max ? `?max=${max}` : '';
  return apiRequest<GitLogResult>(`/api/notes/git/log${params}`);
}

export async function gitInit(): Promise<{ ok: boolean; message?: string; error?: string }> {
  return apiRequest<{ ok: boolean; message?: string; error?: string }>('/api/notes/git/init', {
    method: 'POST',
  });
}

export async function driveSyncPush(): Promise<DriveSyncResult> {
  return apiRequest<DriveSyncResult>('/api/notes/drive/push', {
    method: 'POST',
  });
}

export async function driveSyncPull(): Promise<DriveSyncResult> {
  return apiRequest<DriveSyncResult>('/api/notes/drive/pull', {
    method: 'POST',
  });
}

export async function getDriveSyncStatus(): Promise<DriveSyncStatus> {
  return apiRequest<DriveSyncStatus>('/api/notes/drive/status');
}

export async function driveAuth(): Promise<{
  ok: boolean;
  pending?: boolean;
  userCode?: string;
  verificationUrl?: string;
  needsSetup?: boolean;
  setupInstructions?: string;
  message?: string;
  error?: string;
}> {
  return apiRequest<{
    ok: boolean;
    pending?: boolean;
    userCode?: string;
    verificationUrl?: string;
    needsSetup?: boolean;
    setupInstructions?: string;
    message?: string;
    error?: string;
  }>('/api/notes/drive/auth', {
    method: 'POST',
  });
}

export async function checkDriveAuth(): Promise<{
  ok: boolean;
  completed?: boolean;
  pending?: boolean;
  slowDown?: boolean;
  expired?: boolean;
  message?: string;
  error?: string;
}> {
  return apiRequest<{
    ok: boolean;
    completed?: boolean;
    pending?: boolean;
    slowDown?: boolean;
    expired?: boolean;
    message?: string;
    error?: string;
  }>('/api/notes/drive/auth/status');
}

export async function cancelDriveAuth(): Promise<{ ok: boolean; message?: string }> {
  return apiRequest<{ ok: boolean; message?: string }>('/api/notes/drive/auth/cancel', {
    method: 'POST',
  });
}
