import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(docsRoot, '..');

const defaultSiteBase = '/Elegy-copilot/';

export const githubRepoUrl = 'https://github.com/Sofreshx/Elegy-copilot';
export const githubSourceBase = `${githubRepoUrl}/blob/main`;
export const siteBase = normalizeBase(process.env.DOCS_BASE || defaultSiteBase);
export const routeRewrites = {
	'system/index.md': 'index.md',
};

const statusOrder = new Map([
	['current', 0],
	['draft', 1],
	['stale', 2],
	['archived', 3],
]);

const specialTitleCase = new Map([
	['adr', 'ADR'],
	['api', 'API'],
	['cli', 'CLI'],
	['copilot', 'Copilot'],
	['e2e', 'E2E'],
	['github', 'GitHub'],
	['llm', 'LLM'],
	['llms', 'LLMs'],
	['mcp', 'MCP'],
	['moc', 'MOC'],
	['opencode', 'OpenCode'],
	['sdk', 'SDK'],
	['tauri', 'Tauri'],
	['ui', 'UI'],
	['vs', 'VS'],
]);

function normalizeBase(value) {
	let base = String(value || defaultSiteBase).trim();
	if (!base.startsWith('/')) base = `/${base}`;
	if (!base.endsWith('/')) base = `${base}/`;
	return base;
}

function toPosix(filePath) {
	return filePath.split(path.sep).join('/');
}

function walkMarkdownFiles(dir) {
	/** @type {string[]} */
	const results = [];
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		if (entry.name === '.vitepress') continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name.startsWith('_')) continue;
			results.push(...walkMarkdownFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
			results.push(fullPath);
		}
	}
	return results;
}

function matchFrontmatter(text) {
	if (!text.startsWith('---')) return null;
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
	if (!match) return null;
	return { full: match[0], yaml: match[1] };
}

