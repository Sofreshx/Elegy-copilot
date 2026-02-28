import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'ui-dist'),
    emptyOutDir: true,
  },
});
