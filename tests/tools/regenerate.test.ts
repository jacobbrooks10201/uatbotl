// Regenerates games/every-unit.txt. Skipped in normal test runs:
//   VITE_REGEN=1 npx vitest run tests/tools/regenerate.test.ts

import { expect, it } from 'vitest';
import { generateEveryUnitGame } from './everyUnitGame';

declare const require: (m: 'node:fs') => { writeFileSync(path: string, data: string): void };

it.skipIf(!import.meta.env.VITE_REGEN)('regenerate games/every-unit.txt', () => {
  const { text, missing, acted, log } = generateEveryUnitGame();
  const fs = require('node:fs');
  fs.writeFileSync('games/every-unit.txt', `${text}\n`);
  fs.writeFileSync('/tmp/claude-1000/-home-jacob-repos-uatbotl/4f14e8d5-48b0-41ed-8b0a-a5e78f8c5ac4/scratchpad/every-unit.summary.txt', `missing: ${missing.join(' ')}\nacted: ${acted.join(' ')}\nbuilt: ${log.join(' ')}\n`);
  expect(missing).toEqual([]);
}, 600_000);
