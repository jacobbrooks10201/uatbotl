// Single player (Descent): floors, waves, droplets, the fall, the enemy, replay.

import { describe, expect, it } from 'vitest';
import {
  applyInput,
  DEFAULT_AGE,
  formatNotation,
  legalOptions,
  newGame,
  parseNotation,
  rulesFor,
  type Command,
  type GameState,
  type Input,
} from '../src/engine';
import { generateMask, HOME_FILES, newDescentState, waveFor, DESCENT_SIZE } from '../src/engine/descent';
import { actionsOf, isAttack } from '../src/engine/rules';
import { LocalMatch } from '../src/net/match';

const N = DESCENT_SIZE;
const start = (seed: number) => newGame(DEFAULT_AGE, { mode: 'descent', seed });

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A simple Red player: hit an enemy if possible, else bring the Queen (or anyone) toward the nearest enemy. */
function redChoice(s: GameState, rand: () => number): Input {
  const R = rulesFor(s);
  const g = R.geo;
  const p = s.pending!;
  const opts = legalOptions(s);
  const spec = (c: Command) => (c.a === -1 && p.kind === 'effect' ? p.spec : actionsOf(R, s, s.pieces[c.unit])[c.a]);
  const enemyAt = (q: unknown) => typeof q === 'number' && s.board[q] && s.pieces[s.board[q]!].owner === 1;
  const hits = opts.filter((c) => isAttack(spec(c)) && enemyAt(c.picks[0]));
  if (hits.length) return { type: 'choose', player: 0, cmd: hits[Math.floor(rand() * hits.length)] };
  if ((p.kind === 'action' || p.kind === 'effect') && p.optional && rand() < 0.5) return { type: 'skip', player: 0 };
  const enemies = Object.values(s.pieces).filter((e) => e.owner === 1);
  const near = (q: number) => Math.min(...enemies.map((e) => g.dist(q, e.sq)));
  const moves = opts.filter((c) => {
    const k = spec(c).kw;
    return (k === 'move' || k === 'undertaking') && s.pieces[c.unit].def === 'queen';
  });
  if (moves.length && enemies.length && rand() < 0.8) {
    const best = Math.min(...moves.map((c) => near(c.picks[0] as number)));
    const top = moves.filter((c) => near(c.picks[0] as number) === best);
    return { type: 'choose', player: 0, cmd: top[Math.floor(rand() * top.length)] };
  }
  return { type: 'choose', player: 0, cmd: opts[Math.floor(rand() * opts.length)] };
}

function playRun(seed: number, maxInputs: number) {
  let s = start(seed);
  const inputs: Input[] = [];
  const rand = rng(seed * 31 + 7);
  for (let i = 0; i < maxInputs && !s.result && s.pending; i++) {
    expect(s.pending.player).toBe(0); // Blue never waits on anyone
    const inp = redChoice(s, rand);
    s = applyInput(s, inp);
    inputs.push(inp);
    checkFloor(s);
  }
  return { s, inputs };
}

/** Every piece and tile stands on a square that exists; droplets too. */
function checkFloor(s: GameState) {
  const g = rulesFor(s).geo;
  for (const p of Object.values(s.pieces)) {
    expect(g.exists(p.sq)).toBe(true);
    expect(s.board[p.sq]).toBe(p.uid);
  }
  s.tiles.forEach((t, q) => t && expect(g.exists(q)).toBe(true));
  for (const q of s.descent!.drops) expect(g.exists(q)).toBe(true);
}

