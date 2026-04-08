import { spawn, type ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';

import { buildPackagedWorkflowSidecarChildArgs } from './gatewayChildMode';

const DEFAULT_WORKFLOW_SIDECAR_HOST = '127.0.0.1';
const DEFAULT_WORKFLOW_SIDECAR_PORT = 4111;
const WORKFLOW_SIDECAR_CONTRACT_VERSION = '1';
const WORKFLOW_SIDECAR_ENABLE_ENV = 'INSTRUCTION_ENGINE_ENABLE_WORKFLOW_SIDECAR';
const WORKFLOW_SIDECAR_PROBE_TIMEOUT_MS = 1_000;
const WORKFLOW_SIDECAR_PROBE_INTERVAL_MS = 250;
const WORKFLOW_SIDECAR_READY_TIMEOUT_MS = 10_000;
const WORKFLOW_SIDECAR_OFF_PATH_MESSAGE =
  'Workflow sidecar stays disabled until canonical workflow identifiers and lifecycle binding are aligned.';
const WORKFLOW_RUNTIME_BINDING_MISSING_REASON = 'workflow_runtime_binding_missing';

type WorkflowSidecarState = 'ready' | 'disabled' | 'unavailable' | 'error';
type WorkflowSidecarRuntime = 'contract-only' | 'n8n';

export interface WorkflowSidecarRuntimeBindingState {
  present: boolean;
  verified: boolean;
  reason: string | null;
}

export interface WorkflowSidecarPublicState {
  contractVersion: string;
  preferredRuntime: 'n8n';
  runtime: WorkflowSidecarRuntime;
  managedBy: 'desktop';
  loopbackOnly: true;
  auth: 'bearer';
  packaged: boolean;
  state: WorkflowSidecarState;
  killSwitch: boolean;
  desiredState: 'enabled' | 'disabled';
  host: string;
  port: number;
  triggerUrl: string | null;
  healthUrl: string | null;
  bundledEntry: string | null;
  runtimeBinding: WorkflowSidecarRuntimeBindingState;
  lastError: string | null;
}

export interface WorkflowSidecarDispatchTarget {
  triggerUrl: string;
  healthUrl: string | null;
  bearerToken: string;
}

export interface WorkflowSidecarManager {
  getPublicState: () => WorkflowSidecarPublicState;
  getDispatchTarget: () => WorkflowSidecarDispatchTarget | null;
  stop: () => Promise<void>;
}

export interface WorkflowSidecarShellAdapter {
  launchPackagedWorkflowSidecarChild?: (options: {
    localTrackerRoot: string;
    env: NodeJS.ProcessEnv;
  }) => ChildProcess | null;
}

interface StartWorkflowSidecarOptions {
  runtimeRoot: string;
  processExecPath: string;
  isPackaged: boolean;
  copilotHome: string;
  shellAdapter?: WorkflowSidecarShellAdapter;
}

function isLoopbackHost(host: string): boolean {
  const normalized = String(host || '').trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function resolveSidecarPort(): number {
  const rawValue = String(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT || '').trim();
  if (!rawValue) {
    return DEFAULT_WORKFLOW_SIDECAR_PORT;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT: ${rawValue}`);
  }
  return parsed;
}

function resolveSidecarHost(): string {
  const host = String(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_HOST || DEFAULT_WORKFLOW_SIDECAR_HOST).trim();
  if (!isLoopbackHost(host)) {
    throw new Error(`Workflow sidecar must stay loopback-only. Received host: ${host}`);
  }
  return host;
}

function buildSidecarUrl(host: string, port: number, pathname: string): string {
  return `http://${host}:${port}${pathname}`;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeRuntime(value: unknown): WorkflowSidecarRuntime {
  return value === 'n8n' ? 'n8n' : 'contract-only';
}

function normalizeState(value: unknown): WorkflowSidecarState {
  return value === 'ready' || value === 'disabled' || value === 'error' ? value : 'unavailable';
}

function normalizeRuntimeBindingState(value: unknown): WorkflowSidecarRuntimeBindingState {
  if (!isRecord(value)) {
    return {
      present: false,
      verified: false,
      reason: WORKFLOW_RUNTIME_BINDING_MISSING_REASON,
    };
  }

  const reason = typeof value.reason === 'string' && value.reason.trim()
    ? value.reason.trim()
    : null;
  return {
    present: value.present === true,
    verified: value.verified === true,
    reason,
  };
}

interface WorkflowSidecarObservedStatus {
  state: WorkflowSidecarState;
  runtime: WorkflowSidecarRuntime;
  runtimeBinding: WorkflowSidecarRuntimeBindingState;
}

async function probeWorkflowSidecarStatus(statusUrl: string, bearerToken: string): Promise<WorkflowSidecarObservedStatus> {
  const parsedUrl = new URL(statusUrl);
  if (parsedUrl.protocol !== 'http:') {
    throw new Error(`Workflow sidecar readiness probe requires loopback http. Received ${parsedUrl.protocol}`);
  }

  return await new Promise<WorkflowSidecarObservedStatus>((resolve, reject) => {
    const request = http.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `${parsedUrl.pathname}${parsedUrl.search || ''}`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
      timeout: WORKFLOW_SIDECAR_PROBE_TIMEOUT_MS,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        const statusCode = Number(response.statusCode) || 500;
        const rawBody = Buffer.concat(chunks).toString('utf8').trim();
        let parsedBody: unknown = null;
        if (rawBody) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            reject(new Error(`Workflow sidecar readiness probe returned non-JSON payload (${statusCode}).`));
            return;
          }
        }

        if (statusCode !== 200) {
          reject(new Error(`Workflow sidecar readiness probe returned ${statusCode}.`));
          return;
        }

        if (!isRecord(parsedBody)) {
          reject(new Error('Workflow sidecar readiness probe returned an invalid status payload.'));
          return;
        }

        const observedStatus: WorkflowSidecarObservedStatus = {
          state: normalizeState(parsedBody.state),
          runtime: normalizeRuntime(parsedBody.runtime),
          runtimeBinding: normalizeRuntimeBindingState(parsedBody.runtimeBinding),
        };

        if (
          observedStatus.state !== 'ready'
          || parsedBody.auth !== 'bearer'
          || parsedBody.loopbackOnly !== true
          || parsedBody.healthPath !== '/api/status'
          || parsedBody.triggerPath !== '/api/triggers'
          || observedStatus.runtimeBinding.verified !== true
        ) {
          const reason = observedStatus.runtimeBinding.reason
            || (typeof parsedBody.lastError === 'string' && parsedBody.lastError.trim() ? parsedBody.lastError.trim() : null)
            || 'Workflow sidecar did not confirm a verified runtime binding.';
          reject(Object.assign(
            new Error(`Workflow sidecar readiness probe did not confirm the canonical sidecar contract: ${reason}`),
            {
              retryable: observedStatus.runtime !== 'contract-only',
              observedStatus,
            },
          ));
          return;
        }

        resolve(observedStatus);
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Workflow sidecar readiness probe timed out.'));
    });
    request.on('error', reject);
    request.end();
  });
}

