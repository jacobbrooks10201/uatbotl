// Generates a sample game in which every unit and tile is built, and then
// every unit acts, so the whole roster can be watched in the replay viewer.
//
// Guided self-play with a fixed build order per side: Red builds the
// Extension, Prevenience and Multiplicity roster, Blue the Incursion and
// Deduction roster. Each turn the side builds its next item if it can;
// otherwise its Queen places stones where they best raise the resource that
// item needs, or its King steps into open space. Units that disturb the
// board (Building Committee, Vaulter, Soldier) come last. Phase 2 lets every
// unit take one of its own actions. Nothing ever ends the game or costs a
// side one of its own pieces.
//
// Output is plain notation (docs/NOTATION.md). Regenerate with
//   VITE_REGEN=1 npx vitest run tests/tools/regenerate.test.ts

import {
  applyInput,
  DEFAULT_AGE,
  formatNotation,
  legalOptions,
  newGame,
  rulesFor,
  type Command,
  type GameState,
  type Input,
  type PlayerId,
  type Resource,
} from '../../src/engine';
import { actionsOf, unitDef } from '../../src/engine/rules';

const R = rulesFor(DEFAULT_AGE);
const G = R.geo;

export const BUILD_ORDER: Record<PlayerId, string[]> = {
  0: [
    'scrap', 'slinger', 'claywall',
    'pgate', 'castler', 'hoglouse', 'stonedirector', 'advisor',
    'mgate', 'pathbuilder', 'follower', 'accelerator', 'selfexecute', 'committee',
  ],
  1: [
    'igate', 'warrior', 'horse', 'bishop', 'rook', 'aigate', 'general',
    'dgate', 'trailblazer', 'trapthrower', 'speartrick', 'pathclearer', 'royalpath', 'todust', 'burst',
    'vaulter', 'soldier',
  ],
};

function costOf(id: string): { res: Resource; n: number } {
  return (R.units.get(id)?.cost ?? R.tile(id).cost)!;
}

/** Capability from a set of own stones (§10.2). */
function capability(own: Set<number>): Record<Resource, number> {
  const has = (f: number, r: number) => G.inBounds(f, r) && own.has(G.sq(f, r));
  const b: Record<Resource, number> = { E: 0, P: 0, D: 0, M: 0, I: 0 };
  for (const q of own) {
    const f = G.file(q);
    const r = G.rank(q);
    b.E++;
    if (has(f + 1, r)) b.P++;
    if (has(f, r + 1)) b.M++;
    if (has(f + 1, r + 1)) b.D++;
    if (has(f - 1, r + 1)) b.D++;
    let iso = true;
    for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) if ((df || dr) && has(f + df, r + dr)) iso = false;
    if (iso) b.I++;
  }
  return b;
}

function spec(s: GameState, c: Command) {
  if (c.a === -1) return s.pending?.kind === 'effect' ? s.pending.spec : null;
  return c.a < 0 ? null : (actionsOf(R, s, s.pieces[c.unit])[c.a] ?? null);
}

function royal(s: GameState, p: PlayerId, role: 'king' | 'queen') {
  return Object.values(s.pieces).find((x) => x.owner === p && unitDef(R, x)?.role === role);
}

const empties = (s: GameState, q: number) => G.area(q, 1, false).filter((n) => s.board[n] === null).length;

const ownStones = (s: GameState, p: PlayerId) =>
  new Set(Object.values(s.pieces).filter((x) => x.kind === 'stone' && x.owner === p).map((x) => x.sq));

export interface EveryUnitGame {
  text: string;
  missing: string[];
  acted: string[];
  /** When each item was built: "input:player:id". */
  log: string[];
}

