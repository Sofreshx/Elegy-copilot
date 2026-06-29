/**
 * claim-extractor.js — Deterministic markdown claim parser.
 *
 * Parses markdown content and extracts structured claims (file paths,
 * CLI commands, dependencies, internal links, route edges).
 *
 * Exports:
 *   extractClaims(content, filePath)        — Main entry point
 *   extractPathClaims(lines, filePath)      — Backtick-quoted file paths
 *   extractCommandClaims(lines, filePath)   — Backtick-quoted CLI commands
 *   extractDependencyClaims(lines, filePath) — Backtick-quoted dependency names
 *   extractLinkClaims(lines, filePath)      — Markdown internal links
 *   extractRouteEdgeClaims(frontmatter, filePath) — Route edges from YAML frontmatter
 *   resolveSection(lines, lineIndex)        — Find nearest heading above a line
 */

'use strict';

const { matchFrontmatter } = require('./spec-headings');
const { parseFrontmatterYaml } = require('./spec-yaml');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Known CLI command prefixes. */
const CLI_PREFIXES = new Set([
  'npm', 'npx', 'node', 'yarn', 'pnpm', 'cargo', 'rustc',
  'python', 'pip', 'go', 'make', 'docker', 'kubectl', 'git', 'elegy',
  'rg', 'grep', 'find', 'awk', 'sed',
]);

/** Words never classified as paths. */
const NON_PATH_WORDS = new Set([
  'true', 'false', 'null', 'undefined',
]);

/** Words never classified as dependencies. */
const NON_DEP_WORDS = new Set([
  'true', 'false', 'null', 'undefined',
  'npm', 'node', 'yarn', 'pnpm', 'npx', 'cargo', 'rustc',
  'python', 'pip', 'go', 'make', 'docker', 'kubectl', 'git', 'elegy',
  'install', 'import', 'require', 'export', 'module', 'version',
  'the', 'this', 'that', 'with', 'from', 'file', 'path', 'line',
  'name', 'type', 'value', 'key', 'list', 'array', 'object',
  'string', 'number', 'boolean', 'function', 'class', 'const',
  'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do',
  'try', 'catch', 'throw', 'new', 'delete', 'typeof', 'instanceof',
  'void', 'default', 'case', 'switch', 'break', 'continue',
  'and', 'or', 'not', 'in', 'of', 'to', 'is', 'as',
  'src', 'dist', 'build', 'test', 'docs', 'lib', 'app',
  'index', 'main', 'config', 'env', 'example',
  'js', 'ts', 'json', 'md', 'css', 'html', 'yml', 'yaml',
  'on', 'off', 'yes', 'no', 'none', 'all', 'any', 'each', 'every',
  'some', 'many', 'few', 'most', 'other', 'another',
  'can', 'will', 'may', 'must', 'shall', 'could', 'would', 'should',
  'has', 'have', 'had', 'been', 'being', 'were', 'was', 'are', 'is', 'be',
  'do', 'does', 'did', 'done', 'doing',
  'get', 'set', 'put', 'add', 'remove', 'update', 'create', 'delete',
  'find', 'search', 'list', 'show', 'run', 'exec', 'call', 'make',
  'start', 'stop', 'restart', 'enable', 'disable',
  'config', 'setting', 'option', 'flag', 'param', 'arg', 'argument',
  'stdin', 'stdout', 'stderr', 'exit', 'code', 'error', 'warn', 'info',
  'dir', 'cwd', 'pwd', 'home', 'root', 'user', 'group', 'owner',
  'size', 'count', 'total', 'max', 'min', 'avg', 'sum',
  'yes', 'no', 'ok', 'okay', 'done',
  // Agent types and roles (not npm packages)
  'explorer', 'scout', 'research', 'reviewer', 'impl', 'plan',
  'build', 'quick', 'project', 'session', 'analytics',
  'dependency', 'missing_dependency', 'stale_command', 'cross_file_conflict',
  'manifest_parse_error', 'undocumented_script',
	// Common documentation and spec terms
	'global', 'repo', 'local', 'remote', 'workspace',
	'standard', 'spec', 'claude', 'state',
	'available', 'installed', 'stale', 'unmanaged', 'supported',
	'claude-code', 'engine-assets', 'model_provider',
	'not-installed', 'supported-but-inactive',
	// Terms commonly mistaken as dependencies
	'validate', 'cycle', 'confidence',
	'review-pack', 'evidence', 'tool_versions',
	// Agent/subagent names
	'impl-pro',
	// Rule engine references
	'forbidden-import', 'forbidden-edge',
	'elegy-planning', 'elegy-arch-rules',
	// Dot notation table references (split parts)
	'analysis_runs',
	// Known generic terms in dependency descriptions
	'stable', 'beta', 'alpha', 'latest',
	'record', 'list', 'show', 'search', 'find',
	'blocked', 'blocking', 'depends', 'dependency',
	// English words in dep contexts
	'saving', 'authorized', 'ready',
	// Node.js built-in module names
	'child_process',
	// JSON/config field names
	'install_url',
	// Skill names that look like npm packages
	'skill-authoring', 'guidelines-authoring', 'project-guidelines',
	'agents-md-authoring',
	'repo-setup', 'skill-discovery', 'stack-detector',
	'rubberduck-plan-review', 'implementation-handoff', 'implementation-review',
	'planning-tools', 'spec-dev', 'spec-authoring', 'spec-review',
	// Script/tool names mistaken as dependencies
	'commit-check',
	'gh',
	// Non-package concept names
	'review_model',
	// Durability gate envelope identifiers
	'planning_durability_dependency_gate_blocked',
	'planning_durability_route_gate_blocked',
]);

