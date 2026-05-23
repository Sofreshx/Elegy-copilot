<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
	graph: {
		type: String,
		required: true,
	},
});

const container = ref(null);
const error = ref('');
const source = computed(() => decodeURIComponent(props.graph));

let mermaidPromise;
let themeObserver;
let renderVersion = 0;

function currentMermaidTheme() {
	return document.documentElement.classList.contains('dark') ? 'dark' : 'default';
}

function loadMermaid() {
	if (!mermaidPromise) {
		mermaidPromise = import('mermaid').then((module) => module.default);
	}
	return mermaidPromise;
}

async function renderDiagram() {
	if (!container.value || typeof window === 'undefined') return;

	const version = ++renderVersion;
	error.value = '';

	try {
		const mermaid = await loadMermaid();
		mermaid.initialize({
			startOnLoad: false,
			theme: currentMermaidTheme(),
		});

		const id = `docs-mermaid-${version}`;
		const { svg, bindFunctions } = await mermaid.render(id, source.value);
		if (version !== renderVersion || !container.value) return;

		container.value.innerHTML = svg;
		bindFunctions?.(container.value);
	} catch (reason) {
		if (version !== renderVersion) return;
		if (container.value) {
			container.value.innerHTML = '';
		}
		error.value = reason instanceof Error ? reason.message : 'Mermaid failed to render this diagram.';
	}
}

onMounted(async () => {
	await nextTick();
	await renderDiagram();

	themeObserver = new MutationObserver(() => {
		void renderDiagram();
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class'],
	});
});

onBeforeUnmount(() => {
	themeObserver?.disconnect();
	++renderVersion;
});
</script>

<template>
	<div class="docs-mermaid-block">
		<div ref="container" class="docs-mermaid-canvas" />
		<div v-if="error" class="docs-mermaid-error">
			<p>Mermaid diagram could not be rendered.</p>
			<pre>{{ source }}</pre>
			<p>{{ error }}</p>
		</div>
	</div>
</template>