async function waitForWorkflowSidecarReady(
  statusUrl: string,
  bearerToken: string,
  isCancelled: () => boolean,
): Promise<WorkflowSidecarObservedStatus> {
  const deadline = Date.now() + WORKFLOW_SIDECAR_READY_TIMEOUT_MS;
  let lastProbeError: string | null = null;

  while (!isCancelled() && Date.now() < deadline) {
    try {
      return await probeWorkflowSidecarStatus(statusUrl, bearerToken);
    } catch (error) {
      lastProbeError = toErrorMessage(error);
      if ((error as { retryable?: unknown })?.retryable === false) {
        throw error;
      }
      if (isCancelled()) {
        break;
      }
      await wait(WORKFLOW_SIDECAR_PROBE_INTERVAL_MS);
    }
  }

  if (isCancelled()) {
    throw new Error('Workflow sidecar readiness probe was cancelled.');
  }

  throw new Error(
    lastProbeError
      ? `Workflow sidecar did not pass the authenticated readiness probe: ${lastProbeError}`
      : 'Workflow sidecar did not pass the authenticated readiness probe before timeout.'
  );
}

async function stopChildProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode != null || child.signalCode != null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | null = null;
    let finishTimer: NodeJS.Timeout | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      if (finishTimer) {
        clearTimeout(finishTimer);
      }
      child.removeListener('exit', finish);
      child.removeListener('close', finish);
      resolve();
    };

    child.once('exit', finish);
    child.once('close', finish);

    const requestKill = (signal?: NodeJS.Signals) => {
      if (child.exitCode != null || child.signalCode != null) {
        finish();
        return;
      }

      try {
        child.kill(signal);
      } catch {
        finish();
      }
    };

    if (!child.killed) {
      requestKill();
    }

    forceKillTimer = setTimeout(() => {
      if (child.exitCode != null || child.signalCode != null) {
        finish();
        return;
      }

      requestKill('SIGKILL');
      finishTimer = setTimeout(finish, 2_000);
    }, 2_000);
  });
}

