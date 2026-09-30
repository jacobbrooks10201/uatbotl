// Range resolution against a board state (spec §8).

import { dirSet, parseRange, type Vec } from './geometry';
import { pieceAt, type Rules } from './rules';
import type { GameState, Piece, RangeSpec, Sq } from './types';

/** Empty squares a piece can move to from `from` (clear path for area ranges). */
export function moveDests(R: Rules, s: GameState, from: Sq, spec: RangeSpec, fw: number): Sq[] {
  const g = R.geo;
  const rng = parseRange(spec);
  const out: Sq[] = [];
  switch (rng.k) {
    case 'rays':
      for (const v of dirSet(rng.set, fw)) {
        let cur: Sq | null = from;
        for (let i = 0; i < rng.limit; i++) {
          cur = g.step(cur, v);
          if (cur === null || s.board[cur] !== null) break;
          out.push(cur);
        }
      }
      return out;
    case 'jump':
      for (const v of rng.jumps(fw)) {
        const t = g.step(from, v);
        if (t !== null && s.board[t] === null) out.push(t);
      }
      return out;
    case 'area': {
      // BFS through empty squares, at most n steps.
      const seen = new Set<Sq>([from]);
      let frontier: Sq[] = [from];
      for (let d = 0; d < rng.n; d++) {
        const next: Sq[] = [];
        for (const q of frontier) {
          for (const nb of g.area(q, 1, false)) {
            if (seen.has(nb) || s.board[nb] !== null) continue;
            seen.add(nb);
            next.push(nb);
            out.push(nb);
          }
        }
        frontier = next;
      }
      return out;
    }
  }
}

/**
 * Squares "in range" for placement (Build, Lay, Relocate destinations...).
 * Area and jump ranges ignore occupancy; ray ranges stop before the first piece.
 */
export function rangeSquares(R: Rules, s: GameState, from: Sq, spec: RangeSpec, fw: number): Sq[] {
  const g = R.geo;
  const rng = parseRange(spec);
  switch (rng.k) {
    case 'area':
      return g.area(from, rng.n, rng.inc);
    case 'jump':
      return rng.jumps(fw).flatMap((v) => {
        const t = g.step(from, v);
        return t === null ? [] : [t];
      });
    case 'rays':
      return moveDests(R, s, from, spec, fw);
  }
}

/** Occupied squares targetable by a range-limited Attack. Rays target the first piece only (§8.3). */
export function attackTargets(R: Rules, s: GameState, from: Sq, spec: RangeSpec, fw: number): Sq[] {
  const g = R.geo;
  const rng = parseRange(spec);
  if (rng.k === 'rays') {
    const out: Sq[] = [];
    for (const v of dirSet(rng.set, fw)) {
      let cur: Sq | null = from;
      for (let i = 0; i < rng.limit; i++) {
        cur = g.step(cur, v);
        if (cur === null) break;
        if (s.board[cur] !== null) {
          out.push(cur);
          break;
        }
      }
    }
    return out;
  }
  return rangeSquares(R, s, from, spec, fw).filter((q) => s.board[q] !== null);
}

/** First piece along a ray from `from` (exclusive), or null. */
export function castRay(R: Rules, s: GameState, from: Sq, v: Vec): Piece | null {
  let cur: Sq | null = from;
  for (;;) {
    cur = R.geo.step(cur, v);
    if (cur === null) return null;
    const p = pieceAt(s, cur);
    if (p) return p;
  }
}

/** Shot damage including Shotboost on every square passed over, up to and including the target's (§8.3). */
export function shotDamage(R: Rules, s: GameState, from: Sq, target: Sq, base: number): number {
  const v = R.geo.dirTo(from, target);
  if (!v) return base;
  let dmg = base;
  let cur: Sq | null = from;
  while (cur !== null && cur !== target) {
    cur = R.geo.step(cur, v);
    if (cur === null) break;
    const t = s.tiles[cur];
    if (t) dmg += R.tile(t.def).shotboost ?? 0;
  }
  return dmg;
}

export interface PushPlan {
  /** Final squares of every piece that moved, keyed by uid. */
  moves: Map<string, Sq>;
}

/**
 * Plan a cascading push (§15.1 Push). Moves step by step; the board edge or an
 * immovable (reinforced) piece anywhere in the chain stops it.
 */
export function planPush(R: Rules, s: GameState, target: Sq, v: Vec, dist: number): PushPlan {
  const g = R.geo;
  const board = s.board.slice();
  const start = new Map<string, Sq>();
  let cur: Sq = target;
  for (let step = 0; step < dist; step++) {
    const chain: Sq[] = [];
    let q: Sq | null = cur;
    while (q !== null && board[q] !== null) {
      chain.push(q);
      q = g.step(q, v);
    }
    if (q === null) break; // board edge
    if (chain.some((c) => s.pieces[board[c]!]?.reinforced)) break; // immovable
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = chain[i];
      const uid = board[c]!;
      if (!start.has(uid)) start.set(uid, c);
      const to = g.step(c, v)!;
      board[to] = uid;
      board[c] = null;
    }
    cur = g.step(cur, v)!;
  }
  const moves = new Map<string, Sq>();
  for (let i = 0; i < board.length; i++) {
    const uid = board[i];
    if (uid && start.has(uid) && start.get(uid) !== i) moves.set(uid, i);
  }
  return { moves };
}
