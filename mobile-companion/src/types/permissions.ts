/**
 * Permission request types and constants.
 */

export type PermissionType = 
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'terminal_command'
  | 'dangerous_operation'
  | 'external_request';

export type PermissionStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface PermissionRequest {
  id: string;
  type: PermissionType;
  agentName: string;
  clientId: string;
  sessionId: string;
  description: string;
  details: {
    filePath?: string;
    command?: string;
    reason?: string;
    operation?: string;
  };
  timestamp: number;
  expiresAt: number;
  status: PermissionStatus;
}

export interface PermissionResponse {
  requestId: string;
  approved: boolean;
  respondedAt: number;
}

// Permission timeout in milliseconds (2 minutes)
export const PERMISSION_TIMEOUT_MS = 2 * 60 * 1000;

// Permission type labels and icons
export const PERMISSION_LABELS: Record<PermissionType, { label: string; icon: string; severity: 'low' | 'medium' | 'high' }> = {
  file_edit: { label: 'Edit File', icon: '📝', severity: 'medium' },
  file_create: { label: 'Create File', icon: '📄', severity: 'low' },
  file_delete: { label: 'Delete File', icon: '🗑️', severity: 'high' },
  terminal_command: { label: 'Run Command', icon: '⌨️', severity: 'high' },
  dangerous_operation: { label: 'Dangerous Operation', icon: '⚠️', severity: 'high' },
  external_request: { label: 'External Request', icon: '🌐', severity: 'medium' },
};
