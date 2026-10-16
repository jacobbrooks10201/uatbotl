import { describe, expect, it } from 'vitest';
import {
  applyInput,
  applyInputMut,
  DEFAULT_AGE,
  formatNotation,
  legalOptions,
  newGame,
  parseNotation,
  rulesFor,
  type GameOptions,
  type GameState,
  type Input,
} from '../src/engine';
import { optionTexts } from '../src/engine/notation';
import { play, R, scenario } from './helpers';

const K0 = { owner: 0 as const, unit: 'king', at: 'a1' };
const Q0 = { owner: 0 as const, unit: 'queen', at: 'c1' };
const K1 = { owner: 1 as const, unit: 'king', at: 'p16' };
const Q1 = { owner: 1 as const, unit: 'queen', at: 'n16' };

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random game; checks at every decision that no two options read the same. */
function randomGame(seed: number, n: number, opts: GameOptions = {}): { state: GameState; inputs: Input[] } {
  const rand = rng(seed);
  const s = newGame(DEFAULT_AGE, opts);
  const RR = rulesFor(s);
  const inputs: Input[] = [];
  for (let i = 0; i < n && !s.result; i++) {
    const pend = s.pending!;
    const all = legalOptions(s);
    const texts = optionTexts(RR, s, all).map((t) => t[0]);
    expect(new Set(texts).size, `duplicate option text at input ${i}: ${texts.join(' ')}`).toBe(texts.length);
    const builds = all.filter((c) => typeof c.picks[0] === 'string' && c.picks[0] !== 'none');
    const pool = builds.length && rand() < 0.5 ? builds : all;
    const input: Input =
      pend.kind === 'action' && pend.optional && rand() < 0.3
        ? { type: 'skip', player: pend.player }
        : { type: 'choose', player: pend.player, cmd: pool[Math.floor(rand() * pool.length)] };
    inputs.push(input);
    applyInputMut(s, input);
  }
  return { state: s, inputs };
}

function roundTrip(state: GameState): void {
  const text = formatNotation(state);
  const parsed = parseNotation(text, DEFAULT_AGE);
  expect(formatNotation(parsed.state)).toBe(text);
  // Same game, not just the same text: replaying the parsed inputs gives the identical state.
  const replay = newGame(DEFAULT_AGE, parsed.options);
  for (const i of parsed.inputs) applyInputMut(replay, i);
  expect(JSON.stringify(replay.pieces)).toBe(JSON.stringify(state.pieces));
  expect(JSON.stringify(replay.tiles)).toBe(JSON.stringify(state.tiles));
  expect(replay.result).toEqual(state.result);
  expect(replay.pending).toEqual(state.pending);
  expect(replay.turn).toBe(state.turn);
}

