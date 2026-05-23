import DefaultTheme from 'vitepress/theme';

import MermaidBlock from './MermaidBlock.vue';
import './custom.css';

export default {
	extends: DefaultTheme,
	enhanceApp({ app }) {
		app.component('MermaidBlock', MermaidBlock);
	},
};