function parseInlineList(value) {
	const trimmed = value.trim();
	if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
	const inner = trimmed.slice(1, -1).trim();
	if (!inner) return [];
	return inner
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((item) => item.replace(/^['"]|['"]$/g, ''));
}

function parseFrontmatterYaml(yamlText) {
	/** @type {Record<string, any>} */
	const meta = {};
	const lines = yamlText.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const rawLine = lines[index];
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const colonIndex = line.indexOf(':');
		if (colonIndex <= 0) continue;
		const key = line.slice(0, colonIndex).trim();
		let value = line.slice(colonIndex + 1).trim();

		if (value === '') {
			/** @type {string[]} */
			const items = [];
			while (index + 1 < lines.length) {
				const next = lines[index + 1].trim();
				if (!next) {
					index++;
					continue;
				}
				if (!next.startsWith('-')) break;
				items.push(next.replace(/^[-\s]+/, '').trim().replace(/^['"]|['"]$/g, ''));
				index++;
			}
			meta[key] = items;
			continue;
		}

		const inlineList = parseInlineList(value);
		if (inlineList !== null) {
			meta[key] = inlineList;
			continue;
		}

		if (/^-?\d+$/.test(value)) {
			meta[key] = Number.parseInt(value, 10);
			continue;
		}

		meta[key] = value.replace(/^['"]|['"]$/g, '');
	}
	return meta;
}

function extractTitle(body, relPath) {
	const match = body.match(/^#\s+(.+)$/m);
	if (match) {
		return match[1].trim().replace(/\s+\{#[^}]+\}\s*$/, '');
	}
	return humanizeSlug(path.posix.basename(relPath, '.md'));
}

function humanizeSlug(value) {
	return value
		.split('-')
		.filter(Boolean)
		.map((segment) => specialTitleCase.get(segment.toLowerCase()) || `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
		.join(' ');
}

function rewriteDocsPath(relPath) {
	if (Object.prototype.hasOwnProperty.call(routeRewrites, relPath)) {
		return routeRewrites[relPath];
	}
	return relPath;
}

function docsRelToSitePath(relPath) {
	const rewritten = rewriteDocsPath(relPath).replace(/\\/g, '/');
	const withoutExtension = rewritten.replace(/\.md$/i, '');
	if (withoutExtension === 'index') return '/';
	if (withoutExtension.endsWith('/index')) {
		const section = withoutExtension.slice(0, -'/index'.length);
		return section ? `/${section}/` : '/';
	}
	return `/${withoutExtension}`;
}

function compareDocs(left, right) {
	const leftStatus = statusOrder.get(left.meta.status) ?? Number.MAX_SAFE_INTEGER;
	const rightStatus = statusOrder.get(right.meta.status) ?? Number.MAX_SAFE_INTEGER;
	if (leftStatus !== rightStatus) return leftStatus - rightStatus;
	return left.sidebarText.localeCompare(right.sidebarText);
}

function loadDocsCatalog() {
	const docs = walkMarkdownFiles(docsRoot).map((absolutePath) => {
		const relPath = toPosix(path.relative(docsRoot, absolutePath));
		const repoRelPath = `docs/${relPath}`;
		const text = fs.readFileSync(absolutePath, 'utf8');
		const frontmatter = matchFrontmatter(text);
		const meta = frontmatter ? parseFrontmatterYaml(frontmatter.yaml) : {};
		const body = frontmatter ? text.slice(frontmatter.full.length) : text;
		const title = extractTitle(body, relPath);
		const sidebarText = formatSidebarText({ relPath, meta, title });

		return {
			absPath: absolutePath,
			body,
			meta,
			relPath,
			repoRelPath,
			sidebarText,
			sitePath: docsRelToSitePath(relPath),
			title,
		};
	});

	docs.sort(compareDocs);
	return docs;
}

const docsCatalog = loadDocsCatalog();

function formatSidebarText({ relPath, meta, title }) {
	if (relPath === 'system/index.md') return 'System Index';
	if (relPath === 'research/index.md') return 'Research Index';

	let text = title.replace(/^MOC\s+[—-]\s+/, '');
	if (meta.doc_kind === 'redirect') {
		return `${text} (redirect)`;
	}
	if (meta.status && meta.status !== 'current') {
		text = `${text} (${meta.status})`;
	}
	return text;
}

function docToSidebarItem(doc) {
	return {
		text: doc.sidebarText,
		link: doc.sitePath,
	};
}

function buildSectionItems(docs, basePrefix) {
	const rootItems = [];
	/** @type {Map<string, { text: string; collapsed: boolean; items: { text: string; link: string }[] }>} */
	const groups = new Map();

	for (const doc of docs) {
		const relativeSectionPath = doc.relPath.startsWith(basePrefix)
			? doc.relPath.slice(basePrefix.length)
			: doc.relPath;
		const dirName = path.posix.dirname(relativeSectionPath);
		if (dirName === '.') {
			rootItems.push(docToSidebarItem(doc));
			continue;
		}

		const groupKey = dirName.split('/')[0];
		if (!groups.has(groupKey)) {
			groups.set(groupKey, {
				text: humanizeSlug(groupKey),
				collapsed: true,
				items: [],
			});
		}

		groups.get(groupKey).items.push(docToSidebarItem(doc));
	}

	return [
		...rootItems,
		...Array.from(groups.values()).sort((left, right) => left.text.localeCompare(right.text)),
	];
}

function buildCompatibilityItems(docs) {
	const rootItems = [];
	/** @type {Map<string, { text: string; collapsed: boolean; items: { text: string; link: string }[] }>} */
	const groups = new Map();

	function ensureGroup(key, text) {
		if (!groups.has(key)) {
			groups.set(key, { text, collapsed: true, items: [] });
		}
		return groups.get(key);
	}

	for (const doc of docs) {
		if (doc.meta.doc_kind === 'redirect') {
			ensureGroup('redirects', 'Compatibility Redirects').items.push(docToSidebarItem(doc));
			continue;
		}

		if (doc.relPath === 'backlog.md') {
			rootItems.push(docToSidebarItem(doc));
			continue;
		}

		if (doc.relPath.startsWith('planning/')) {
			ensureGroup('planning', 'Planning').items.push(docToSidebarItem(doc));
			continue;
		}

		if (doc.relPath.startsWith('roadmaps/')) {
			ensureGroup('roadmaps', 'Roadmaps').items.push(docToSidebarItem(doc));
			continue;
		}

		if (doc.relPath.startsWith('issues/')) {
			ensureGroup('issues', 'Issue Logs').items.push(docToSidebarItem(doc));
			continue;
		}

		if (doc.relPath.startsWith('system/')) {
			ensureGroup('archived-system', 'Archived System Docs').items.push(docToSidebarItem(doc));
			continue;
		}

		rootItems.push(docToSidebarItem(doc));
	}

	return [
		...rootItems,
		...Array.from(groups.values()).sort((left, right) => left.text.localeCompare(right.text)),
	];
}

export function buildNav() {
	return [
		{ text: 'System', link: '/' },
		{ text: 'Research', link: '/research/' },
	];
}

export function buildSidebar() {
	const systemIndex = docsCatalog.find((doc) => doc.relPath === 'system/index.md');
	const systemMocs = docsCatalog.filter((doc) => doc.relPath.startsWith('system/') && doc.meta.doc_kind === 'moc');
	const canonicalSystemDocs = docsCatalog.filter(
		(doc) =>
			doc.relPath.startsWith('system/') &&
			doc.meta.doc_kind === 'node' &&
			doc.relPath !== 'system/index.md' &&
			doc.meta.status !== 'archived'
	);
	const researchDocs = docsCatalog.filter((doc) => doc.relPath.startsWith('research/'));
	const compatibilityDocs = docsCatalog.filter(
		(doc) =>
			doc.meta.doc_kind === 'redirect' ||
			doc.relPath === 'backlog.md' ||
			doc.relPath.startsWith('planning/') ||
			doc.relPath.startsWith('roadmaps/') ||
			doc.relPath.startsWith('issues/') ||
			(doc.relPath.startsWith('system/') && doc.meta.status === 'archived')
	);

	const sidebar = [];
	if (systemIndex) {
		sidebar.push({
			text: 'Start Here',
			items: [docToSidebarItem(systemIndex)],
		});
	}
	if (systemMocs.length > 0) {
		sidebar.push({
			text: 'MOCs',
			items: systemMocs.map(docToSidebarItem),
		});
	}
	if (canonicalSystemDocs.length > 0) {
		sidebar.push({
			text: 'Canonical System Docs',
			items: buildSectionItems(canonicalSystemDocs, 'system/'),
		});
	}
	if (researchDocs.length > 0) {
		sidebar.push({
			text: 'Research Notes',
			items: buildSectionItems(researchDocs, 'research/'),
		});
	}
	if (compatibilityDocs.length > 0) {
		sidebar.push({
			text: 'Planning & Compatibility',
			collapsed: true,
			items: buildCompatibilityItems(compatibilityDocs),
		});
	}

	return sidebar;
}

function isExternalHref(href) {
	return /^(?:[a-z][a-z+.-]*:)?\/\//i.test(href) || /^(?:mailto|tel):/i.test(href);
}

function splitHref(href) {
	const hashIndex = href.indexOf('#');
	if (hashIndex === -1) {
		return { pathPart: href, hash: '' };
	}
	return {
		pathPart: href.slice(0, hashIndex),
		hash: href.slice(hashIndex),
	};
}

function normalizeRepoRelativePath(filePath) {
	const normalized = path.posix.normalize(filePath.replace(/\\/g, '/'));
	if (normalized.startsWith('../')) return null;
	return normalized.replace(/^\.\//, '');
}


function fileExistsAtRepoPath(repoPath) {
	if (!repoPath) return false;
	const absolutePath = path.join(repoRoot, repoPath);
	return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
}

function buildRepoTargetCandidates(currentRelativePath, hrefPath) {
	/** @type {string[]} */
	const candidates = [];
	const addCandidate = (candidate) => {
		const normalized = normalizeRepoRelativePath(candidate);
		if (!normalized || candidates.includes(normalized)) return;
		candidates.push(normalized);
	};

	if (!currentRelativePath) return candidates;

	if (hrefPath.startsWith('/docs/')) {
		addCandidate(hrefPath.slice(1));
		return candidates;
	}
	if (hrefPath.startsWith('docs/')) {
		addCandidate(hrefPath);
		return candidates;
	}
	if (hrefPath.startsWith('/')) {
		addCandidate(hrefPath.slice(1));
		return candidates;
	}

	const currentRepoPath = `docs/${currentRelativePath}`;
	const currentDir = path.posix.dirname(currentRepoPath);
	addCandidate(path.posix.join(currentDir, hrefPath));

	if (hrefPath.startsWith('../')) {
		addCandidate(path.posix.join('docs', hrefPath));
	}

	if (!hrefPath.startsWith('.')) {
		addCandidate(hrefPath);
	}

	return candidates;
}


function resolveDocsMarkdownTarget(repoTarget, { requireExisting = true } = {}) {
	if (!repoTarget || !repoTarget.startsWith('docs/')) return null;
	const candidates = [repoTarget];

	if (!path.posix.extname(repoTarget)) {
		candidates.push(`${repoTarget}.md`, `${repoTarget}/index.md`);
	}
	if (repoTarget.endsWith('.html')) {
		candidates.push(repoTarget.replace(/\.html$/i, '.md'));
	}

	for (const candidate of candidates) {
		if (fileExistsAtRepoPath(candidate)) {
			return candidate;
		}
	}

	if (!requireExisting) {
		return candidates.find((candidate) => candidate.endsWith('.md')) || null;
	}

	return null;
}

export function rewriteMarkdownHref(currentRelativePath, href) {
	if (!href || href.startsWith('#') || isExternalHref(href)) return href;

	const { pathPart, hash } = splitHref(href);
	if (!pathPart) return href;

	const repoTargets = buildRepoTargetCandidates(currentRelativePath, pathPart);
	let fallbackDocsTarget = null;
	let fallbackRepoSourceTarget = null;

	for (const repoTarget of repoTargets) {
		const docsTarget = resolveDocsMarkdownTarget(repoTarget);
		if (docsTarget) {
			return `${docsRelToSitePath(docsTarget.slice('docs/'.length))}${hash}`;
		}

		if (!fallbackDocsTarget) {
			fallbackDocsTarget = resolveDocsMarkdownTarget(repoTarget, { requireExisting: false });
		}

		if (!repoTarget.startsWith('docs/') && !fallbackRepoSourceTarget) {
			fallbackRepoSourceTarget = repoTarget;
		}

		if (fileExistsAtRepoPath(repoTarget)) {
			return `${githubSourceBase}/${repoTarget}${hash}`;
		}
	}

	if (fallbackRepoSourceTarget) {
		return `${githubSourceBase}/${fallbackRepoSourceTarget}${hash}`;
	}

	if (fallbackDocsTarget) {
		return `${docsRelToSitePath(fallbackDocsTarget.slice('docs/'.length))}${hash}`;
	}

	return href;
}

export function configureDocsMarkdown(md) {
	const defaultFence = md.renderer.rules.fence;
	md.renderer.rules.fence = (tokens, index, options, env, self) => {
		const token = tokens[index];
		const fenceInfo = token.info.trim().split(/\s+/, 1)[0];
		if (fenceInfo === 'mermaid') {
			const graph = encodeURIComponent(token.content);
			return `<MermaidBlock graph="${graph}" />\n`;
		}

		return defaultFence ? defaultFence(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
	};

	const defaultLinkOpen = md.renderer.rules.link_open;
	md.renderer.rules.link_open = (tokens, index, options, env, self) => {
		const token = tokens[index];
		const hrefIndex = token.attrIndex('href');
		if (hrefIndex >= 0) {
			const currentHref = token.attrs[hrefIndex][1];
			token.attrs[hrefIndex][1] = rewriteMarkdownHref(env?.relativePath, currentHref);
		}

		return defaultLinkOpen ? defaultLinkOpen(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
	};

	md.core.ruler.after('inline', 'hide-doc-wikilinks', (state) => {
		for (const token of state.tokens) {
			if (token.type !== 'inline' || !token.children) continue;

			/** @type {import('markdown-it/lib/token.mjs')[]} */
			const nextChildren = [];
			for (const child of token.children) {
				if (child.type !== 'text' || !child.content.includes('[[')) {
					nextChildren.push(child);
					continue;
				}

				let lastIndex = 0;
				const wikiRegex = /\[\[([^\]]+)\]\]/g;
				let match;
				while ((match = wikiRegex.exec(child.content))) {
					const index = match.index ?? 0;
					if (index > lastIndex) {
						const textToken = new state.Token('text', '', 0);
						textToken.content = child.content.slice(lastIndex, index);
						nextChildren.push(textToken);
					}

					const htmlToken = new state.Token('html_inline', '', 0);
					htmlToken.content = `<span class="docs-wikilink" data-doc-id="${md.utils.escapeHtml(match[1].trim())}" aria-hidden="true"></span>`;
					nextChildren.push(htmlToken);
					lastIndex = index + match[0].length;
				}

				if (lastIndex < child.content.length) {
					const textToken = new state.Token('text', '', 0);
					textToken.content = child.content.slice(lastIndex);
					nextChildren.push(textToken);
				}
			}

			token.children = nextChildren;
		}
	});
}