/** Lines mentioning these keywords may contain dependency claims. */
const DEP_LINE_KEYWORD_RE = /\b(dependency|dependencies|package|install|import|require)\b/i;

/** Negation patterns checked within 5 words of a backtick. */
const NEGATION_PATTERNS = [
  /\bdo\s+not\b/i,
  /\bmust\s+not\b/i,
  /\bshould\s+not\b/i,
  /\bavoid\b/i,
  /\bdon't\b/i,
  /\bnever\b/i,
];

/** Kebab-case pattern for route edge IDs. */
const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Pure-number pattern. */
const PURE_NUMBER_RE = /^\d+(\.\d+)?$/;

/** File extension pattern: dot followed by 1-6 word chars at end. */
const FILE_EXT_RE = /\.[a-zA-Z][a-zA-Z0-9]{0,5}$/; // first char after dot must be a letter

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute which line indices are excluded (inside fenced code blocks or
 * HTML comments). Fence lines themselves are also excluded.
 *
 * @param {string[]} lines
 * @returns {boolean[]}
 */
function computeExcludedLines(lines) {
  const excluded = new Array(lines.length).fill(false);

  // Track fenced code blocks
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      excluded[i] = true;
      inBlock = !inBlock;
      continue;
    }
    if (inBlock) {
      excluded[i] = true;
    }
  }

  // Track HTML comments (independent of code blocks)
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    if (excluded[i]) {
      // Already inside a code block — skip. But we still need to track
      // comment state across code blocks. Since comments and code blocks
      // don't nest in markdown, we can simply skip code-block lines.
      continue;
    }

    const line = lines[i];
    const ci = line.indexOf('<!--');
    const ce = line.indexOf('-->');

    if (inComment) {
      // Exclude this line (it's inside a comment)
      excluded[i] = true;
      // Check if comment ends on this line
      if (ce !== -1 && (ci === -1 || ce < ci)) {
        inComment = false;
      }
      continue;
    }

    if (ci !== -1) {
      excluded[i] = true;
      if (ce === -1 || ce < ci) {
        // Comment continues past this line
        inComment = true;
      }
    }
  }

  return excluded;
}

/**
 * Check if the context around a backtick match suggests negation.
 * Looks for negation keywords within 5 words before or after the match.
 *
 * @param {string} line — the full source line
 * @param {number} matchIndex — position of the opening backtick
 * @param {number} matchEnd — position after the closing backtick
 * @returns {boolean}
 */
function isNegated(line, matchIndex, matchEnd) {
  const before = line.slice(0, matchIndex);
  const after = line.slice(matchEnd);

  const beforeWords = before.split(/\s+/).filter(Boolean).slice(-5).join(' ');
  const afterWords = after.split(/\s+/).filter(Boolean).slice(0, 5).join(' ');

  const context = (beforeWords + ' ' + afterWords).toLowerCase();

  return NEGATION_PATTERNS.some(function (re) {
    return re.test(context);
  });
}

