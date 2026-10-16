// Board geometry: squares, directions, range parsing (spec §8, §15.3).

import type { DirSet, RangeSpec, Sq } from './types';

export type Vec = readonly [number, number]; // [dFile, dRank]

export const ALL_DIRS: readonly Vec[] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

/** `fw` is +1 (toward rank 16) or -1 (toward rank 1). */
export function dirSet(set: DirSet, fw: number): Vec[] {
  switch (set) {
    case 'eight':
      return [...ALL_DIRS];
    case 'orthogonal':
      return [
        [0, 1],
        [1, 0],
        [0, -1],
        [-1, 0],
      ];
    case 'diagonal':
      return [
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ];
    case 'forward':
      return [[0, fw]];
    case 'horizontal':
      return [
        [1, 0],
        [-1, 0],
      ];
    case 'vertical':
      return [
        [0, 1],
        [0, -1],
      ];
  }
}

export type Range =
  | { k: 'area'; n: number; inc: boolean }
  | { k: 'rays'; set: DirSet; limit: number }
  | { k: 'jump'; jumps: (fw: number) => Vec[] };

const KNIGHT: Vec[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const DIRSET_NAMES: readonly DirSet[] = ['eight', 'orthogonal', 'diagonal', 'forward', 'horizontal', 'vertical'];

const cache = new Map<string, Range>();

export function parseRange(spec: RangeSpec): Range {
  const hit = cache.get(spec);
  if (hit) return hit;
  const r = parseRangeUncached(spec);
  cache.set(spec, r);
  return r;
}

function parseRangeUncached(spec: RangeSpec): Range {
  if (spec === 'adjacent') return { k: 'area', n: 1, inc: false };
  let m = /^range(\d+)(inc)?$/.exec(spec);
  if (m) return { k: 'area', n: Number(m[1]), inc: !!m[2] };
  if (spec === 'queensmove') return { k: 'rays', set: 'eight', limit: Infinity };
  if (spec === 'rooksmove') return { k: 'rays', set: 'orthogonal', limit: Infinity };
  if (spec === 'bishopsmove') return { k: 'rays', set: 'diagonal', limit: Infinity };
  if (spec === 'knightsmove') return { k: 'jump', jumps: () => KNIGHT };
  m = /^forwardjump(\d+)$/.exec(spec);
  if (m) {
    const n = Number(m[1]);
    return { k: 'jump', jumps: (fw) => [[0, n * fw]] };
  }
  m = /^triforwardjump(\d+)$/.exec(spec);
  if (m) {
    const n = Number(m[1]);
    return {
      k: 'jump',
      jumps: (fw) => [
        [-n, n * fw],
        [0, n * fw],
        [n, n * fw],
      ],
    };
  }
  m = /^([a-z]+?)(\d+)?$/.exec(spec);
  if (m && (DIRSET_NAMES as readonly string[]).includes(m[1])) {
    return { k: 'rays', set: m[1] as DirSet, limit: m[2] ? Number(m[2]) : Infinity };
  }
  throw new Error(`Unknown range spec: ${spec}`);
}

/** Board width × height. Width is files (a, b, …), height is ranks (1, 2, …). */
export class Geo {
  readonly squares: number;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.squares = width * height;
  }

  sq(f: number, r: number): Sq {
    return r * this.width + f;
  }
  file(s: Sq): number {
    return s % this.width;
  }
  rank(s: Sq): number {
    return Math.floor(s / this.width);
  }
  inBounds(f: number, r: number): boolean {
    return f >= 0 && r >= 0 && f < this.width && r < this.height;
  }
  /** Square offset by a vector, or null if off the board. */
  step(s: Sq, v: Vec, times = 1): Sq | null {
    const f = this.file(s) + v[0] * times;
    const r = this.rank(s) + v[1] * times;
    return this.inBounds(f, r) ? this.sq(f, r) : null;
  }
  dist(a: Sq, b: Sq): number {
    return Math.max(Math.abs(this.file(a) - this.file(b)), Math.abs(this.rank(a) - this.rank(b)));
  }
  name(s: Sq): string {
    return String.fromCharCode(97 + this.file(s)) + (this.rank(s) + 1);
  }
  parse(name: string): Sq {
    const m = /^([a-z])(\d+)$/.exec(name);
    if (!m) throw new Error(`Bad square: ${name}`);
    const f = m[1].charCodeAt(0) - 97;
    const r = Number(m[2]) - 1;
    if (!this.inBounds(f, r)) throw new Error(`Square off board: ${name}`);
    return this.sq(f, r);
  }
  /** Unit direction from a to b if they share a rank, file, or diagonal. */
  dirTo(a: Sq, b: Sq): Vec | null {
    const df = this.file(b) - this.file(a);
    const dr = this.rank(b) - this.rank(a);
    if (df === 0 && dr === 0) return null;
    if (df !== 0 && dr !== 0 && Math.abs(df) !== Math.abs(dr)) return null;
    return [Math.sign(df), Math.sign(dr)];
  }
  /** Board half of a square: 0 or 1. On an odd height the middle rank belongs to player 1's half. */
  half(s: Sq): 0 | 1 {
    return this.rank(s) < Math.floor(this.height / 2) ? 0 : 1;
  }
  area(s: Sq, n: number, inc: boolean): Sq[] {
    const out: Sq[] = [];
    const f0 = this.file(s);
    const r0 = this.rank(s);
    for (let dr = -n; dr <= n; dr++) {
      for (let df = -n; df <= n; df++) {
        if (!inc && df === 0 && dr === 0) continue;
        if (this.inBounds(f0 + df, r0 + dr)) out.push(this.sq(f0 + df, r0 + dr));
      }
    }
    return out;
  }
}
