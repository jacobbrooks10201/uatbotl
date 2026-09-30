// Enumeration of fully-specified legal choices (spec §15.1).
//
// Every option is a Command: the acting piece, the action slot, and a list of
// picks. The UI narrows options pick by pick; the engine validates an input by
// looking its key up in this list. Picks per keyword:
//
//   move / pave            [to]
//   attack / shoot / lay   [square]
//   build                  [defId, square]
//   push / stonepush       [pieceSq, squareOneStepInPushDirection]
//   undertaking            [to, stoneSq | 'none']
//   castle                 [kingSq]
//   relocate / reallocate  [fromSq, toSq]
//   moveattack             [to, targetSq]
//   shelter / shield       []
//   reinforce              [stoneSq]

import { ALL_DIRS, dirSet, type Vec } from './geometry';
import {
  affordable,
  budgetFor,
  buildablesFor,
  findRole,
  forwardOf,
  pieceAt,
  rulesFor,
  tileAllowedAt,
  unitDef,
  unitsOf,
  type Rules,
} from './rules';
import { attackTargets, castRay, moveDests, planPush, rangeSquares } from './targeting';
import type { ActionSpec, Command, GameState, Piece, PlayerId, Sq } from './types';

export interface EnumOpts {
  /** For undertaking: allow move-only outcomes when no full outcome exists. */
  fallback?: boolean;
  /** Player making the choice (budget owner for builds). */
  player: PlayerId;
}

export function commandKey(c: Command): string {
  return `${c.unit}|${c.a}|${c.picks.join(',')}`;
}

/** Run `fn` with the piece temporarily lifted off the board and set down at `to`. */
function withPieceAt<T>(s: GameState, p: Piece, to: Sq, fn: () => T): T {
  const from = p.sq;
  s.board[from] = null;
  s.board[to] = p.uid;
  p.sq = to;
  try {
    return fn();
  } finally {
    s.board[to] = null;
    s.board[from] = p.uid;
    p.sq = from;
  }
}

export interface CastlePlan {
  king: Piece;
  kingTo: Sq | null;
  unitTo: Sq | null;
}

/** Castle (§15.1): King moves two toward the unit; the unit lands on the King's far side. */
export function planCastle(R: Rules, s: GameState, unit: Piece, v: Vec): CastlePlan | null {
  if (unit.owner === 'n') return null;
  const hit = castRay(R, s, unit.sq, v);
  const king = findRole(R, s, unit.owner, 'king');
  if (!hit || !king || hit.uid !== king.uid) return null;
  const g = R.geo;
  const back: Vec = [-v[0], -v[1]];
  let k = king.sq;
  for (let i = 0; i < 2; i++) {
    const n = g.step(k, back);
    if (n === null || s.board[n] !== null) break;
    k = n;
  }
  const kingTo = k !== king.sq ? k : null;
  const beyond = g.step(k, v);
  const beyondFree = beyond !== null && (s.board[beyond] === null || beyond === king.sq);
  const unitTo = beyondFree ? beyond : null;
  if (kingTo === null && unitTo === null) return null;
  return { king, kingTo, unitTo };
}

