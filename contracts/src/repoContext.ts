/** Claim types extracted from markdown scaffold files. */
export const CLAIM_TYPES = ['path', 'command', 'dependency', 'version', 'route_edge', 'script', 'config_key', 'internal_link'] as const;
export type ClaimType = typeof CLAIM_TYPES[number];

/** Severity levels for drift issues. */
export const DRIFT_SEVERITIES = ['error', 'warning', 'info'] as const;
export type DriftSeverity = typeof DRIFT_SEVERITIES[number];

/** Drift issue codes for categorizing findings. */
export const DRIFT_ISSUE_CODES = [
  'missing_path', 'stale_command', 'missing_dependency', 'version_mismatch',
  'broken_route_edge', 'undocumented_script', 'config_key_missing', 'broken_internal_link',
  'frontmatter_missing', 'frontmatter_invalid', 'stale_doc', 'pattern_index_drift',
  'todo_fixme_marker', 'cross_file_conflict', 'manifest_parse_error', 'unknown_claim_type',
] as const;
export type DriftIssueCode = typeof DRIFT_ISSUE_CODES[number];

/** A structured claim extracted from a markdown scaffold file. */
export interface Claim {
  /** Type of the claim. */
  type: ClaimType;
  /** The claimed value (e.g. "src/auth.ts", "npm run test", "react"). */
  value: string;
  /** If true, the claim asserts the opposite (e.g. "DO NOT use X"). */
  negated: boolean;
  /** Source location where the claim was found. */
  source: ClaimSource;
}

/** Source location of a claim in a file. */
export interface ClaimSource {
  /** Path relative to repo root. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** Markdown heading context (nearest heading text), or null. */
  section: string | null;
}

/** A single drift issue found during checking. */
export interface DriftIssue {
  /** Machine-readable issue code. */
  code: DriftIssueCode;
  /** Severity level. */
  severity: DriftSeverity;
  /** The claim that triggered this issue, or null for structural issues. */
  claim: Claim | null;
  /** File where the issue was found. */
  file: string;
  /** 1-indexed line number, or 0 for file-level issues. */
  line: number;
  /** Human-readable description. */
  message: string;
  /** Suggested fix, or null if no deterministic fix is possible. */
  suggestion: string | null;
}

/** Scored drift report returned by `elegy docs check --json`. */
export interface DriftReport {
  /** Health score 0-100. 100 = no drift. */
  score: number;
  /** All issues found. */
  issues: DriftIssue[];
  /** Number of scaffold files checked. */
  fileCount: number;
  /** Total claims extracted. */
  claimCount: number;
  /** Claims that verified successfully. */
  verifiedCount: number;
  /** Claims that failed verification. */
  failedCount: number;
  /** ISO 8601 timestamp of the check. */
  timestamp: string;
  /** Whether verbose logging was enabled. */
  verbose: boolean;
}
