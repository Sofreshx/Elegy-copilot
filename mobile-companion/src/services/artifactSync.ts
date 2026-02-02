/**
 * Service for syncing agent artifacts to repository and relay.
 * Handles branch creation, commits, PR creation, and relay metadata sync.
 */

export type SyncStrategy = 'relay-only' | 'commit-branch' | 'create-pr';

export interface ArtifactFile {
  path: string;
  content: string;
  type: 'markdown' | 'code' | 'log' | 'json' | 'other';
  size: number;
  encoding?: 'utf-8' | 'base64';
}

export interface ArtifactMetadata {
  sessionId: string;
  agentName: string;
  userId: string;
  createdAt: string;
  files: {
    path: string;
    size: number;
    type: string;
    sha?: string;
  }[];
  summary?: string;
  branchName?: string;
  prUrl?: string;
}

export interface SyncConfig {
  sessionId: string;
  agentName: string;
  strategy: SyncStrategy;
  files: ArtifactFile[];
  summary?: string;
  prTitle?: string;
  prBody?: string;
}

export interface SyncResult {
  success: boolean;
  branchName?: string;
  commitSha?: string;
  prUrl?: string;
  relayUrl?: string;
  error?: string;
  warnings?: string[];
}

// Configuration
const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'Sofreshx';
const REPO_NAME = 'instruction-engine';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const WARN_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Storage keys
const GITHUB_TOKEN_KEY = 'github_token';

class ArtifactSyncService {
  private webhookUrl: string | null = null;

  /**
   * Get the stored GitHub token
   */
  private getToken(): string | null {
    return localStorage.getItem(GITHUB_TOKEN_KEY);
  }

  /**
   * Set the relay webhook URL for artifact metadata
   */
  setWebhookUrl(url: string): void {
    this.webhookUrl = url;
  }