/**
 * Check if a backtick-quoted value is inside markdown link text [text](url).
 *
 * @param {string} line — the full source line
 * @param {number} openingTickIndex — index of the opening backtick
 * @param {number} closingTickEndIndex — index after the closing backtick
 * @returns {boolean}
 */
function isInsideLinkText(line, openingTickIndex, closingTickEndIndex) {
  const beforeTick = line.slice(0, openingTickIndex);
  const afterTick = line.slice(closingTickEndIndex);

  // Find the last '[' before the opening backtick
  const lastBracket = beforeTick.lastIndexOf('[');
  if (lastBracket === -1) {
    return false;
  }

  // Check that '](' or '] (' follows the closing backtick (with optional space)
  const afterTrimStart = afterTick.replace(/^\s+/, '');
  if (/^\]\s*\(/.test(afterTrimStart)) {
    return true;
  }

  return false;
}

/**
 * Check if a value is a pure number (integer or decimal).
 *
 * @param {string} value
 * @returns {boolean}
 */
function isPureNumber(value) {
  return PURE_NUMBER_RE.test(value);
}

// ---------------------------------------------------------------------------
// resolveSection
// ---------------------------------------------------------------------------

/**
 * Walk backwards from lineIndex to find the nearest markdown heading.
 * Returns the heading text without the `#` prefix, or null if none found.
 *
 * @param {string[]} lines
 * @param {number} lineIndex
 * @returns {string|null}
 */
