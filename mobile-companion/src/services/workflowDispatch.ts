/**
 * Service for dispatching GitHub Actions workflows for remote agent sessions.
 * Uses GitHub's workflow_dispatch API to trigger the remote-agent.yml workflow.
 */

export type AgentName = 
  | 'executive2-planner'
  | 'debugger'
  | 'feature-creator'
  | 'code-reviewer'
  | 'test-runner'
  | 'code-explorer';

export type CommandType = 'start' | 'stop' | 'status';

export interface WorkflowDispatchParams {
  command: CommandType;
  agentName: AgentName;
  prompt?: string;
  sessionId: string;
}

export interface WorkflowDispatchResult {
  success: boolean;
  workflowRunId?: string;
  error?: string;
}

export interface WorkflowStatus {
  workflowRunId: string;
  sessionId: string;
  userId: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
  logsUrl?: string;
  timestamp: string;
}

// Configuration
const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'Sofreshx';
const REPO_NAME = 'instruction-engine';
const WORKFLOW_FILE = 'remote-agent.yml';

// Storage keys
const GITHUB_TOKEN_KEY = 'github_token';

class WorkflowDispatchService {
  private webhookUrl: string | null = null;
  private statusCallbacks: Map<string, (status: WorkflowStatus) => void> = new Map();

  /**
   * Set the GitHub token for API authentication
   */
  setGitHubToken(token: string): void {
    localStorage.setItem(GITHUB_TOKEN_KEY, token);
  }

  /**
   * Get the stored GitHub token
   */
  getGitHubToken(): string | null {
    return localStorage.getItem(GITHUB_TOKEN_KEY);
  }

  /**
   * Check if a GitHub token is configured
   */
  hasGitHubToken(): boolean {
    return !!this.getGitHubToken();
  }

  /**
   * Clear the stored GitHub token
   */
  clearGitHubToken(): void {
    localStorage.removeItem(GITHUB_TOKEN_KEY);
  }

  /**
   * Set the webhook URL for status updates (provided by relay service)
   */
  setWebhookUrl(url: string): void {
    this.webhookUrl = url;
  }

  /**
   * Subscribe to status updates for a session
   */
  onStatusUpdate(sessionId: string, callback: (status: WorkflowStatus) => void): () => void {
    this.statusCallbacks.set(sessionId, callback);
    return () => {
      this.statusCallbacks.delete(sessionId);
    };
  }

  /**
   * Handle incoming status update from relay
   */
  handleStatusUpdate(status: WorkflowStatus): void {
    const callback = this.statusCallbacks.get(status.sessionId);
    if (callback) {
      callback(status);
    }
  }

  /**
   * Dispatch a workflow to start/stop/status an agent session
   */
  async dispatch(params: WorkflowDispatchParams): Promise<WorkflowDispatchResult> {
    const token = this.getGitHubToken();
    if (!token) {
      return { success: false, error: 'GitHub token not configured' };
    }

    if (!this.webhookUrl) {
      return { success: false, error: 'Webhook URL not configured' };
    }

    // Validate prompt length
    if (params.prompt && params.prompt.length > 4000) {
      return { success: false, error: 'Prompt exceeds maximum length (4000 characters)' };
    }

    try {
      // Get user ID from token
      const userResponse = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!userResponse.ok) {
        return { success: false, error: 'Invalid GitHub token' };
      }

      const user = await userResponse.json();
      const userId = String(user.id);

      // Dispatch the workflow
      const dispatchUrl = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

      const response = await fetch(dispatchUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            command: params.command,
            agent_name: params.agentName,
            prompt: params.prompt || '',
            session_id: params.sessionId,
            webhook_url: this.webhookUrl,
            user_id: userId,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Dispatch failed: ${response.status} - ${error}` };
      }

      // GitHub doesn't return the run ID directly, but we can query for it
      // For now, return success and let status updates come via webhook
      return { success: true };
    } catch (err) {
      return { 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error during dispatch' 
      };
    }
  }

  /**
   * Start an agent session remotely
   */
  async startSession(agentName: AgentName, prompt: string): Promise<WorkflowDispatchResult> {
    const sessionId = crypto.randomUUID();
    return this.dispatch({
      command: 'start',
      agentName,
      prompt,
      sessionId,
    });
  }

  /**
   * Stop a running agent session
   */
  async stopSession(sessionId: string, agentName: AgentName): Promise<WorkflowDispatchResult> {
    return this.dispatch({
      command: 'stop',
      agentName,
      sessionId,
    });
  }

  /**
   * Get status of an agent session
   */
  async getSessionStatus(sessionId: string, agentName: AgentName): Promise<WorkflowDispatchResult> {
    return this.dispatch({
      command: 'status',
      agentName,
      sessionId,
    });
  }

  /**
   * List recent workflow runs (for debugging/admin)
   */
  async listRecentRuns(limit = 10): Promise<{ runs: WorkflowRun[]; error?: string }> {
    const token = this.getGitHubToken();
    if (!token) {
      return { runs: [], error: 'GitHub token not configured' };
    }

    try {
      const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${limit}`;
      
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        return { runs: [], error: `Failed to fetch runs: ${response.status}` };
      }

      const data = await response.json();
      return {
        runs: data.workflow_runs.map((run: GitHubWorkflowRun) => ({
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          createdAt: run.created_at,
          updatedAt: run.updated_at,
          logsUrl: run.html_url,
        })),
      };
    } catch (err) {
      return { 
        runs: [], 
        error: err instanceof Error ? err.message : 'Unknown error' 
      };
    }
  }
}

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  logsUrl: string;
}

interface GitHubWorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export const workflowDispatch = new WorkflowDispatchService();