export function generateEveryUnitGame(maxInputs = 3000): EveryUnitGame {
  let s = newGame(DEFAULT_AGE);
  const built = new Set<string>();
  const log: string[] = [];
  const acted = new Set<string>();
  // Units that shoot or build on their own every turn wait until the other side has built its list.
  const DISRUPTIVE = new Set(['vaulter', 'soldier', 'committee']);
  const todo = (p: PlayerId) => BUILD_ORDER[p].filter((id) => !built.has(`${p}:${id}`));
  const next = (p: PlayerId) => {
    const other = todo(p === 0 ? 1 : 0).filter((id) => !DISRUPTIVE.has(id));
    return todo(p).find((id) => !DISRUPTIVE.has(id) || other.length === 0);
  };
  const own = (st: GameState, p: PlayerId) => Object.values(st.pieces).filter((x) => x.owner === p).length;

  /** Apply unless it ends the game; also report how many own pieces it costs (including the other side's passives after it). */
  const tryInput = (inp: Input): [GameState, number] | null => {
    try {
      const n = applyInput(s, inp);
      if (n.result) return null;
      const created = n.nextId[inp.player] - s.nextId[inp.player];
      return [n, Math.max(0, own(s, inp.player) + created - own(n, inp.player))];
    } catch {
      return null;
    }
  };
  /** The first candidate that costs nothing, else the one that costs least. */
  const first = (cands: Command[], p: PlayerId, limit = 40): [Input, GameState] | null => {
    let best: [Input, GameState, number] | null = null;
    for (const cmd of cands.slice(0, limit)) {
      const inp: Input = { type: 'choose', player: p, cmd };
      const r = tryInput(inp);
      if (!r) continue;
      if (r[1] === 0) return [inp, r[0]];
      if (!best || r[1] < best[2]) best = [inp, r[0], r[1]];
    }
    return best && [best[0], best[1]];
  };

  /** Queen stones (Undertaking or stone throw), best first, for resource `res`. */
  const bestStones = (opts: Command[], p: PlayerId, res: Resource): Command[] => {
    const mine = ownStones(s, p);
    const king = royal(s, p, 'king');
    const builders = Object.values(s.pieces)
      .filter((x) => x.owner === p && (unitDef(R, x)?.gate || unitDef(R, x)?.role === 'king'))
      .map((x) => x.sq);
    const scored: Array<[number, Command]> = [];
    for (const c of opts) {
      const sp = spec(s, c);
      const q = sp?.kw === 'undertaking' && typeof c.picks[1] === 'number' ? c.picks[1] : sp?.kw === 'throw' ? (c.picks[0] as number) : null;
      if (q === null) continue;
      // Stay on the own half and off tiles (a To Dust would clear the stones again).
      const to = sp?.kw === 'undertaking' ? (c.picks[0] as number) : null;
      if (G.half(q) !== p || (to !== null && (G.half(to) !== p || s.tiles[to]))) continue;
      // Builders keep room: no stone next to the own King or an own gate.
      if (builders.some((b) => G.dist(b, q) <= 1)) continue;
      mine.add(q);
      const cap = capability(mine);
      mine.delete(q);
      // Out of the King's working space.
      const crowd = king && G.dist(king.sq, q) <= 2 ? -30 : 0;
      scored.push([cap[res] * 100 + cap.E + crowd, c]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map(([, c]) => c);
  };

  let phase2Start = -1;
  // Phase 2 also ends once neither side has an unacted unit that can act (boxed in, or dead).
  const idle: Record<PlayerId, number> = { 0: 0, 1: 0 };
  for (let i = 0; i < maxInputs && !s.result; i++) {
    const pend = s.pending!;
    const p = pend.player;
    const opts = legalOptions(s);
    const goal = next(p);
    const phase2 = !todo(0).length && !todo(1).length;
    if (phase2 && phase2Start < 0) phase2Start = i;
    if (phase2 && (phase2Done(s, acted) || i - phase2Start > 400 || (idle[0] >= 6 && idle[1] >= 6))) break;

    let pick: [Input, GameState] | null = null;
    const skip = (): [Input, GameState] | null => {
      const inp: Input = { type: 'skip', player: p };
      const r = tryInput(inp);
      return r && [inp, r[0]];
    };

    if (pend.kind === 'action' && pend.optional) {
      // Bonus Attack in phase 2: hit an enemy non-royal. Otherwise decline optional bonuses.
      if (phase2 && pend.context === 'attack') {
        const hits = opts.filter((c) => {
          const t = s.pieces[s.board[c.picks[0] as number] ?? ''];
          return t && t.owner !== p && t.owner !== 'n' && !unitDef(R, t)?.role;
        });
        pick = first(hits, p);
      }
      pick ??= skip() ?? first(opts, p, opts.length);
    } else if (pend.kind === 'effect' && pend.optional) {
      pick = skip() ?? first(opts, p, opts.length);
    } else if (pend.kind === 'effect' && pend.spec.kw === 'throw') {
      pick = first(bestStones(opts, p, goal ? costOf(goal).res : 'E'), p);
    }

    // 0. A crowded King steps to roomier ground on his own half first, so he can keep building.
    const king = royal(s, p, 'king');
    if (!pick && king && pend.kind === 'action' && pend.context === 'main' && empties(s, king.sq) <= 3) {
      const out = opts
        .filter((c) => c.unit === king.uid && spec(s, c)?.kw === 'move' && G.half(c.picks[0] as number) === p)
        .filter((c) => empties(s, c.picks[0] as number) > empties(s, king.sq))
        .sort((a, b) => empties(s, b.picks[0] as number) - empties(s, a.picks[0] as number));
      pick = first(out, p);
    }

    // 1. Build the next item, on the roomiest square. Tiles only on empty squares.
    if (!pick && goal) {
      const builds = opts
        .filter((c) => c.picks[0] === goal && spec(s, c)?.kw === 'build')
        .filter((c) => R.units.has(goal) || s.board[c.picks[1] as number] === null)
        // The King keeps at least two free neighbours when he builds.
        .filter((c) => c.unit !== king?.uid || empties(s, king.sq) > 2)
        .sort((a, b) => empties(s, b.picks[1] as number) - empties(s, a.picks[1] as number));
      pick = first(builds, p);
      if (pick) {
        built.add(`${p}:${goal}`);
        log.push(`${i}:${p}:${goal}`);
      }
      // Stones first while they cannot pay for it.
      const { res, n } = costOf(goal);
      if (!pick && capability(ownStones(s, p))[res] < n) pick = first(bestStones(opts, p, res), p);
      // Paid for but no room in any builder's range: put up another gate of that type somewhere roomy.
      const gateId = R.units.get(goal)?.requires ?? R.tiles.get(goal)?.builtBy;
      const gate = gateId ? R.age.units.find((u) => u.gate === gateId && u.cost && u.cost.n <= 2) : undefined;
      if (!pick && gate && !built.has(`${p}:extra-${gate.id}-${i >> 3}`)) {
        const gates = opts
          .filter((c) => c.picks[0] === gate.id && spec(s, c)?.kw === 'build')
          .sort((a, b) => empties(s, b.picks[1] as number) - empties(s, a.picks[1] as number));
        pick = first(gates, p);
        // At most one extra gate every few inputs, so a stuck goal cannot fill the board with gates.
        if (pick) built.add(`${p}:extra-${gate.id}-${i >> 3}`);
      }
    }

    // 2. Phase 2: each unit takes one of its own actions.
    if (!pick && phase2) {
      for (const c of opts) {
        const u = s.pieces[c.unit];
        const kw = spec(s, c)?.kw;
        if (!u?.def || acted.has(`${p}:${u.def}`) || unitDef(R, u)?.role || !kw || kw === 'selfdestruct' || kw === 'build') continue;
        pick = first([c], p);
        if (pick) {
          acted.add(`${p}:${u.def}`);
          break;
        }
      }
      if (pend.kind === 'action' && pend.context === 'main') idle[p] = pick ? 0 : idle[p] + 1;
    }

    // 3. Room to work: the King steps to the square with the most space; else anything harmless.
    if (!pick) {
      // Never into the file of an own unit that shoots or attacks forward on its own (Vaulter, Soldier).
      const fireFiles = new Set(
        Object.values(s.pieces)
          .filter((x) => x.owner === p && x.def && unitDef(R, x)!.passives.some((ps) => ps.kw === 'shoot' || ps.kw === 'attack'))
          .map((x) => G.file(x.sq)),
      );
      const queen = royal(s, p, 'queen');
      const roomy = (a: Command, b: Command) => empties(s, b.picks[0] as number) - empties(s, a.picks[0] as number);
      const steps = opts
        .filter((c) => c.unit === king?.uid && spec(s, c)?.kw === 'move' && !fireFiles.has(G.file(c.picks[0] as number)))
        .filter((c) => G.half(c.picks[0] as number) === p)
        .sort(roomy);
      // A boxed-in Queen moves to open space on her own half, so she can place stones again.
      const queenMoves = opts
        .filter((c) => c.unit === queen?.uid && spec(s, c)?.kw === 'move' && G.half(c.picks[0] as number) === p && !s.tiles[c.picks[0] as number])
        .sort(roomy);
      const harmless = opts.filter((c) => {
        const kw = spec(s, c)?.kw;
        if (kw === 'selfdestruct' || kw === 'attack' || kw === 'shoot' || kw === 'clear' || kw === 'build') return false;
        // Royals stay on their own half.
        const role = unitDef(R, s.pieces[c.unit])?.role;
        return !role || typeof c.picks[0] !== 'number' || G.half(c.picks[0]) === p;
      });
      const stuck = goal && !bestStones(opts, p, 'E').length;
      pick =
        (stuck ? first(queenMoves, p) : null) ??
        first(steps, p) ??
        first(bestStones(opts, p, 'E'), p) ??
        first(queenMoves, p) ??
        first(harmless, p) ??
        first(opts, p, opts.length);
    }
    if (!pick) break;
    s = pick[1];
  }

  const missing = ([0, 1] as PlayerId[]).flatMap((p) => BUILD_ORDER[p].filter((id) => !built.has(`${p}:${id}`)));
  return { text: formatNotation(s), missing, acted: [...acted].sort(), log };
}

/** Phase 2 ends when every non-royal unit type on the board with an action of its own has acted. */
function phase2Done(s: GameState, acted: Set<string>): boolean {
  for (const p of Object.values(s.pieces)) {
    if (p.kind !== 'unit' || p.owner === 'n') continue;
    const d = unitDef(R, p)!;
    if (d.role || !d.actions.some((a) => a.kw !== 'selfdestruct' && a.kw !== 'build')) continue;
    if (!acted.has(`${p.owner}:${d.id}`)) return false;
  }
  return true;
}
