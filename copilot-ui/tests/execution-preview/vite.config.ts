import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '../../lib/api/orchestrator',
        replacement: path.resolve(root, 'orchestratorPreviewApi.ts'),
      },
      {
        find: /[\\/]ui[\\/]src[\\/]lib[\\/]api[\\/]orchestrator(?:\.ts)?$/,
        replacement: path.resolve(root, 'orchestratorPreviewApi.ts'),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 4178,
  },
});
