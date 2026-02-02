/**
 * GitHub Codespaces API service for remote agent execution.
 * Creates ephemeral Codespaces for agent sessions triggered from mobile.
 */

import { AgentName } from './workflowDispatch';

export interface CodespaceConfig {
  sessionId: string;
  agentName: AgentName;
  prompt: string;
  userId: string;
  webhookUrl: string;
}

export interface Codespace {
  id: number;
  name: string;
  state: CodespaceState;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
  machineType: string;
  idleTimeoutMinutes: number;
}

export type CodespaceState = 
  | 'Unknown'
  | 'Created'
  | 'Queued'
  | 'Provisioning'
  | 'Available'
  | 'Awaiting'
  | 'Unavailable'
  | 'Deleted'
  | 'Moved'
  | 'Shutdown'
  | 'Archived'
  | 'Starting'
  | 'ShuttingDown'
  | 'Failed'
  | 'Exporting'
  | 'Updating'
  | 'Rebuilding';

export interface CreateCodespaceResult {
  success: boolean;
  codespace?: Codespace;
  error?: string;
}

// Configuration
const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'Sofreshx';
const REPO_NAME = 'instruction-engine';
const DEFAULT_MACHINE = 'basicLinux32gb'; // 2-core, 8GB RAM
const IDLE_TIMEOUT_MINUTES = 30;

// Storage keys
const GITHUB_TOKEN_KEY = 'github_token';

class CodespacesService {
  /**
   * Get the stored GitHub token
   */
  private getToken(): string | null {
    return localStorage.getItem(GITHUB_TOKEN_KEY);
  }

  /**
   * Create a new Codespace for an agent session
   */
  async createForSession(config: CodespaceConfig): Promise<CreateCodespaceResult> {
    const token = this.getToken();
    if (!token) {
      return { success: false, error: 'GitHub token not configured' };
    }

    try {
      // Create Codespace with environment variables for the agent session
      const response = await fetch(`${GITHUB_API_BASE}/user/codespaces`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repository_id: await this.getRepoId(token),
          ref: 'main',
          machine: DEFAULT_MACHINE,
          display_name: `agent-session-${config.sessionId.slice(0, 8)}`,
          idle_timeout_minutes: IDLE_TIMEOUT_MINUTES,
          devcontainer_path: '.devcontainer/devcontainer.json',
          // Environment variables passed to Codespace
          // Note: These are set via secrets or runtime, not directly in create call
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Create failed: ${response.status} - ${error}` };
      }

      const data = await response.json();
      
      // Store session config for retrieval by Codespace
      // In production, this would be stored in a secure backend
      await this.storeSessionConfig(config);

      return {
        success: true,
        codespace: this.mapCodespace(data),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Get repository ID (needed for Codespace creation)
   */
  private async getRepoId(token: string): Promise<number> {
    const response = await fetch(`${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get repo: ${response.status}`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Store session config for Codespace to retrieve
   * In production, this would use a secure backend
   */
  private async storeSessionConfig(config: CodespaceConfig): Promise<void> {
    // For now, we rely on the workflow dispatch to pass these
    // In a full implementation, this would POST to a secure endpoint
    console.log('Session config stored:', config.sessionId);
  }

  /**
   * Stop a running Codespace
   */
  async stop(codespaceName: string): Promise<{ success: boolean; error?: string }> {
    const token = this.getToken();
    if (!token) {
      return { success: false, error: 'GitHub token not configured' };
    }

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/user/codespaces/${codespaceName}/stop`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Stop failed: ${response.status} - ${error}` };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a Codespace
   */
  async delete(codespaceName: string): Promise<{ success: boolean; error?: string }> {
    const token = this.getToken();
    if (!token) {
      return { success: false, error: 'GitHub token not configured' };
    }

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/user/codespaces/${codespaceName}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok && response.status !== 404) {
        const error = await response.text();
        return { success: false, error: `Delete failed: ${response.status} - ${error}` };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Get Codespace status
   */
  async getStatus(codespaceName: string): Promise<{ codespace?: Codespace; error?: string }> {
    const token = this.getToken();
    if (!token) {
      return { error: 'GitHub token not configured' };
    }

    try {
      const response = await fetch(
        `${GITHUB_API_BASE}/user/codespaces/${codespaceName}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          return { error: 'Codespace not found' };
        }
        const error = await response.text();
        return { error: `Get status failed: ${response.status} - ${error}` };
      }

      const data = await response.json();
      return { codespace: this.mapCodespace(data) };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * List user's Codespaces
   */
  async list(): Promise<{ codespaces: Codespace[]; error?: string }> {
    const token = this.getToken();
    if (!token) {
      return { codespaces: [], error: 'GitHub token not configured' };
    }

    try {
      const response = await fetch(`${GITHUB_API_BASE}/user/codespaces`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return { codespaces: [], error: `List failed: ${response.status} - ${error}` };
      }

      const data = await response.json();
      return {
        codespaces: data.codespaces.map((cs: GitHubCodespace) => this.mapCodespace(cs)),
      };
    } catch (err) {
      return {
        codespaces: [],
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * List Codespaces for instruction-engine repo
   */
  async listForRepo(): Promise<{ codespaces: Codespace[]; error?: string }> {
    const result = await this.list();
    if (result.error) return result;

    // Filter to only instruction-engine Codespaces
    const filtered = result.codespaces.filter(
      (cs) => cs.name.includes('instruction-engine') || cs.name.includes('agent-session')
    );

    return { codespaces: filtered };
  }

  /**
   * Map GitHub API response to Codespace interface
   */
  private mapCodespace(data: GitHubCodespace): Codespace {
    return {
      id: data.id,
      name: data.name,
      state: data.state as CodespaceState,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      webUrl: data.web_url,
      machineType: data.machine?.name || 'unknown',
      idleTimeoutMinutes: data.idle_timeout_minutes || IDLE_TIMEOUT_MINUTES,
    };
  }
}

interface GitHubCodespace {
  id: number;
  name: string;
  state: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  machine?: { name: string };
  idle_timeout_minutes?: number;
}

export const codespacesService = new CodespacesService();