function resolveSection(lines, lineIndex) {
  for (var i = lineIndex - 1; i >= 0; i--) {
    var match = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) {
      return match[2].trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// extractPathClaims
// ---------------------------------------------------------------------------

/**
 * Find backtick-quoted strings that look like file paths.
 *
 * A value is a path if it:
 *   - contains a file extension (`.` + 1-6 word chars) OR
 *   - contains at least one `/` and no spaces
 *
 * Excludes URLs, known non-path words, pure numbers, values inside
 * markdown headings, and values inside markdown link text.
 *
 * @param {string[]} lines
 * @param {string} filePath
 * @param {object} [options]
 * @param {function} [options.excludeLine] — (lineIndex) => boolean
 * @param {Set} [options.claimedValues] — values already claimed by other extractors
 * @returns {Array<{type: string, value: string, negated: boolean, source: object}>}
 */
function extractPathClaims(lines, filePath, options) {
  if (!options) options = {};
  var excludeLine = options.excludeLine || function () { return false; };
  var claimedValues = options.claimedValues || new Set();

  var claims = [];
  var currentSection = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Track current section
    var headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = headingMatch[2].trim();
    }

    // Skip excluded lines
    if (excludeLine(i)) {
      continue;
    }

    // Skip lines that are headings themselves
    if (line.trim().startsWith('#')) {
      continue;
    }

    var re = /`([^`]+)`/g;
    var match;

    while ((match = re.exec(line)) !== null) {
      var value = match[1];
      var matchIndex = match.index;
      var matchEnd = re.lastIndex;

      // Already claimed by another extractor
      if (claimedValues.has(value)) {
        continue;
      }

      // Exclude URLs
      if (/^https?:\/\//i.test(value)) {
        continue;
      }

      // Exclude template placeholders (containing <, >, {, or })
      if (value.indexOf('<') !== -1 || value.indexOf('>') !== -1 ||
          value.indexOf('{') !== -1 || value.indexOf('}') !== -1) {
        continue;
      }

      // Exclude known non-path words
      if (NON_PATH_WORDS.has(value)) {
        continue;
      }

      // Exclude pure numbers
      if (isPureNumber(value)) {
        continue;
      }

      // Exclude values inside markdown link text
      if (isInsideLinkText(line, matchIndex, matchEnd)) {
        continue;
      }

      // A path must either:
      //   (a) have a file extension (first char after dot must be a letter)
      //   (b) contain at least one / with no spaces
      var hasExtension = FILE_EXT_RE.test(value);
      var hasSeparator = value.indexOf('/') !== -1;
      var noSpaces = value.indexOf(' ') === -1;

      if (!hasExtension && !(hasSeparator && noSpaces)) {
        continue;
      }

      // Exclude pure directory separator values like just "/"
      if (value === '/') {
        continue;
      }

      // Exclude scoped package names (@scope/name) from path claims
      if (/^@[\w-]+\/[\w.\-@^~]+$/.test(value)) {
        continue;
      }

      // Exclude user home directory paths (~/.elegy, ~/.config, etc.)
      if (value.startsWith('~/')) {
        continue;
      }

      // Exclude absolute paths (API endpoints, system paths)
      if (value.startsWith('/') && !value.startsWith('/docs/')) {
        continue;
      }

      // Exclude template placeholders ({repo-name}, {repoId}, etc.)
      if (/\{[^}]+\}/.test(value)) {
        continue;
      }

      // Exclude wildcard paths (docs/system/**, engine-assets/skills/*/SKILL.md)
      if (value.includes('*')) {
        continue;
      }

      // Exclude bare filenames without directory context (SKILL.md, manifest.json, etc.)
      // These are typically example filenames in documentation, not actual repo files
      if (!value.includes('/') && FILE_EXT_RE.test(value)) {
        continue;
      }

      // --- Heuristic exclusions for common false-positive patterns ---

      // Skip command-like strings (CLI prefix + space + arg) — these are
      // commands, not file paths (e.g. `node scripts/foo.js`, `npm run test`)
      var firstSpace = value.indexOf(' ');
      if (firstSpace !== -1) {
        var prefix = value.slice(0, firstSpace);
        if (CLI_PREFIXES.has(prefix)) continue;
      }

      // Skip external repo references (Org/Repo — no extension, first segment
      // capitalized, like `Sofreshx/Elegy`) and ACP protocol methods (two
      // all-lowercase segments like `session/new`, `session/prompt`).
      if (!hasExtension && hasSeparator && noSpaces) {
        var pathSegments = value.split('/');

        // ACP protocol methods: two all-lowercase segments, no dots
        if (pathSegments.length === 2 &&
          /^[a-z]+$/.test(pathSegments[0]) &&
          /^[a-z]+$/.test(pathSegments[1])) {
          continue;
        }

        // GitHub-style repo refs: first segment starts uppercase
        if (/^[A-Z]/.test(pathSegments[0]) &&
          pathSegments[0].indexOf('.') === -1) {
          continue;
        }

        // Schema version references: last segment is `v` + digits
        // (e.g. `elegy-arch-rules/v1`, `elegy-evidence/v1`)
        if (pathSegments.length >= 2 &&
          /^v\d+$/.test(pathSegments[pathSegments.length - 1])) {
          continue;
        }

        // Model identifier references (e.g. `opencode-go/deepseek-v4-pro`):
        // two segments, lowercase/numbers/hyphens only, no file extension
        if (pathSegments.length === 2 &&
          /^[a-z][a-z0-9-]*$/.test(pathSegments[0]) &&
          /^[a-z][a-z0-9-]*$/.test(pathSegments[1])) {
          continue;
        }
      }

      // Skip paths containing node_modules — these exist only at runtime
      if (value.indexOf('node_modules') !== -1) {
        continue;
      }

      // Skip Frontend/ prefixed paths — these are from the Holon project
      // (external codebase), not this repo.
      if (value.startsWith('Frontend/')) {
        continue;
      }

      // Skip bare directory references (ending with /) — these are typically
      // conceptual paths in planning/prose docs, not real fs paths
      if (value.charAt(value.length - 1) === '/') {
        continue;
      }

      // Skip regex anchor patterns (starting with ^) — these are regex
      // expressions in docs, not file paths (e.g. `^docs/specs/`)
      if (value.charAt(0) === '^') {
        continue;
      }

      // Skip shell shebang patterns (starting with #!) — these are
      // interpreter directives, not file paths (e.g. `#!/bin/sh`)
      if (value.startsWith('#!')) {
        continue;
      }

      // Skip environment variable assignment patterns (containing =).
      // e.g. `INSTRUCTION_ENGINE_ELEGY_PLANNING_SESSION_PATH=~/path`
      if (value.indexOf('=') !== -1 && !hasExtension) {
        continue;
      }

      // Skip require() call patterns in code snippets — the value contains
      // `require('...')` and is syntactic code, not a file path
      if (value.indexOf("require('") !== -1) {
        continue;
      }

      // Skip line-number-suffixed paths (e.g. `file.ts:123`, `file.js:45-67`,
      // `routes/catalog.js:1113`). These are code references with line anchors,
      // not real filesystem paths. Stripped at verification time; skip extraction
      // to avoid confusing output.
      if (/\.\w+:\d+(-\d+)?$/.test(value)) {
        continue;
      }

      // Skip values wrapped in single or double quotes
      // (e.g. `'claude-assets/manifest.json'` in markdown tables).
      // Real file paths are never quoted in backtick content.
      if (value.length >= 2 &&
        ((value.charAt(0) === "'" && value.charAt(value.length - 1) === "'") ||
         (value.charAt(0) === '"' && value.charAt(value.length - 1) === '"'))) {
        continue;
      }

      // Skip test mock call patterns — values starting with a function name
      // followed by a parenthesized argument (e.g. `vi.mock('../ui/src/lib/api/git')`,
      // `discoverChecks('/fake/repo')`). These are code references, not file paths.
      if (/^[a-zA-Z_$][\w.]*\(.*\)$/.test(value) && !hasExtension && hasSeparator) {
        continue;
      }

      // Skip relative import paths starting with `../` — these are Node.js
      // require/import references from spec/test files, not real filesystem
      // paths relative to the repo root (e.g. `../../lib/api/git`).
      if (value.startsWith('../') || value.startsWith('./')) {
        continue;
      }

      var negated = isNegated(line, matchIndex, matchEnd);

      claims.push({
        type: 'path',
        value: value,
        negated: negated,
        source: {
          file: filePath,
          line: i + 1,
          section: currentSection,
        },
      });
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// extractCommandClaims
// ---------------------------------------------------------------------------

