import { SdkHooks } from '../sdkHooks';
import { HookPolicyEvaluator } from '../hookPolicyEvaluator';
import type { HookRule } from '../hookPolicyEvaluator';

/**
 * AcpBridgeClient + SdkHooks integration tests.
 *
 * AcpBridgeClient relies on TCP (net.Socket), so we test the SdkHooks
 * integration points that AcpBridgeClient delegates to — evaluatePermission,
 * onPreToolUse, and onPostToolUse — using the real SdkHooks + HookPolicyEvaluator
 * classes with controlled rules and enforcement modes.
 */

function createMockAuditLogger() {
	return { log: jest.fn() } as any;
}

const blockTerminalRule: HookRule = {
	id: 'test.block.run_in_terminal',
	severity: 'block',
	toolNamePattern: 'run_in_terminal',
	argPatterns: { isBackground: '^true$' },
	outcome: { action: 'block', message: 'Background terminal blocked' },
};

const warnGitRule: HookRule = {
	id: 'test.warn.git',
	severity: 'warn',
	toolNamePattern: 'git_.*',
	outcome: { action: 'warn', message: 'Git operation warned' },
};

describe('AcpBridgeClient + SdkHooks integration', () => {
	describe('evaluatePermission', () => {
		it('auto-rejects in block mode when rule matches', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'block' });

			const result = hooks.evaluatePermission('run_in_terminal', { isBackground: 'true' });

			expect(result.autoReject).toBe(true);
			expect(result.ruleId).toBe('test.block.run_in_terminal');
			expect(result.message).toBe('Background terminal blocked');
		});

		it('passes through in warn mode even when rule matches', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'warn' });

			const result = hooks.evaluatePermission('run_in_terminal', { isBackground: 'true' });

			expect(result.autoReject).toBe(false);
		});

		it('passes through when no rule matches', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'block' });

			const result = hooks.evaluatePermission('read_file', {});

			expect(result.autoReject).toBe(false);
		});

		it('passes through in off mode regardless of matching rule', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'off' });

			const result = hooks.evaluatePermission('run_in_terminal', { isBackground: 'true' });

			expect(result.autoReject).toBe(false);
		});

		it('logs audit entry when rule matches in block mode', () => {
			const logger = createMockAuditLogger();
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: logger, enforcementMode: 'block' });

			hooks.evaluatePermission('run_in_terminal', { isBackground: 'true' });

			expect(logger.log).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'hook.permission.block',
					toolName: 'run_in_terminal',
					ruleId: 'test.block.run_in_terminal',
					enforcementMode: 'block',
				}),
			);
		});

		it('logs audit entry when rule matches in warn mode', () => {
			const logger = createMockAuditLogger();
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: logger, enforcementMode: 'warn' });

			hooks.evaluatePermission('run_in_terminal', { isBackground: 'true' });

			expect(logger.log).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'hook.permission.block',
					toolName: 'run_in_terminal',
					ruleId: 'test.block.run_in_terminal',
					enforcementMode: 'warn',
				}),
			);
		});
	});

	describe('onPreToolUse', () => {
		it('blocks in block mode with matching rule', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'block' });

			const result = hooks.onPreToolUse('run_in_terminal', { isBackground: 'true' });

			expect(result).toBeTruthy();
			expect(result!.blocked).toBe(true);
			expect(result!.ruleId).toBe('test.block.run_in_terminal');
			expect(result!.message).toBe('Background terminal blocked');
		});

		it('returns null in warn mode even with matching rule', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'warn' });

			const result = hooks.onPreToolUse('run_in_terminal', { isBackground: 'true' });

			expect(result).toBeNull();
		});

		it('returns null when no rule matches in block mode', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'block' });

			const result = hooks.onPreToolUse('read_file', {});

			expect(result).toBeNull();
		});

		it('returns null when args do not match', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'block' });

			const result = hooks.onPreToolUse('run_in_terminal', { isBackground: 'false' });

			expect(result).toBeNull();
		});
	});

	describe('onPostToolUse', () => {
		it('logs audit entry after tool execution', () => {
			const logger = createMockAuditLogger();
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: logger, enforcementMode: 'block' });

			hooks.onPostToolUse('run_in_terminal', { isBackground: 'true' }, { exitCode: 0 });

			expect(logger.log).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'hook.post.block',
					toolName: 'run_in_terminal',
					ruleId: 'test.block.run_in_terminal',
				}),
			);
		});

		it('does not log when no rule matches', () => {
			const logger = createMockAuditLogger();
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: logger, enforcementMode: 'block' });

			hooks.onPostToolUse('read_file', {}, {});

			expect(logger.log).not.toHaveBeenCalled();
		});

		it('does nothing in off mode', () => {
			const logger = createMockAuditLogger();
			const evaluator = new HookPolicyEvaluator([blockTerminalRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: logger, enforcementMode: 'off' });

			hooks.onPostToolUse('run_in_terminal', { isBackground: 'true' }, {});

			expect(logger.log).not.toHaveBeenCalled();
		});
	});

	describe('multi-rule evaluation order', () => {
		it('first matching rule wins', () => {
			const evaluator = new HookPolicyEvaluator([blockTerminalRule, warnGitRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: createMockAuditLogger(), enforcementMode: 'block' });

			const termResult = hooks.evaluatePermission('run_in_terminal', { isBackground: 'true' });
			expect(termResult.autoReject).toBe(true);

			const gitResult = hooks.evaluatePermission('git_push', {});
			expect(gitResult.autoReject).toBe(false); // warn rule doesn't auto-reject in block mode
		});

		it('warn rule logs but does not block in block enforcement', () => {
			const logger = createMockAuditLogger();
			const evaluator = new HookPolicyEvaluator([warnGitRule]);
			const hooks = new SdkHooks({ evaluator, auditLogger: logger, enforcementMode: 'block' });

			const result = hooks.onPreToolUse('git_push', {});

			expect(result).toBeNull(); // warn outcome → not blocked
			expect(logger.log).toHaveBeenCalledWith(
				expect.objectContaining({ type: 'hook.pre.warn', ruleId: 'test.warn.git' }),
			);
		});
	});
});