export function enumerateSpec(s: GameState, uid: string, a: number, spec: ActionSpec, o: EnumOpts): Command[] {
  const R = rulesFor(s);
  const g = R.geo;
  const p = s.pieces[uid];
  if (!p) return [];
  const fw = forwardOf(s, p.owner);
  const out: Command[] = [];
  const add = (...picks: Array<Sq | string>) => out.push({ unit: uid, a, picks });

  switch (spec.kw) {
    case 'move':
    case 'pave':
      for (const to of moveDests(R, s, p.sq, spec.kw === 'move' ? spec.range : spec.move, fw)) add(to);
      break;

    case 'attack':
      for (const t of attackTargets(R, s, p.sq, spec.range, fw)) add(t);
      break;

    case 'shoot':
      // Only shots that would hit something are offered: an empty shot does nothing.
      for (const v of dirSet(spec.dirs, fw)) {
        const hit = castRay(R, s, p.sq, v);
        if (hit) add(hit.sq);
      }
      break;

    case 'build': {
      if (p.owner === 'n') break;
      const budget = budgetFor(s, o.player);
      const squares = rangeSquares(R, s, p.sq, spec.range, fw);
      for (const b of buildablesFor(R, s, p.owner, spec.scope)) {
        if (!affordable(budget, b.cost)) continue;
        for (const q of squares) {
          if (b.kind === 'unit' ? s.board[q] === null : tileAllowedAt(R, s, q, b.id)) add(b.id, q);
        }
      }
      break;
    }

    case 'push':
    case 'stonepush':
      for (const q of g.area(p.sq, 1, false)) {
        const t = pieceAt(s, q);
        if (!t || (spec.kw === 'stonepush' && t.kind !== 'stone')) continue;
        for (const v of ALL_DIRS) {
          if (planPush(R, s, q, v, spec.dist).moves.size > 0) add(q, g.step(q, v)!);
        }
      }
      break;

    case 'undertaking': {
      const full: Command[] = [];
      const partial: Command[] = [];
      for (const to of moveDests(R, s, p.sq, spec.range, fw)) {
        const stones = withPieceAt(s, p, to, () => moveDests(R, s, to, spec.range, fw));
        for (const st of stones) full.push({ unit: uid, a, picks: [to, st] });
        if (o.fallback) partial.push({ unit: uid, a, picks: [to, 'none'] });
      }
      out.push(...(full.length || !o.fallback ? full : partial));
      break;
    }

    case 'castle':
      for (const v of dirSet(spec.dirs, fw)) {
        const plan = planCastle(R, s, p, v);
        if (plan) add(plan.king.sq);
      }
      break;

    case 'relocate':
    case 'reallocate': {
      const wantStone = spec.kw === 'reallocate';
      const froms = rangeSquares(R, s, p.sq, spec.from, fw).filter((q) => {
        const t = pieceAt(s, q);
        return !!t && t.uid !== uid && (wantStone ? t.kind === 'stone' && !t.reinforced : t.kind === 'unit');
      });
      const tos = rangeSquares(R, s, p.sq, spec.to, fw).filter((q) => s.board[q] === null);
      for (const f of froms) for (const t of tos) add(f, t);
      break;
    }

    case 'shelter':
    case 'shield': {
      const vs: Vec[] = spec.kw === 'shelter' ? [[-1, fw], [0, fw], [1, fw]] : [[0, fw]];
      if (vs.some((v) => {
        const q = g.step(p.sq, v);
        return q !== null && s.board[q] === null;
      }))
        add();
      break;
    }

    case 'lay':
      for (const q of rangeSquares(R, s, p.sq, spec.range, fw)) if (tileAllowedAt(R, s, q, spec.tile)) add(q);
      break;

    case 'moveattack':
      for (const to of moveDests(R, s, p.sq, spec.move, fw)) {
        if (spec.requireTile && !s.tiles[to]) continue;
        const targets = withPieceAt(s, p, to, () => attackTargets(R, s, to, spec.attack, fw));
        for (const t of targets) add(to, t);
      }
      break;

    case 'reinforce':
      for (const q of rangeSquares(R, s, p.sq, spec.range, fw)) {
        const t = pieceAt(s, q);
        if (t && t.kind === 'stone' && !t.reinforced) add(q);
      }
      break;
  }
  return out;
}

/** All options for one action slot of one unit. */
export function enumerateAction(s: GameState, uid: string, a: number, player: PlayerId): Command[] {
  const R = rulesFor(s);
  const p = s.pieces[uid];
  const d = p && unitDef(R, p);
  if (!d || !d.actions[a]) return [];
  return enumerateSpec(s, uid, a, d.actions[a], { player });
}

/** Every legal answer to the current pending decision. */
export function legalOptions(s: GameState): Command[] {
  const pend = s.pending;
  if (!pend || s.result) return [];
  const R = rulesFor(s);
  switch (pend.kind) {
    case 'action': {
      const uids = pend.unit ? [pend.unit] : unitsOf(s, pend.player).map((u) => u.uid);
      const out: Command[] = [];
      for (const uid of uids) {
        const p = s.pieces[uid];
        const d = p && unitDef(R, p);
        if (!d) continue;
        d.actions.forEach((spec, a) => {
          if (pend.context === 'build' && spec.kw !== 'build') return;
          out.push(...enumerateSpec(s, uid, a, spec, { player: pend.player }));
        });
      }
      return out;
    }
    case 'effect':
      return enumerateSpec(s, pend.unit, -1, pend.spec, { player: pend.player, fallback: pend.fallback });
    case 'displace': {
      const p = s.pieces[pend.piece];
      if (!p) return [];
      return R.geo
        .area(p.sq, 1, false)
        .filter((q) => s.board[q] === null)
        .map((q) => ({ unit: p.uid, a: -2, picks: [q] }));
    }
  }
}
