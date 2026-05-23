import { defineConfig } from 'vitepress';

import {
	buildNav,
	buildSidebar,
	configureDocsMarkdown,
	githubRepoUrl,
	routeRewrites,
	siteBase,
} from './lib/docs-site.mjs';

export default defineConfig({
	lang: 'en-US',
	title: 'Elegy Copilot Docs',
	description: 'Browsable static site for the Elegy Copilot documentation graph.',
	base: siteBase,
	cleanUrls: true,
	rewrites: routeRewrites,
	markdown: {
		lineNumbers: true,
		config: (md) => {
			configureDocsMarkdown(md);
		},
	},
	themeConfig: {
		nav: buildNav(),
		sidebar: buildSidebar(),
		outline: 'deep',
		search: {
			provider: 'local',
		},
		socialLinks: [{ icon: 'github', link: githubRepoUrl }],
	},
});
