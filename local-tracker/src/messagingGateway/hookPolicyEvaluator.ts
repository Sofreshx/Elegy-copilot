export interface HookRule {
	id: string;
	severity: 'info' | 'warn' | 'block';
	toolNamePattern: string;
	argPatterns?: Record<string, string>; // key = arg name, value = regex pattern
	outcome: { action: 'allow' | 'warn' | 'block'; message?: string };
}

export type HookDecision = 'allow' | 'warn' | 'block';

export interface HookEvalResult {
	decision: HookDecision;
	matchedRuleId: string | null;
	message?: string;
}

export class HookPolicyEvaluator {
	private readonly rules: HookRule[];

	constructor(rules: HookRule[]) {
		this.rules = rules;
	}

	/**
	 * Load hook-rules from a parsed pipeline policy (from pipeline-policy.json).
	 * Filters to only hook-rule match types and maps to HookRule[].
	 */
	static fromPolicyRules(policyRules: Array<Record<string, unknown>>): HookPolicyEvaluator {
		const hookRules: HookRule[] = [];
		for (const rule of policyRules) {
			const match = rule.match as Record<string, unknown> | undefined;
			if (match?.type !== 'hook-rule') continue;
			const hookConfig = rule.hookConfig as Record<string, unknown> | undefined;
			if (!hookConfig?.toolNamePattern) continue;
			hookRules.push({
				id: rule.id as string,
				severity: rule.severity as 'info' | 'warn' | 'block',
				toolNamePattern: hookConfig.toolNamePattern as string,
				argPatterns: hookConfig.argPatterns as Record<string, string> | undefined,
				outcome: rule.outcome as { action: 'allow' | 'warn' | 'block'; message?: string },
			});
		}
		return new HookPolicyEvaluator(hookRules);
	}

	/**
	 * Evaluate a tool call.
	 * - toolName: the tool being called
	 * - args: the args being passed to the tool
	 * Returns: { decision, matchedRuleId, message }
	 * If no rule matches → { decision: 'allow', matchedRuleId: null }
	 * First matching rule wins (rules evaluated in order).
	 * Invalid regex patterns in argPatterns → skip that rule (log warning, don't crash).
	 */
	evaluate(toolName: string, args: Record<string, unknown>): HookEvalResult {
		for (const rule of this.rules) {
			if (!this.matchesToolName(rule.toolNamePattern, toolName)) continue;
			if (rule.argPatterns && !this.matchesArgs(rule.argPatterns, args)) continue;
			return {
				decision: rule.outcome.action,
				matchedRuleId: rule.id,
				message: rule.outcome.message,
			};
		}
		return { decision: 'allow', matchedRuleId: null };
	}

	private matchesToolName(pattern: string, toolName: string): boolean {
		if (pattern === toolName) return true;
		try {
			return new RegExp(`^${pattern}$`).test(toolName);
		} catch {
			return false;
		}
	}

	private matchesArgs(argPatterns: Record<string, string>, args: Record<string, unknown>): boolean {
		for (const [key, pattern] of Object.entries(argPatterns)) {
			const argValue = String(args[key] ?? '');
			try {
				if (!new RegExp(pattern).test(argValue)) return false;
			} catch {
				return false;
			}
		}
		return true;
	}
}
