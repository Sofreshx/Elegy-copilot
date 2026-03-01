import { toDecision } from "./hooks.mjs";

const PERMISSION_KIND_MAP = Object.freeze({
  "tool": "tool_execution",
  "tool.user_requested": "tool_execution",
  "shell": "shell_command",
  "shell_command": "shell_command",
  "file": "file_write",
  "file_write": "file_write",
  "url": "url_access",
  "url_access": "url_access",
  "mcp": "mcp_call",
  "mcp_call": "mcp_call",
});

function toErrorReason(error, fallback = "permission_hook_error") {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || fallback);
}

export function mapPermissionKind(request) {
  if (!request || typeof request !== "object") {
    return "unknown";
  }

  const rawKind =
    typeof request.kind === "string"
      ? request.kind
      : typeof request.type === "string"
        ? request.type
        : "";

  const token = rawKind.trim().toLowerCase();
  if (!token) {
    return "unknown";
  }

  return PERMISSION_KIND_MAP[token] || token;
}

export function createPermissionRequestHandler(policyPreflightFn) {
  return async function onPermissionRequest(request) {
    const mappedKind = mapPermissionKind(request);

    if (typeof policyPreflightFn !== "function") {
      return {
        allow: true,
        decision: "allow",
        granted: true,
        reason: "policy_not_configured",
        kind: mappedKind,
      };
    }

    try {
      const policyResult = await policyPreflightFn({
        stage: "permission-request",
        kind: mappedKind,
        request,
      });

      const decision = toDecision(policyResult, "policy_not_configured");
      return {
        ...decision,
        granted: decision.allow,
        kind: mappedKind,
      };
    } catch (error) {
      return {
        allow: false,
        decision: "deny",
        granted: false,
        reason: toErrorReason(error),
        kind: mappedKind,
      };
    }
  };
}
