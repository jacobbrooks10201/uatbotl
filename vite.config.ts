import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** After each successful build, keep a dated copy of dist/index.html in archive/. */
function archiveBuild(): Plugin {
  let outDir = 'dist';
  return {
    name: 'uatbotl-archive-build',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    // writeBundle only runs once the output has been written without errors.
    writeBundle() {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      const dir = resolve(import.meta.dirname, 'archive');
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, `index-${stamp}.html`);
      copyFileSync(join(outDir, 'index.html'), dest);
      this.info(`archived → archive/index-${stamp}.html`);
    },
  };
}

// The production build is a single self-contained dist/index.html: playtesters
// can open it straight from disk (file://) with no server and no network.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), archiveBuild()],
  test: { include: ['tests/**/*.test.ts'] },
});
