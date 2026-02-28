import { SdkHooks } from '../sdkHooks';
import { HookPolicyEvaluator } from '../hookPolicyEvaluator';
import type { HookRule } from '../hookPolicyEvaluator';

function createMockAuditLogger() {
	return { log: jest.fn() } as any;
}

const blockRule: HookRule = {
	id: 'rule-block-1',
	severity: 'block',
	toolNamePattern: 'run_in_terminal',
	outcome: { action: 'block', message: 'Terminal blocked' },
};

const warnRule: HookRule = {
	id: 'rule-warn-1',
	severity: 'warn',
	toolNamePattern: 'git_.*',
	outcome: { action: 'warn', message: 'Git warned' },
};

describe('SdkHooks', () => {
	describe('off mode', () => {
		it('onPreToolUse returns null always', () => {
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: createMockAuditLogger(),
				enforcementMode: 'off',
			});
			expect(hooks.onPreToolUse('run_in_terminal', {})).toBeNull();
		});

		it('onPostToolUse does nothing (no audit log)', () => {
			const logger = createMockAuditLogger();
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: logger,
				enforcementMode: 'off',
			});
			hooks.onPostToolUse('run_in_terminal', {}, {});
			expect(logger.log).not.toHaveBeenCalled();
		});
	});

	describe('warn mode', () => {
		it('onPreToolUse returns null even when rule matches (logs only)', () => {
			const logger = createMockAuditLogger();
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: logger,
				enforcementMode: 'warn',
			});
			expect(hooks.onPreToolUse('run_in_terminal', {})).toBeNull();
		});

		it('audit logger called with correct fields', () => {
			const logger = createMockAuditLogger();
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: logger,
				enforcementMode: 'warn',
			});
			hooks.onPreToolUse('run_in_terminal', { command: 'ls' });
			expect(logger.log).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'hook.pre.block',
					toolName: 'run_in_terminal',
					ruleId: 'rule-block-1',
					enforcementMode: 'warn',
				}),
			);
		});
	});

	describe('block mode', () => {
		it('onPreToolUse returns HookBlockEnvelope when rule matches', () => {
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: createMockAuditLogger(),
				enforcementMode: 'block',
			});
			const result = hooks.onPreToolUse('run_in_terminal', {});
			expect(result).toEqual({
				blocked: true,
				ruleId: 'rule-block-1',
				message: 'Terminal blocked',
			});
		});

		it('onPreToolUse returns null when no rule matches', () => {
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: createMockAuditLogger(),
				enforcementMode: 'block',
			});
			expect(hooks.onPreToolUse('read_file', {})).toBeNull();
		});
	});

	describe('evaluatePermission', () => {
		it('block mode: returns autoReject true for matched block rule', () => {
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: createMockAuditLogger(),
				enforcementMode: 'block',
			});
			const result = hooks.evaluatePermission('run_in_terminal', {});
			expect(result.autoReject).toBe(true);
			expect(result.ruleId).toBe('rule-block-1');
		});

		it('warn mode: returns autoReject false even for matched block rule', () => {
			const logger = createMockAuditLogger();
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: logger,
				enforcementMode: 'warn',
			});
			const result = hooks.evaluatePermission('run_in_terminal', {});
			expect(result.autoReject).toBe(false);
		});

		it('off mode: returns autoReject false', () => {
			const hooks = new SdkHooks({
				evaluator: new HookPolicyEvaluator([blockRule]),
				auditLogger: createMockAuditLogger(),
				enforcementMode: 'off',
			});
			const result = hooks.evaluatePermission('run_in_terminal', {});
			expect(result.autoReject).toBe(false);
		});
	});

	it('onPostToolUse logs matched rule', () => {
		const logger = createMockAuditLogger();
		const hooks = new SdkHooks({
			evaluator: new HookPolicyEvaluator([warnRule]),
			auditLogger: logger,
			enforcementMode: 'warn',
		});
		hooks.onPostToolUse('git_push', { remote: 'origin' }, { ok: true });
		expect(logger.log).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'hook.post.warn',
				toolName: 'git_push',
				ruleId: 'rule-warn-1',
				enforcementMode: 'warn',
			}),
		);
	});
});