describe('notation', () => {
  it('reads like chess: board size, numbered rounds, one turn per side', () => {
    let s = newGame(DEFAULT_AGE);
    s = play(s, 'g1', 0, ['g4', 'k8']);
    s = play(s, 'h16', 0, ['h15']);
    s = play(s, 'i1', 0, ['i2']);
    expect(formatNotation(s)).toBe('16x16 1. Qg4@k8 Kh15 2. Ki2');
  });

  it('marks deaths, Kings and the result', () => {
    const s0 = scenario({ pieces: [K0, Q0, { ...K1, at: 'c9', hp: 1 }, Q1] });
    const s1 = play(s0, 'c1', 2, ['c9']);
    expect(formatNotation(s1)).toBe('16x16 1. Q*c9## 1-0');
  });

  it('writes tile activations, area kills and displacement', () => {
    const s0 = scenario({
      pieces: [
        K0,
        Q0,
        K1,
        Q1,
        { owner: 0, unit: 'dgate', at: 'e3' },
        { owner: 0, unit: 'trapthrower', at: 'e4' },
        { owner: 1, unit: 'warrior', at: 'e6' },
        { owner: 1, unit: 'warrior', at: 'f7' },
      ],
    });
    expect(formatNotation(play(s0, 'e4', 1, ['e6']))).toBe('16x16 1. TtBue6!Bu##f7');

    const d0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'dgate', at: 'e3' }, { owner: 0, unit: 'trailblazer', at: 'e5' }],
    });
    let d = play(d0, 'e5', 0, ['e6']);
    d = play(d, 'p16', 0, ['o15']);
    d = play(d, 'e6', 1, ['e5']);
    d = play(d, null, -2, ['d6']);
    expect(formatNotation(d)).toBe('16x16 1. Tbe6Dp Ko15 2. Tbe5!Dpd6');
  });

  it('pushes show the direction; prelude actions come before |', () => {
    const s0 = scenario({ pieces: [{ ...K0, at: 'e4' }, Q0, K1, Q1, { owner: 0, at: 'f4' }] });
    expect(formatNotation(play(s0, 'e4', 3, ['f4', 'g5']))).toBe('16x16 1. K>f4g5');
    const v0 = scenario({
      active: 1,
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'vaulter', at: 'e4' }, { owner: 1, unit: 'warrior', at: 'e9' }],
    });
    const v1 = play(play(v0, 'p16', 0, ['o15']), 'a1', 0, ['a2']);
    expect(formatNotation(v1)).toBe('16x16 1... Ko15 2. Va*e9#|Ka2');
  });

  it('Self-Execute continues the token; declining writes ∅', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'warrior', at: 'e4' }],
      tiles: [{ tile: 'selfexecute', at: 'e5' }],
    });
    const s1 = play(s0, 'e4', 0, ['e5']);
    expect(formatNotation(play(s1, 'e5', 0, ['e6']))).toBe('16x16 1. Wae5!SxWae6');
    expect(formatNotation(applyInput(s1, { type: 'skip', player: 0 }))).toBe('16x16 1. Wae5!Sx-');
  });

  it('disambiguates units that share a glyph by origin file, then rank', () => {
    const s0 = scenario({
      pieces: [
        K0,
        Q0,
        K1,
        Q1,
        { owner: 0, unit: 'warrior', at: 'd4' },
        { owner: 0, unit: 'warrior', at: 'f4' },
        { owner: 0, unit: 'warrior', at: 'f6' },
      ],
    });
    expect(formatNotation(play(s0, 'd4', 0, ['e5']))).toBe('16x16 1. Wade5');
    expect(formatNotation(play(s0, 'f4', 0, ['e5']))).toBe('16x16 1. Waf4e5'); // shares file with f6, rank with d4
    expect(formatNotation(play(s0, 'f6', 0, ['e5']))).toBe('16x16 1. Wa6e5');
    expect(formatNotation(play(s0, 'f4', 0, ['g3']))).toBe('16x16 1. Wag3');
  });

  it('every unit and tile has a unique, letters-only notation code', () => {
    const syms = [...R.age.units.map((u) => u.sym ?? u.glyph), ...R.age.tiles.map((t) => t.sym)];
    expect(new Set(syms).size).toBe(syms.length);
    for (const c of syms) expect(c).toMatch(/^[A-Za-z]+$/);
  });

  it('notation and the log are plain typable ASCII; notation has no brackets', () => {
    const { state } = randomGame(4242, 200);
    const text = formatNotation(state);
    for (const e of state.log) expect(e.text).toMatch(/^[\x20-\x7e]+$/);
    expect(text).toMatch(/^[\x20-\x7e]+$/);
    expect(text).not.toMatch(/[()[\]{}<]/);
  });

  it('random games survive notation → parse → replay, on several board sizes', () => {
    const sizes: GameOptions[] = [{}, { width: 8, height: 8 }, { width: 12, height: 12 }];
    sizes.forEach((opts, k) => {
      for (let seed = 1; seed <= 8; seed++) roundTrip(randomGame(500 * k + seed, 250, opts).state);
    });
  }, 120_000);

  it('resignation and agreed draws round-trip from the result alone', () => {
    const { state } = randomGame(77, 40);
    if (state.result) return;
    roundTrip(applyInput(state, { type: 'resign', player: state.active }));
    const offered = applyInput(state, { type: 'offerDraw', player: state.active });
    roundTrip(applyInput(offered, { type: 'acceptDraw', player: state.active === 0 ? 1 : 0 }));
  });

  it('text cut between rounds still reads, even just before forced steps', () => {
    const { state } = randomGame(4242, 200);
    const rounds = formatNotation(state).split(/ (?=\d+\. )/);
    for (let i = 1; i < rounds.length; i += 7) {
      const cut = rounds.slice(0, i).join(' ');
      expect(formatNotation(parseNotation(cut, DEFAULT_AGE).state).startsWith(cut)).toBe(true);
    }
  }, 60_000);

  it('rejects text that is not a game', () => {
    expect(() => parseNotation('16x16 1. Kz9', DEFAULT_AGE)).toThrow();
    expect(() => parseNotation('1. Qg4@k8', DEFAULT_AGE)).toThrow();
  });
});
