// Plays many random games to shake out crashes and state inconsistencies.

import { describe, expect, it } from 'vitest';
import { applyInputMut, DEFAULT_AGE, legalOptions, newGame, type GameState, type Input } from '../src/engine';
import { checkInvariants } from './helpers';

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGame(seed: number, maxInputs: number): { state: GameState; inputs: Input[] } {
  const rand = rng(seed);
  const s = newGame(DEFAULT_AGE);
  const inputs: Input[] = [];
  for (let i = 0; i < maxInputs && !s.result; i++) {
    const pend = s.pending!;
    const opts = legalOptions(s);
    // Bias toward building and Undertaking so games actually develop.
    const builds = opts.filter((c) => typeof c.picks[0] === 'string' && c.picks[0] !== 'none');
    const pool = builds.length && rand() < 0.5 ? builds : opts;
    let input: Input;
    if (pend.kind === 'action' && pend.optional && rand() < 0.2) input = { type: 'skip', player: pend.player };
    else input = { type: 'choose', player: pend.player, cmd: pool[Math.floor(rand() * pool.length)] };
    inputs.push(input);
    applyInputMut(s, input);
    checkInvariants(s);
  }
  return { state: s, inputs };
}

describe('fuzz', () => {
  it('random games never crash and stay consistent', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const { state } = randomGame(seed, 300);
      // Either finished, or waiting on a decision — never stuck.
      if (!state.result) expect(state.pending).not.toBeNull();
    }
  }, 60_000);

  it('replaying an input log reproduces the state exactly', () => {
    const { state, inputs } = randomGame(99, 250);
    const replay = newGame(DEFAULT_AGE);
    for (const i of inputs) applyInputMut(replay, i);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(state));
  }, 30_000);
});
