import { defineConfig } from 'vitest/config';

// `base: './'` keeps the production build relocatable, so dist/ can be opened
// from any static host (or a subfolder) for offline playtesting.
export default defineConfig({
  base: './',
  test: { include: ['tests/**/*.test.ts'] },
});
