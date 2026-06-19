import { execFile } from 'child_process';

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
  dataDir: string,
  commandArgs: string[],
): string[] {
  return [kimakiEntrypoint, ...commandArgs, '--data-dir', dataDir];
}

export function createKimakiCli(options: KimakiCliOptions): KimakiCli {
  const execFileImpl = options.execFileImpl ?? execFile;

  function run(commandArgs: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFileImpl(
        options.nodeExecutable,
        buildKimakiArgs(options.kimakiEntrypoint, options.dataDir, commandArgs),
        { timeout: 30_000, windowsHide: true },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`kimaki ${commandArgs[0]} failed: ${error.message}\n${stderr}`.trim()));
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
