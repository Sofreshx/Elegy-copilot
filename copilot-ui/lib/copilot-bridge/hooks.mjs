function toDecision(value, fallbackReason = "policy_not_configured") {
  if (typeof value === "boolean") {
    return {
      allow: value,
      decision: value ? "allow" : "deny",
      reason: value ? "allowed" : "denied",
    };
  }

  if (!value || typeof value !== "object") {
    return {
      allow: true,
      decision: "allow",
      reason: fallbackReason,
    };
  }

  const allow =
    value.allow === true ||
    value.allowed === true ||
    value.ok === true ||
    value.granted === true ||
    value.decision === "allow";

  const deny =
    value.allow === false ||
    value.allowed === false ||
    value.ok === false ||
    value.granted === false ||
    value.decision === "deny";

  const resolvedAllow = deny ? false : allow;
  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim()
      : resolvedAllow
        ? "allowed"
        : "denied";

  return {
    allow: resolvedAllow,
    decision: resolvedAllow ? "allow" : "deny",
    reason,
    policy: value,
  };
}

function toErrorReason(error, fallback = "policy_hook_error") {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || fallback);
}

export function createPreToolUseHook(policyPreflightFn) {
  return async function onPreToolUse(request) {
    if (typeof policyPreflightFn !== "function") {
      return {
        allow: true,
        decision: "allow",
        reason: "policy_not_configured",
      };
    }

    try {
      const policyResult = await policyPreflightFn({
        stage: "pre-tool-use",
        request,
      });

      return toDecision(policyResult);
    } catch (error) {
      return {
        allow: false,
        decision: "deny",
        reason: toErrorReason(error),
      };
    }
  };
}

export function createSessionEndHook(onSessionEnd) {
  return async function sessionEndHook(payload) {
    if (typeof onSessionEnd !== "function") {
      return {
        ok: true,
        reason: "no_session_end_handler",
      };
    }

    try {
      await onSessionEnd(payload);
      return {
        ok: true,
        reason: "session_end_handler_completed",
      };
    } catch (error) {
      return {
        ok: false,
        reason: toErrorReason(error),
      };
    }
  };
}

export { toDecision };
