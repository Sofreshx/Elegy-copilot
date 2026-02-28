import type { AuditLogger } from './auditLogger';
import { HookPolicyEvaluator } from './hookPolicyEvaluator';
import type { HookEvalResult } from './hookPolicyEvaluator';
import { getHookEnforcementMode, shouldBlock } from './hookEnforcementMode';
import type { HookEnforcementMode } from './hookEnforcementMode';
import { getWorkflowTracer, isTracingEnabled } from './workflows/workflowTracing';

export interface HookBlockEnvelope {
	blocked: true;
	ruleId: string;
	message: string;
}

export interface SdkHooksOptions {
	evaluator: HookPolicyEvaluator;
	auditLogger: AuditLogger;
	enforcementMode?: HookEnforcementMode; // Override env var for testing
}

export class SdkHooks {
	private readonly evaluator: HookPolicyEvaluator;
	private readonly auditLogger: AuditLogger;
	private readonly mode: HookEnforcementMode;

	constructor(options: SdkHooksOptions) {
		this.evaluator = options.evaluator;
		this.auditLogger = options.auditLogger;
		this.mode = options.enforcementMode ?? getHookEnforcementMode();
	}

	/**
	 * Called before a tool executes (onPreToolUse).
	 * Returns null if allowed, HookBlockEnvelope if blocked.
	 * In warn mode: always returns null (logs only).
	 * In off mode: does nothing.
	 */
	onPreToolUse(toolName: string, args: Record<string, unknown>): HookBlockEnvelope | null {
		if (this.mode === 'off') return null;

		const span = isTracingEnabled() ? getWorkflowTracer().startSpan('hook.preToolUse', { 'hook.tool': toolName }) : undefined;
		const result = this.evaluator.evaluate(toolName, args);
		this.logDecision('pre', toolName, args, result);

		if (result.decision === 'block' && shouldBlock(this.mode)) {
			span?.setStatus('error', `blocked by ${result.matchedRuleId}`);
			span?.end();
			return {
				blocked: true,
				ruleId: result.matchedRuleId!,
				message: result.message ?? `Blocked by rule: ${result.matchedRuleId}`,
			};
		}

		span?.setStatus('ok');
		span?.end();
		return null;
	}

	/**
	 * Called after a tool executes (onPostToolUse).
	 * Always logs; never blocks (post-execution).
	 */
	onPostToolUse(toolName: string, args: Record<string, unknown>, _output: unknown): void {
		if (this.mode === 'off') return;

		const span = isTracingEnabled() ? getWorkflowTracer().startSpan('hook.postToolUse', { 'hook.tool': toolName }) : undefined;
		const result = this.evaluator.evaluate(toolName, args);
		this.logDecision('post', toolName, args, result);
		span?.setStatus('ok');
		span?.end();
	}

	/**
	 * Evaluate whether a permission request should be auto-rejected (hook block)
	 * or passed through normally (warn/off).
	 * This is called when ACP receives a session/request_permission.
	 */
	evaluatePermission(toolName: string, args: Record<string, unknown>): { autoReject: boolean; ruleId?: string; message?: string } {
		if (this.mode === 'off') return { autoReject: false };

		const result = this.evaluator.evaluate(toolName, args);

		if (result.matchedRuleId) {
			this.auditLogger.log({
				type: `hook.permission.${result.decision}`,
				toolName,
				ruleId: result.matchedRuleId,
				enforcementMode: this.mode,
			});
		}

		if (result.decision === 'block' && shouldBlock(this.mode)) {
			return { autoReject: true, ruleId: result.matchedRuleId!, message: result.message };
		}

		return { autoReject: false };
	}

	/** Current enforcement mode */
	getMode(): HookEnforcementMode {
		return this.mode;
	}

	private logDecision(phase: 'pre' | 'post', toolName: string, args: Record<string, unknown>, result: HookEvalResult): void {
		if (result.matchedRuleId) {
			this.auditLogger.log({
				type: `hook.${phase}.${result.decision}`,
				toolName,
				ruleId: result.matchedRuleId,
				enforcementMode: this.mode,
				message: result.message,
				argKeys: Object.keys(args),
			});
		}
	}
}
