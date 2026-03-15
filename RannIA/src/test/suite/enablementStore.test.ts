import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getRepoRegistryPath } from '../../enginePaths';
import { getRepoDisabledSet, setRepoItemEnabled } from '../../enablementStore';

type MockValues = Record<string, unknown>;

function normalizeRepoKey(repoPath: string): string {
	return repoPath.replace(/\\/g, '/');
}

function readRegistry(repoPath: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(getRepoRegistryPath(repoPath), 'utf8')) as Record<string, unknown>;
}

suite('enablementStore', () => {
	let tempRoot: string;
	let repoPath: string;
	let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

	function installConfiguration(values: MockValues, onUpdate?: () => Promise<void> | void): void {
		const workspace = vscode.workspace as unknown as {
			getConfiguration: typeof vscode.workspace.getConfiguration;
		};
		workspace.getConfiguration = (() =>
			({
				has(section: string): boolean {
					return Object.prototype.hasOwnProperty.call(values, section);
				},
				get<T>(section: string, defaultValue?: T): T {
					if (Object.prototype.hasOwnProperty.call(values, section)) {
						return values[section] as T;
					}
					return defaultValue as T;
				},
				inspect<T>(): unknown {
					return undefined;
				},
				update: async (): Promise<void> => {
					await onUpdate?.();
				}
			}) as unknown as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration;
	}

	setup(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enablement-store-'));
		repoPath = path.join(tempRoot, 'repo');
		fs.mkdirSync(repoPath, { recursive: true });
		originalGetConfiguration = vscode.workspace.getConfiguration;
	});

	teardown(() => {
		const workspace = vscode.workspace as unknown as {
			getConfiguration: typeof vscode.workspace.getConfiguration;
		};
		workspace.getConfiguration = originalGetConfiguration;
		fs.rmSync(tempRoot, { recursive: true, force: true });
	});

	test('imports legacy settings into canonical registry when registry section is missing', () => {
		installConfiguration({
			'skillInstaller.state.root': tempRoot,
			'skillInstaller.skills.disabledByRepo': {
				[normalizeRepoKey(repoPath)]: [' Alpha ', 'beta', 'ALPHA', '']
			}
		}, () => {
			throw new Error('settings should not be updated during import');
		});

		const disabled = Array.from(getRepoDisabledSet('skills', repoPath)).sort();

		assert.deepStrictEqual(disabled, ['alpha', 'beta']);
		assert.deepStrictEqual(readRegistry(repoPath), {
			skills: {
				disabled: ['alpha', 'beta']
			}
		});
	});

	test('prefers canonical registry over legacy settings once a registry section exists', () => {
		installConfiguration({
			'skillInstaller.state.root': tempRoot,
			'skillInstaller.skills.disabledByRepo': {
				[normalizeRepoKey(repoPath)]: ['from-settings']
			}
		}, () => {
			throw new Error('settings should not be updated when registry exists');
		});

		const registryPath = getRepoRegistryPath(repoPath);
		fs.mkdirSync(path.dirname(registryPath), { recursive: true });
		fs.writeFileSync(
			registryPath,
			JSON.stringify(
				{
					skills: {
						disabled: ['from-registry']
					}
				},
				null,
				2
			),
			'utf8'
		);

		const disabled = Array.from(getRepoDisabledSet('skills', repoPath));

		assert.deepStrictEqual(disabled, ['from-registry']);
		assert.deepStrictEqual(readRegistry(repoPath), {
			skills: {
				disabled: ['from-registry']
			}
		});
	});

	test('writes steady-state enablement changes only to the canonical registry', async () => {
		let updateCalls = 0;
		installConfiguration({
			'skillInstaller.state.root': tempRoot,
			'skillInstaller.agents.disabledByRepo': {
				[normalizeRepoKey(repoPath)]: ['Legacy-Agent.md']
			}
		}, () => {
			updateCalls++;
		});

		const registryPath = getRepoRegistryPath(repoPath);
		fs.mkdirSync(path.dirname(registryPath), { recursive: true });
		fs.writeFileSync(
			registryPath,
			JSON.stringify(
				{
					mcpProviders: {
						disabled: ['cloudflare']
					}
				},
				null,
				2
			),
			'utf8'
		);

		await setRepoItemEnabled('agents', repoPath, 'New-Agent.md', false);
		await setRepoItemEnabled('agents', repoPath, 'legacy-agent.md', true);

		assert.strictEqual(updateCalls, 0);
		assert.deepStrictEqual(readRegistry(repoPath), {
			mcpProviders: {
				disabled: ['cloudflare']
			},
			agents: {
				disabled: ['new-agent.md']
			}
		});
	});
});