export async function startWorkflowSidecar(options: StartWorkflowSidecarOptions): Promise<WorkflowSidecarManager> {
  let host = DEFAULT_WORKFLOW_SIDECAR_HOST;
  let port = DEFAULT_WORKFLOW_SIDECAR_PORT;
  let startupError: string | null = null;
  try {
    host = resolveSidecarHost();
    port = resolveSidecarPort();
  } catch (error) {
    startupError = error instanceof Error ? error.message : String(error);
  }
  const explicitlyEnabled = String(process.env[WORKFLOW_SIDECAR_ENABLE_ENV] || '').trim() === '1';
  const killSwitch = String(process.env.INSTRUCTION_ENGINE_DISABLE_WORKFLOW_SIDECAR || '').trim() === '1';
  const bearerToken =
    String(process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN || '').trim()
    || randomBytes(32).toString('hex');
  const bundledEntry = path.join(options.runtimeRoot, 'local-tracker', 'dist', 'messagingGateway', 'workflowSidecar.js');
  const baseState: WorkflowSidecarPublicState = {
    contractVersion: WORKFLOW_SIDECAR_CONTRACT_VERSION,
    preferredRuntime: 'n8n',
    runtime: 'contract-only',
    managedBy: 'desktop',
    loopbackOnly: true,
    auth: 'bearer',
    packaged: options.isPackaged,
    state: 'unavailable',
    killSwitch,
    desiredState: explicitlyEnabled && !killSwitch ? 'enabled' : 'disabled',
    host,
    port,
    triggerUrl: buildSidecarUrl(host, port, '/api/triggers'),
    healthUrl: buildSidecarUrl(host, port, '/api/status'),
    bundledEntry: bundledEntry,
    runtimeBinding: {
      present: false,
      verified: false,
      reason: WORKFLOW_RUNTIME_BINDING_MISSING_REASON,
    },
    lastError: null,
  };

  if (startupError) {
    return {
      getPublicState: () => ({
        ...baseState,
        state: 'error',
        lastError: startupError,
      }),
      getDispatchTarget: () => null,
      stop: async () => {},
    };
  }

  if (!explicitlyEnabled) {
    return {
      getPublicState: () => ({
        ...baseState,
        state: 'disabled',
        lastError: WORKFLOW_SIDECAR_OFF_PATH_MESSAGE,
      }),
      getDispatchTarget: () => null,
      stop: async () => {},
    };
  }

  if (killSwitch) {
    return {
      getPublicState: () => ({
        ...baseState,
        state: 'disabled',
        lastError: 'Workflow sidecar disabled by INSTRUCTION_ENGINE_DISABLE_WORKFLOW_SIDECAR.',
      }),
      getDispatchTarget: () => null,
      stop: async () => {},
    };
  }

  if (!fs.existsSync(bundledEntry)) {
    return {
      getPublicState: () => ({
        ...baseState,
        state: 'unavailable',
        lastError: `Workflow sidecar bundle is unavailable at ${bundledEntry}`,
      }),
      getDispatchTarget: () => null,
      stop: async () => {},
    };
  }

  process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN = bearerToken;
  process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_HOST = host;
  process.env.INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT = String(port);

  const env = {
    ...process.env,
    INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_TOKEN: bearerToken,
    INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_HOST: host,
    INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PORT: String(port),
    INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_PREFERRED_RUNTIME: 'n8n',
    INSTRUCTION_ENGINE_WORKFLOW_SIDECAR_COPILOT_HOME: options.copilotHome,
  };

  let child: ChildProcess | null = null;
  const localTrackerRoot = path.join(options.runtimeRoot, 'local-tracker');
  let state: WorkflowSidecarState = 'unavailable';
  let runtime: WorkflowSidecarRuntime = baseState.runtime;
  let runtimeBinding: WorkflowSidecarRuntimeBindingState = {
    ...baseState.runtimeBinding,
  };
  let lastError: string | null = null;
  let stopped = false;

  try {
    child = options.isPackaged
      ? options.shellAdapter?.launchPackagedWorkflowSidecarChild?.({
        localTrackerRoot,
        env,
      }) ?? spawn(options.processExecPath, buildPackagedWorkflowSidecarChildArgs(), {
        cwd: localTrackerRoot,
        env,
        stdio: 'ignore',
        windowsHide: true,
      })
      : spawn(process.execPath, [bundledEntry], {
        cwd: localTrackerRoot,
        env,
        stdio: 'ignore',
        windowsHide: true,
      });
  } catch (error) {
    state = 'error';
    lastError = error instanceof Error ? error.message : String(error);
  }

  if (child) {
    child.once('error', (error) => {
      if (stopped || state === 'disabled' || state === 'error') {
        return;
      }
      state = 'error';
      lastError = `Workflow sidecar failed before readiness: ${toErrorMessage(error)}`;
    });
    child.once('exit', (code, signal) => {
      if (stopped || state === 'disabled' || state === 'error') {
        return;
      }
      state = 'error';
      lastError = `Workflow sidecar exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`;
    });
    void waitForWorkflowSidecarReady(baseState.healthUrl || '', bearerToken, () => stopped || !child || state === 'error')
      .then((observedStatus) => {
        if (stopped || state === 'error') {
          return;
        }
        runtime = observedStatus.runtime;
        runtimeBinding = observedStatus.runtimeBinding;
        state = 'ready';
        lastError = null;
      })
      .catch(async (error) => {
        if (stopped) {
          return;
        }
        const observedStatus = isRecord((error as { observedStatus?: unknown })?.observedStatus)
          ? {
            state: normalizeState((error as { observedStatus?: Record<string, unknown> }).observedStatus?.state),
            runtime: normalizeRuntime((error as { observedStatus?: Record<string, unknown> }).observedStatus?.runtime),
            runtimeBinding: normalizeRuntimeBindingState((error as { observedStatus?: Record<string, unknown> }).observedStatus?.runtimeBinding),
          }
          : null;
        if (observedStatus) {
          runtime = observedStatus.runtime;
          runtimeBinding = observedStatus.runtimeBinding;
          state = observedStatus.state === 'ready' ? 'unavailable' : observedStatus.state;
        } else {
          state = 'error';
        }
        lastError = toErrorMessage(error);
        stopped = true;
        await stopChildProcess(child);
      });
  }

  return {
    getPublicState: () => ({
      ...baseState,
      runtime,
      state,
      runtimeBinding,
      lastError,
    }),
    getDispatchTarget: () => {
      if (state !== 'ready') {
        return null;
      }
      return {
        triggerUrl: baseState.triggerUrl || '',
        healthUrl: baseState.healthUrl,
        bearerToken,
      };
    },
    stop: async () => {
      stopped = true;
      state = 'disabled';
      await stopChildProcess(child);
      child = null;
    },
  };
}