describe('Descent floors', () => {
  it('shapes: inside 16x16, home row c1-n1 open, start area clear, all joined, big enough', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const d = newDescentState(seed);
      const mask = generateMask(d);
      expect(mask).toHaveLength(N * N);
      const open = (f: number, r: number) => mask[r * N + f] === '1';
      for (let f = 0; f < N; f++) expect(open(f, 0)).toBe(f >= HOME_FILES[0] && f <= HOME_FILES[1]);
      for (let r = 1; r <= 2; r++) for (let f = 3; f <= 12; f++) expect(open(f, r)).toBe(true);
      // Joined: every open square reaches the home row orthogonally.
      const seen = new Set<number>();
      const queue: number[] = [];
      for (let f = HOME_FILES[0]; f <= HOME_FILES[1]; f++) (seen.add(f), queue.push(f));
      while (queue.length) {
        const q = queue.shift()!;
        const f = q % N;
        const nb = [f > 0 ? q - 1 : -1, f < N - 1 ? q + 1 : -1, q - N, q + N];
        for (const n of nb) if (n >= 0 && n < N * N && mask[n] === '1' && !seen.has(n)) (seen.add(n), queue.push(n));
      }
      expect(seen.size).toBe([...mask].filter((c) => c === '1').length);
      expect(seen.size).toBeGreaterThanOrEqual(75);
    }
  });

  it('waves grow and toughen', () => {
    const d = newDescentState(5);
    const power = (w: string[]) => w.length;
    expect(waveFor(d, 1).every((u) => ['soldier', 'warrior'].includes(u))).toBe(true);
    expect(power(waveFor(d, 20))).toBeGreaterThan(power(waveFor(d, 1)));
    const late = Array.from({ length: 10 }, () => waveFor(d, 20)).flat();
    expect(late).toContain('rook');
  });

  it('a new run: King and Queen on the home row, a wave away from it, droplets, Red to move', () => {
    const s = start(42);
    const R = rulesFor(s);
    expect(s.mask).toHaveLength(N * N);
    expect(s.descent).toMatchObject({ seed: 42, floor: 1, droplets: 0 });
    const red = Object.values(s.pieces).filter((p) => p.owner === 0);
    expect(red.map((p) => `${p.def}@${R.geo.name(p.sq)}`).sort()).toEqual(['king@i1', 'queen@g1']);
    const blue = Object.values(s.pieces).filter((p) => p.owner === 1);
    expect(blue.length).toBeGreaterThanOrEqual(2);
    for (const b of blue) expect(R.geo.rank(b.sq)).toBeGreaterThanOrEqual(4);
    expect(s.descent!.drops.length).toBeGreaterThanOrEqual(1);
    expect(s.descent!.drops.length).toBeLessThanOrEqual(3);
    expect(s.pending).toMatchObject({ player: 0, kind: 'action', context: 'main' });
    expect(formatNotation(s)).toBe('D42');
    // The same seed gives the same run.
    expect(JSON.stringify(start(42))).toBe(JSON.stringify(s));
    expect(JSON.stringify(start(43))).not.toBe(JSON.stringify(s));
  });

  it('no stones without droplets; a droplet pays for one, and the placement adds to the budget', () => {
    const s0 = start(42);
    const queen = Object.values(s0.pieces).find((p) => p.def === 'queen')!;
    const und = (s: GameState) => legalOptions(s).filter((c) => c.unit === queen.uid && c.a === 0);
    expect(und(s0)).toEqual([]);
    const s1 = structuredClone(s0);
    s1.descent!.droplets = 1;
    const opts = und(s1);
    expect(opts.length).toBeGreaterThan(0);
    const before = { ...s1.budget };
    const s2 = applyInput(s1, { type: 'choose', player: 0, cmd: opts[0] });
    expect(s2.descent!.droplets).toBe(0);
    // A lone stone: +1 Extension, +1 Incursion. The budget is kept into the next turn.
    const red = s2.notes.filter((n) => n.player === 0);
    expect(red.length).toBeGreaterThanOrEqual(2);
    expect(s2.budget.E).toBe(before.E + 1);
    expect(s2.budget.I).toBe(before.I + 1);
  });

  it('Blue takes one action per turn and never needs an answer', () => {
    const { s } = playRun(3, 40);
    for (const n of s.notes.filter((t) => t.player === 1)) expect(n.main.length).toBeLessThanOrEqual(1);
  });

  it('clearing a floor drops everything onto the next one', () => {
    let reached = 0;
    const floors: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const { s, inputs } = playRun(seed, 400);
      const floor = s.descent!.floor;
      floors.push(`${seed}:${floor}${s.result ? `/${s.log.at(-3)?.text}` : ''}`);
      reached = Math.max(reached, floor);
      if (floor < 2) continue;
      expect(formatNotation(s)).toContain(`F${floor}`);
      // Replays from the inputs alone, and from its notation.
      const m = new LocalMatch(DEFAULT_AGE, inputs, { mode: 'descent', seed });
      expect(JSON.stringify(m.state)).toBe(JSON.stringify(s));
      const parsed = parseNotation(formatNotation(s), DEFAULT_AGE);
      expect(formatNotation(parsed.state)).toBe(formatNotation(s));
      expect(JSON.stringify(parsed.state)).toBe(JSON.stringify(s));
    }
    expect(reached, `floors reached: ${floors}`).toBeGreaterThanOrEqual(3);
  }, 120_000);

  /** Floor 1 of a run with every enemy gone and Red to move: any Red action ends the floor. */
  function cleared(seed: number) {
    const s = structuredClone(start(seed));
    for (const p of Object.values(s.pieces)) if (p.owner === 1) (s.board[p.sq] = null), delete s.pieces[p.uid];
    return s;
  }
  const move = (s: GameState, def: string, to?: number) => {
    const opts = legalOptions(s).filter((c) => s.pieces[c.unit].def === def && actionsOf(rulesFor(s), s, s.pieces[c.unit])[c.a].kw === 'move');
    const cmd = to === undefined ? opts[0] : opts.find((c) => c.picks[0] === to)!;
    return applyInput(s, { type: 'choose', player: 0, cmd });
  };

  it('the King dies if he falls where the next floor has no square; so does anything else', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = cleared(seed);
      const next = generateMask(structuredClone(s.descent!)); // the floor the next turn will bring
      const g = rulesFor(s).geo;
      const king = Object.values(s.pieces).find((p) => p.def === 'king')!;
      const spot = [...Array(N * N).keys()].find((q) => g.exists(q) && next[q] === '0' && s.board[q] === null && q !== king.sq);
      if (spot === undefined) continue;
      s.board[king.sq] = null;
      s.board[spot] = king.uid;
      king.sq = spot;
      const after = move(s, 'queen');
      expect(after.descent!.floor).toBe(2);
      expect(after.result).toEqual({ winner: 1, reason: 'ipseity' });
      expect(after.dead[king.uid]).toBeTruthy();
      expect(formatNotation(after)).toMatch(/F2.*##/);
      expect(after.descent!.lost).toContain(king.uid);
      return;
    }
    throw new Error('no seed gave a missing square under the King');
  });

  it('pieces that land safely stay on the same square on the next floor', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = cleared(seed);
      const opts = legalOptions(s).filter((c) => s.pieces[c.unit].def === 'queen' && c.a === 1); // Queen's Move
      const cmd = opts[0];
      const after = applyInput(s, { type: 'choose', player: 0, cmd });
      if (after.result) continue;
      expect(after.descent!.floor).toBe(2);
      const king = Object.values(s.pieces).find((p) => p.def === 'king')!;
      const queen = Object.values(s.pieces).find((p) => p.def === 'queen')!;
      expect(after.pieces[king.uid].sq).toBe(king.sq);
      expect(after.pieces[queen.uid].sq).toBe(cmd.picks[0]);
      expect(after.descent!.fell).toEqual(expect.arrayContaining([king.sq, cmd.picks[0]]));
      expect(after.active).toBe(0); // Red moves first on the new floor
      expect(after.pending).toMatchObject({ player: 0, context: 'main' });
      return;
    }
    throw new Error('no run survived the fall');
  });

  it('a unit moving onto a droplet picks it up; onto the Scroll wins', () => {
    const s = structuredClone(start(42));
    const R = rulesFor(s);
    const king = Object.values(s.pieces).find((p) => p.def === 'king')!;
    const step = R.geo.sq(R.geo.file(king.sq), 1);
    s.descent!.drops = [step];
    const s1 = move(s, 'king', step);
    expect(s1.descent!.droplets).toBe(1);
    expect(s1.descent!.drops).toEqual([]);
    const s2 = structuredClone(s);
    s2.descent!.drops = [];
    s2.descent!.scroll = step;
    const won = move(s2, 'king', step);
    expect(won.result).toEqual({ winner: 0, reason: 'scroll' });
    expect(formatNotation(won).endsWith(' 1-0')).toBe(true);
  });
});
