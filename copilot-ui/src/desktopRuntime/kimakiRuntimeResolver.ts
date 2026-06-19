import path from 'path';

export interface KimakiRuntimeResolution {
  available: boolean;
  entrypoint: string | null;
  checkedPaths: string[];
  reason: 'ready' | 'kimaki_entrypoint_missing';
}

export function resolveKimakiEntrypoint(options: {
  appPath: string;
  runtimeRoot: string;
  explicitPath?: string;
  existsSync: (candidate: string) => boolean;
}): KimakiRuntimeResolution {
  const candidates = [
    options.explicitPath,
    path.join(options.appPath, 'node_modules', 'kimaki', 'bin.js'),
    path.join(options.runtimeRoot, 'node_modules', 'kimaki', 'bin.js'),
    path.join(options.runtimeRoot, 'copilot-ui', 'node_modules', 'kimaki', 'bin.js'),
  ]
    .map((candidate) => String(candidate || '').trim())
    .filter((candidate, index, values) => candidate && values.indexOf(candidate) === index);

  const entrypoint = candidates.find((candidate) => options.existsSync(candidate)) || null;
  return {
    available: Boolean(entrypoint),
    entrypoint,
    checkedPaths: candidates,
    reason: entrypoint ? 'ready' : 'kimaki_entrypoint_missing',
  };
}