/**
 * Find backtick-quoted strings that look like CLI commands.
 *
 * A value is a command if it starts with a known CLI prefix followed by
 * a space and at least one argument character.
 *
 * @param {string[]} lines
 * @param {string} filePath
 * @param {object} [options]
 * @param {function} [options.excludeLine]
 * @param {Set} [options.claimedValues]
 * @returns {Array<{type: string, value: string, negated: boolean, source: object}>}
 */
function extractCommandClaims(lines, filePath, options) {
  if (!options) options = {};
  var excludeLine = options.excludeLine || function () { return false; };
  var claimedValues = options.claimedValues || new Set();

  var claims = [];
  var currentSection = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Track current section
    var headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = headingMatch[2].trim();
    }

    if (excludeLine(i)) {
      continue;
    }

    var re = /`([^`]+)`/g;
    var match;

    while ((match = re.exec(line)) !== null) {
      var value = match[1];
      var matchIndex = match.index;
      var matchEnd = re.lastIndex;

      // Already claimed
      if (claimedValues.has(value)) {
        continue;
      }

      // Exclude template placeholders (containing <, >, {, or })
      if (value.indexOf('<') !== -1 || value.indexOf('>') !== -1 ||
          value.indexOf('{') !== -1 || value.indexOf('}') !== -1) {
        continue;
      }

      // Check for CLI prefix + space + argument
      var firstSpace = value.indexOf(' ');
      if (firstSpace === -1) {
        continue; // must have arguments
      }

      var prefix = value.slice(0, firstSpace);
      var args = value.slice(firstSpace + 1);

      if (!CLI_PREFIXES.has(prefix)) {
        continue;
      }

      if (args.length < 1) {
        continue;
      }

      var negated = isNegated(line, matchIndex, matchEnd);

      claims.push({
        type: 'command',
        value: value,
        negated: negated,
        source: {
          file: filePath,
          line: i + 1,
          section: currentSection,
        },
      });
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// extractDependencyClaims
// ---------------------------------------------------------------------------

/**
 * Find backtick-quoted strings that look like package/dependency names.
 *
 * A value is a dependency if it matches `@scope/name` pattern or is a
 * single word with optional `@version` suffix.
 *
 * Only considers values in lines that mention dependency-related keywords
 * or contain a version number.
 *
 * @param {string[]} lines
 * @param {string} filePath
 * @param {object} [options]
 * @param {function} [options.excludeLine]
 * @param {Set} [options.claimedValues]
 * @returns {Array<{type: string, value: string, negated: boolean, source: object}>}
 */
function extractDependencyClaims(lines, filePath, options) {
  if (!options) options = {};
  var excludeLine = options.excludeLine || function () { return false; };
  var claimedValues = options.claimedValues || new Set();

  var claims = [];
  var currentSection = null;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Track current section
    var headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = headingMatch[2].trim();
    }

    if (excludeLine(i)) {
      continue;
    }

    // Only process lines that mention dependency-related keywords
    // or contain a version number (like @^, @~, or @ followed by digit)
    var hasDepKeyword = DEP_LINE_KEYWORD_RE.test(line);
    var hasVersionRef = /@[\d^~]/.test(line);

    if (!hasDepKeyword && !hasVersionRef) {
      continue;
    }

    var re = /`([^`]+)`/g;
    var match;

    while ((match = re.exec(line)) !== null) {
      var value = match[1];
      var matchIndex = match.index;
      var matchEnd = re.lastIndex;

      // Already claimed
      if (claimedValues.has(value)) {
        continue;
      }

      // Exclude template placeholders (containing <, >, {, or })
      if (value.indexOf('<') !== -1 || value.indexOf('>') !== -1 ||
          value.indexOf('{') !== -1 || value.indexOf('}') !== -1) {
        continue;
      }

      // Must not be a path or command (checked via claimedValues + additional filter)
      if (value.indexOf(' ') !== -1) {
        continue; // dependencies shouldn't have spaces
      }

      // Check @scope/name pattern
      var isScopeDep = /^@[\w-]+\/[\w.\-@^~]+$/.test(value);

      // Check single-word dependency pattern with optional @version suffix
      var isSingleDep = /^[\w.][\w.\-@^~]*$/.test(value) && value.indexOf('/') === -1;

      if (!isScopeDep && !isSingleDep) {
        continue;
      }

      // Exclude known non-dependency words
      if (!isScopeDep && NON_DEP_WORDS.has(value)) {
        continue;
      }

		// Exclude paths that have file extensions (even if we somehow missed them)
		if (FILE_EXT_RE.test(value) && !isScopeDep) {
			continue;
		}

		// Skip values with uppercase letters — real npm packages are always
		// lowercase. This catches camelCase variable names, PascalCase types,
		// and UPPER_CASE constants.
		if (!isScopeDep && /[A-Z]/.test(value)) {
			continue;
		}

		// --- Heuristic exclusions for common false-positive dependency patterns ---

		// Skip kebab-case values with 3+ hyphens and no version suffix.
		// These are rule IDs like `cli-no-db-direct`, not npm packages.
		if (!isScopeDep && value.indexOf('-') !== -1 && value.indexOf('@') === -1) {
			var hyphenCount = 0;
			for (var ci = 0; ci < value.length; ci++) {
				if (value[ci] === '-') hyphenCount++;
			}
			if (hyphenCount >= 3) continue;
		}

		// Skip dot-separated references that aren't scoped packages.
		// These are table.column refs like `analysis_runs.tool_versions`
		// or dotted property paths like `evidence.source.tool`.
		if (!isScopeDep && value.indexOf('.') !== -1 && value.indexOf('@') === -1) {
			continue;
		}

		var negated = isNegated(line, matchIndex, matchEnd);

		claims.push({
        type: 'dependency',
        value: value,
        negated: negated,
        source: {
          file: filePath,
          line: i + 1,
          section: currentSection,
        },
      });
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// extractLinkClaims
// ---------------------------------------------------------------------------

/**
 * Find markdown internal links (not external URLs, mailto, or anchors).
 *
 * Pattern matches `[text](target)` where target does not start with
 * `http://`, `https://`, `mailto:`, or `#`.
 *
 * @param {string[]} lines
 * @param {string} filePath
 * @param {object} [options]
 * @param {function} [options.excludeLine]
 * @returns {Array<{type: string, value: string, negated: boolean, source: object}>}
 */
function extractLinkClaims(lines, filePath, options) {
  if (!options) options = {};
  var excludeLine = options.excludeLine || function () { return false; };

  var claims = [];
  var currentSection = null;
  var re = /\[([^\]]*)\]\(((?!https?:\/\/)(?!mailto:)(?!#)[^)]+)\)/g;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Track current section
    var headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = headingMatch[2].trim();
    }

    if (excludeLine(i)) {
      continue;
    }

    var match;

    while ((match = re.exec(line)) !== null) {
      var linkText = match[1];
      var linkTarget = match[2];

      // Exclude empty link targets
      if (!linkTarget || linkTarget.trim().length === 0) {
        continue;
      }

      var negated = isNegated(line, match.index, re.lastIndex);

      claims.push({
        type: 'internal_link',
        value: linkTarget,
        negated: negated,
        source: {
          file: filePath,
          line: i + 1,
          section: currentSection,
        },
      });
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// extractRouteEdgeClaims
// ---------------------------------------------------------------------------

/**
 * Extract route edges from a parsed YAML frontmatter object.
 *
 * Looks for a `related:` field. The value can be a YAML array or a
 * single string. Each ID must match kebab-case pattern.
 *
 * @param {object} frontmatter — parsed frontmatter metadata object
 * @param {string} filePath
 * @returns {Array<{type: string, value: string, negated: boolean, source: object}>}
 */
function extractRouteEdgeClaims(frontmatter, filePath) {
  var claims = [];

  if (!frontmatter || typeof frontmatter !== 'object') {
    return claims;
  }

  var related = frontmatter.related;
  if (related === null || related === undefined) {
    return claims;
  }

  var ids = Array.isArray(related) ? related : [String(related)];

  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    if (typeof id === 'string' && KEBAB_CASE_RE.test(id)) {
      claims.push({
        type: 'route_edge',
        value: id,
        negated: false,
        source: {
          file: filePath,
          line: 1,
          section: 'frontmatter',
        },
      });
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// extractClaims (main entry point)
// ---------------------------------------------------------------------------

/**
 * Extract all structured claims from raw markdown content.
 *
 * Parses frontmatter, splits content into lines, excludes fenced code
 * blocks and HTML comments, then extracts claims in order:
 * paths → commands → dependencies → links → route edges.
 *
 * Later extractors skip values already claimed by earlier extractors to
 * prevent a single backtick value from appearing as multiple claim types.
 *
 * @param {string} content — raw markdown text
 * @param {string} filePath — source file path for attribution
 * @returns {Array<{type: string, value: string, negated: boolean, source: {file: string, line: number, section: string|null}}>}
 */
function extractClaims(content, filePath) {
  // Parse frontmatter
  var fm = matchFrontmatter(content);
  var frontmatter = fm ? parseFrontmatterYaml(fm.yaml) : {};

  var lines = content.split('\n');

  // Pre-compute excluded lines (code blocks, HTML comments)
  var lineExcluded = computeExcludedLines(lines);
  var excludeLine = function (i) { return lineExcluded[i]; };

  // Shared set to prevent duplicate values across claim types
  var claimedValues = new Set();

  // Extract in dependency order: paths → commands → dependencies
  var pathClaims = extractPathClaims(lines, filePath, {
    excludeLine: excludeLine,
    claimedValues: claimedValues,
  });
  pathClaims.forEach(function (c) { claimedValues.add(c.value); });

  var commandClaims = extractCommandClaims(lines, filePath, {
    excludeLine: excludeLine,
    claimedValues: claimedValues,
  });
  commandClaims.forEach(function (c) { claimedValues.add(c.value); });

  var dependencyClaims = extractDependencyClaims(lines, filePath, {
    excludeLine: excludeLine,
    claimedValues: claimedValues,
  });
  dependencyClaims.forEach(function (c) { claimedValues.add(c.value); });

  // Link claims use a different pattern (no backticks), so no overlap risk
  var linkClaims = extractLinkClaims(lines, filePath, {
    excludeLine: excludeLine,
  });

  // Route edge claims come from frontmatter (not line-based)
  var routeEdgeClaims = extractRouteEdgeClaims(frontmatter, filePath);

  return [].concat(
    pathClaims,
    commandClaims,
    dependencyClaims,
    linkClaims,
    routeEdgeClaims
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  extractClaims: extractClaims,
  extractPathClaims: extractPathClaims,
  extractCommandClaims: extractCommandClaims,
  extractDependencyClaims: extractDependencyClaims,
  extractLinkClaims: extractLinkClaims,
  extractRouteEdgeClaims: extractRouteEdgeClaims,
  resolveSection: resolveSection,
};
