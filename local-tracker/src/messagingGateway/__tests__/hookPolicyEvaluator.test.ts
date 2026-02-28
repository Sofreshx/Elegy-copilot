import { HookPolicyEvaluator } from '../hookPolicyEvaluator';
import type { HookRule } from '../hookPolicyEvaluator';

describe('HookPolicyEvaluator', () => {
	const blockRule: HookRule = {
		id: 'rule-block-rm',
		severity: 'block',
		toolNamePattern: 'run_in_terminal',
		outcome: { action: 'block', message: 'Blocked rm command' },
	};

	const warnRule: HookRule = {
		id: 'rule-warn-git',
		severity: 'warn',
		toolNamePattern: 'git_.*',
		outcome: { action: 'warn', message: 'Git operations logged' },
	};

	const argRule: HookRule = {
		id: 'rule-arg-pattern',
		severity: 'block',
		toolNamePattern: 'run_in_terminal',
		argPatterns: { command: 'rm\\s+-rf' },
		outcome: { action: 'block', message: 'Destructive rm blocked' },
	};

	it('exact tool name match returns rule action', () => {
		const evaluator = new HookPolicyEvaluator([blockRule]);
		const result = evaluator.evaluate('run_in_terminal', {});
		expect(result.decision).toBe('block');
		expect(result.matchedRuleId).toBe('rule-block-rm');
		expect(result.message).toBe('Blocked rm command');
	});

	it('regex tool name match returns rule action', () => {
		const evaluator = new HookPolicyEvaluator([warnRule]);
		const result = evaluator.evaluate('git_push', {});
		expect(result.decision).toBe('warn');
		expect(result.matchedRuleId).toBe('rule-warn-git');
	});

	it('no matching rule returns allow with null matchedRuleId', () => {
		const evaluator = new HookPolicyEvaluator([blockRule]);
		const result = evaluator.evaluate('read_file', {});
		expect(result.decision).toBe('allow');
		expect(result.matchedRuleId).toBeNull();
	});

	it('argPatterns match returns correct decision', () => {
		const evaluator = new HookPolicyEvaluator([argRule]);
		const result = evaluator.evaluate('run_in_terminal', { command: 'rm -rf /' });
		expect(result.decision).toBe('block');
		expect(result.matchedRuleId).toBe('rule-arg-pattern');
	});

	it('argPatterns mismatch falls through to allow', () => {
		const evaluator = new HookPolicyEvaluator([argRule]);
		const result = evaluator.evaluate('run_in_terminal', { command: 'echo hello' });
		expect(result.decision).toBe('allow');
		expect(result.matchedRuleId).toBeNull();
	});

	it('invalid regex in argPatterns skips rule without crash', () => {
		const badArgRule: HookRule = {
			id: 'rule-bad-arg-regex',
			severity: 'block',
			toolNamePattern: 'run_in_terminal',
			argPatterns: { command: '[invalid(' },
			outcome: { action: 'block', message: 'Should not match' },
		};
		const evaluator = new HookPolicyEvaluator([badArgRule]);
		const result = evaluator.evaluate('run_in_terminal', { command: 'anything' });
		// Invalid regex causes argPatterns to not match → falls through
		expect(result.decision).toBe('allow');
		expect(result.matchedRuleId).toBeNull();
	});

	it('invalid regex in toolNamePattern skips rule without crash', () => {
		const badToolRule: HookRule = {
			id: 'rule-bad-tool-regex',
			severity: 'block',
			toolNamePattern: '[invalid(',
			outcome: { action: 'block', message: 'Should not match' },
		};
		const evaluator = new HookPolicyEvaluator([badToolRule]);
		const result = evaluator.evaluate('anything', {});
		expect(result.decision).toBe('allow');
		expect(result.matchedRuleId).toBeNull();
	});

	describe('fromPolicyRules', () => {
		it('filters non-hook-rule entries', () => {
			const policyRules = [
				{ id: 'not-hook', match: { type: 'other' }, severity: 'warn', outcome: { action: 'warn' } },
				{
					id: 'hook-1',
					match: { type: 'hook-rule' },
					severity: 'block',
					hookConfig: { toolNamePattern: 'run_in_terminal' },
					outcome: { action: 'block', message: 'Blocked' },
				},
			];
			const evaluator = HookPolicyEvaluator.fromPolicyRules(policyRules);
			// Only hook-1 should exist; non-hook-rule entries are filtered
			expect(evaluator.evaluate('run_in_terminal', {}).matchedRuleId).toBe('hook-1');
			expect(evaluator.evaluate('something_else', {}).matchedRuleId).toBeNull();
		});

		it('extracts hookConfig correctly', () => {
			const policyRules = [
				{
					id: 'hc-rule',
					match: { type: 'hook-rule' },
					severity: 'block',
					hookConfig: {
						toolNamePattern: 'file_.*',
						argPatterns: { path: '/etc/.*' },
					},
					outcome: { action: 'block', message: 'Sensitive path' },
				},
			];
			const evaluator = HookPolicyEvaluator.fromPolicyRules(policyRules);
			const result = evaluator.evaluate('file_write', { path: '/etc/passwd' });
			expect(result.decision).toBe('block');
			expect(result.matchedRuleId).toBe('hc-rule');
			expect(result.message).toBe('Sensitive path');
		});
	});

	it('first matching rule wins (order matters)', () => {
		const warnFirst: HookRule = {
			id: 'rule-warn-first',
			severity: 'warn',
			toolNamePattern: 'run_in_terminal',
			outcome: { action: 'warn', message: 'Warned' },
		};
		const blockSecond: HookRule = {
			id: 'rule-block-second',
			severity: 'block',
			toolNamePattern: 'run_in_terminal',
			outcome: { action: 'block', message: 'Blocked' },
		};
		const evaluator = new HookPolicyEvaluator([warnFirst, blockSecond]);
		const result = evaluator.evaluate('run_in_terminal', {});
		expect(result.decision).toBe('warn');
		expect(result.matchedRuleId).toBe('rule-warn-first');
	});
});