  /**
   * Sync artifacts based on configured strategy
   */
  async sync(config: SyncConfig): Promise<SyncResult> {
    const warnings: string[] = [];

    // Filter and validate files
    const validFiles = config.files.filter((file) => {
      if (file.size > MAX_FILE_SIZE) {
        warnings.push(`Skipped ${file.path}: exceeds 50MB limit`);
        return false;
      }
      if (file.size > WARN_FILE_SIZE) {
        warnings.push(`Large file ${file.path}: ${Math.round(file.size / 1024 / 1024)}MB`);
      }
      return true;
    });

    if (validFiles.length === 0) {
      return { success: false, error: 'No valid files to sync', warnings };
    }

    try {
      let result: SyncResult = { success: true, warnings };

      // Strategy-specific sync
      switch (config.strategy) {
        case 'relay-only':
          result = await this.syncToRelay(config, validFiles);
          break;

        case 'commit-branch':
          result = await this.syncToBranch(config, validFiles);
          break;

        case 'create-pr':
          result = await this.syncWithPR(config, validFiles);
          break;
      }

      result.warnings = [...(result.warnings || []), ...warnings];
      return result;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        warnings,
      };
    }
  }

  /**
   * Sync artifacts to relay only (no repository commit)
   */
  private async syncToRelay(
    config: SyncConfig,
    files: ArtifactFile[]
  ): Promise<SyncResult> {
    if (!this.webhookUrl) {
      return { success: false, error: 'Relay webhook URL not configured' };
    }

    const metadata: ArtifactMetadata = {
      sessionId: config.sessionId,
      agentName: config.agentName,
      userId: await this.getUserId(),
      createdAt: new Date().toISOString(),
      files: files.map((f) => ({
        path: f.path,
        size: f.size,
        type: f.type,
      })),
      summary: config.summary,
    };

    try {
      const response = await fetch(`${this.webhookUrl}/artifacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.getToken()}`,
        },
        body: JSON.stringify({
          metadata,
          files: files.map((f) => ({
            path: f.path,
            content: f.content,
            type: f.type,
          })),
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Relay sync failed: ${error}` };
      }

      const result = await response.json();
      return {
        success: true,
        relayUrl: result.url,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Relay sync failed',
      };
    }
  }

  /**
   * Sync artifacts to a feature branch
   */
  private async syncToBranch(
    config: SyncConfig,
    files: ArtifactFile[]
  ): Promise<SyncResult> {
    const token = this.getToken();
    if (!token) {
      return { success: false, error: 'GitHub token not configured' };
    }

    // Generate branch name
    const branchName = `agent/${config.agentName}/${config.sessionId.slice(0, 8)}`;

    try {
      // Get default branch SHA
      const defaultBranchSha = await this.getDefaultBranchSha(token);

      // Create branch
      await this.createBranch(token, branchName, defaultBranchSha);

      // Create commits for each file
      let currentSha = defaultBranchSha;
      for (const file of files) {
        currentSha = await this.commitFile(token, branchName, file, config, currentSha);
      }

      // Also sync to relay if configured
      if (this.webhookUrl) {
        await this.syncToRelay(config, files);
      }

      return {
        success: true,
        branchName,
        commitSha: currentSha,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Branch sync failed',
      };
    }
  }

  /**
   * Sync artifacts and create a pull request
   */
  private async syncWithPR(
    config: SyncConfig,
    files: ArtifactFile[]
  ): Promise<SyncResult> {
    // First sync to branch
    const branchResult = await this.syncToBranch(config, files);
    if (!branchResult.success || !branchResult.branchName) {
      return branchResult;
    }

    const token = this.getToken();
    if (!token) {
      return { success: false, error: 'GitHub token not configured' };
    }

    try {
      // Create PR
      const prTitle = config.prTitle || `[Agent] ${config.agentName}: ${config.summary || 'Session results'}`;
      const prBody = config.prBody || this.generatePRBody(config, files);

      const response = await fetch(`${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: prTitle,
          body: prBody,
          head: branchResult.branchName,
          base: 'main',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return {
          success: true, // Branch was created, just PR failed
          branchName: branchResult.branchName,
          commitSha: branchResult.commitSha,
          error: `PR creation failed: ${error}`,
        };
      }

      const pr = await response.json();
      return {
        success: true,
        branchName: branchResult.branchName,
        commitSha: branchResult.commitSha,
        prUrl: pr.html_url,
      };
    } catch (err) {
      return {
        success: true,
        branchName: branchResult.branchName,
        commitSha: branchResult.commitSha,
        error: err instanceof Error ? err.message : 'PR creation failed',
      };
    }
  }

  /**
   * Get SHA of default branch
   */
  private async getDefaultBranchSha(token: string): Promise<string> {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/main`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get default branch: ${response.status}`);
    }

    const data = await response.json();
    return data.object.sha;
  }

  /**
   * Create a new branch
   */
  private async createBranch(token: string, name: string, sha: string): Promise<void> {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: `refs/heads/${name}`,
          sha,
        }),
      }
    );

    if (!response.ok && response.status !== 422) {
      // 422 = branch already exists, which is fine
      throw new Error(`Failed to create branch: ${response.status}`);
    }
  }

  /**
   * Commit a file to a branch
   */
  private async commitFile(
    token: string,
    branch: string,
    file: ArtifactFile,
    config: SyncConfig,
    parentSha: string
  ): Promise<string> {
    // Create blob
    const blobResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: file.encoding === 'base64' ? file.content : btoa(unescape(encodeURIComponent(file.content))),
          encoding: 'base64',
        }),
      }
    );

    if (!blobResponse.ok) {
      throw new Error(`Failed to create blob for ${file.path}`);
    }

    const blob = await blobResponse.json();

    // Get current tree
    const treeResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${parentSha}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!treeResponse.ok) {
      throw new Error('Failed to get parent commit');
    }

    const parentCommit = await treeResponse.json();

    // Create tree with new file
    const newTreeResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          base_tree: parentCommit.tree.sha,
          tree: [
            {
              path: file.path,
              mode: '100644',
              type: 'blob',
              sha: blob.sha,
            },
          ],
        }),
      }
    );

    if (!newTreeResponse.ok) {
      throw new Error('Failed to create tree');
    }

    const newTree = await newTreeResponse.json();

    // Create commit
    const commitMessage = `[Agent] ${config.agentName}: Update ${file.path}\n\nSession: ${config.sessionId}`;
    const commitResponse = await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: commitMessage,
          tree: newTree.sha,
          parents: [parentSha],
        }),
      }
    );

    if (!commitResponse.ok) {
      throw new Error('Failed to create commit');
    }

    const newCommit = await commitResponse.json();

    // Update branch ref
    await fetch(
      `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${branch}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sha: newCommit.sha,
        }),
      }
    );

    return newCommit.sha;
  }

  /**
   * Generate PR body from config and files
   */
  private generatePRBody(config: SyncConfig, files: ArtifactFile[]): string {
    const fileList = files
      .map((f) => `- \`${f.path}\` (${f.type}, ${Math.round(f.size / 1024)}KB)`)
      .join('\n');

    return `## Agent Session Results

**Agent**: \`${config.agentName}\`
**Session**: \`${config.sessionId}\`
**Generated**: ${new Date().toISOString()}

### Summary
${config.summary || '_No summary provided_'}

### Files Changed
${fileList}

---
_This PR was automatically created by the mobile companion app._
`;
  }

  /**
   * Get current user ID
   */
  private async getUserId(): Promise<string> {
    const token = this.getToken();
    if (!token) return 'unknown';

    try {
      const response = await fetch(`${GITHUB_API_BASE}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) return 'unknown';
      const user = await response.json();
      return String(user.id);
    } catch {
      return 'unknown';
    }
  }

  /**
   * Detect file type from extension
   */
  static detectFileType(path: string): ArtifactFile['type'] {
    const ext = path.split('.').pop()?.toLowerCase();
    
    switch (ext) {
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
      case 'cs':
      case 'py':
      case 'go':
      case 'rs':
      case 'java':
        return 'code';
      case 'log':
      case 'txt':
        return 'log';
      case 'json':
        return 'json';
      default:
        return 'other';
    }
  }

  /**
   * Get suggested sync strategy for an agent
   */
  static getSuggestedStrategy(agentName: string): SyncStrategy {
    switch (agentName) {
      case 'debugger':
      case 'code-explorer':
      case 'code-reviewer':
        return 'relay-only';
      case 'executive2-planner':
        return 'commit-branch';
      case 'feature-creator':
      case 'test-runner':
        return 'create-pr';
      default:
        return 'relay-only';
    }
  }
}

export const artifactSync = new ArtifactSyncService();
