import { execFile } from 'child_process';
import path from 'path';

export interface KimakiCli {
  projectList: () => Promise<unknown>;
  projectAdd: (directory: string, guildId?: string) => Promise<string>;
  send: (options: {
    project: string;
    prompt: string;
    threadId?: string;
    permission?: string[];
  }) => Promise<string>;
  sessionList: (project?: string) => Promise<unknown>;
  sessionSearch: (query: string) => Promise<unknown>;
}

export interface KimakiCliOptions {
  nodeExecutable: string;
  kimakiEntrypoint: string;
  dataDir: string;
  execFileImpl?: typeof execFile;
}

export function buildKimakiArgs(
  kimakiEntrypoint: string,
  commandArgs: string[],
): string[] {
  return [kimakiEntrypoint, ...commandArgs];
}

export function buildKimakiCliEnv(
  dataDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    KIMAKI_DB_URL: `file:${path.join(dataDir, 'discord-sessions.db')}`,
  };
  delete env.KIMAKI_DB_AUTH_TOKEN;
  return env;
}

function sanitizeCliDetail(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

export function createKimakiCli(options: KimakiCliOptions): KimakiCli {
  const execFileImpl = options.execFileImpl ?? execFile;

  function run(commandArgs: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFileImpl(
        options.nodeExecutable,
        buildKimakiArgs(options.kimakiEntrypoint, commandArgs),
        {
          timeout: 30_000,
          windowsHide: true,
          env: buildKimakiCliEnv(options.dataDir),
        },
        (error, stdout, stderr) => {
          if (error) {
            const command = commandArgs.join(' ');
            const detail = sanitizeCliDetail(stderr || error.message);
            reject(new Error(`Kimaki command failed (${command}): ${detail || 'unknown error'}`));
            return;
          }
          resolve(stdout.trim());
        },
      );
    });
  }

  async function runJson(commandArgs: string[]): Promise<unknown> {
    const stdout = await run([...commandArgs, '--json']);
    return stdout ? JSON.parse(stdout) : [];
  }

  return {
    projectList: () => runJson(['project', 'list']),
    projectAdd: (directory, guildId) => {
      const args = ['project', 'add', directory];
      if (guildId) {
        args.push('--guild', guildId);
      }
      return run(args);
    },
    send: ({ project, prompt, threadId, permission }) => {
      const args = ['send'];
      if (threadId) {
        args.push('--thread', threadId);
      } else {
        args.push('--project', project);
      }
      args.push('--prompt', prompt);
      for (const rule of permission ?? []) {
        args.push('--permission', rule);
      }
      return run(args);
    },
    sessionList: (project) => {
      const args = ['session', 'list'];
      if (project) {
        args.push('--project', project);
      }
      return runJson(args);
    },
    sessionSearch: (query) => runJson(['session', 'search', query]),
  };
}
