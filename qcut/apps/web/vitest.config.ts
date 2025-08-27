import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '*.config.ts',
        '**/*.d.ts',
        'src/routes/**', // Router generated files
        'src/routeTree.gen.ts',
      ],
    },
    // alias is configured under top-level resolve.alias
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
});