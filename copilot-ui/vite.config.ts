import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devApiTarget = process.env.COPILOT_UI_DEV_API_URL || 'http://127.0.0.1:3210';

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: devApiTarget,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'ui-dist'),
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: path.resolve(__dirname, 'tests/vitest.setup.ts'),
    include: ['../tests/**/*.vitest.ts', '../tests/**/*.vitest.tsx', '../ui/src/views/Workspace/*.test.tsx', '../ui/src/views/Catalog/*.test.tsx'],
    clearMocks: true,
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
