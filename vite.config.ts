import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build is a single self-contained dist/index.html: playtesters
// can open it straight from disk (file://) with no server and no network.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  test: { include: ['tests/**/*.test.ts'] },
});
