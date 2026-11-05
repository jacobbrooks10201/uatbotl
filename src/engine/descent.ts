// Single player mode: Descent.
//
// The player (Red) starts with King and Queen and goes down floor by floor.
// Each floor is a random shape inside a 16x16 area, always joined to the
// player's home row (12 squares, files c-n of rank 1). Blue is the enemy:
// waves of units, more and tougher on each floor, played by the engine with
// one action per turn. Killing every enemy sends the player down: every piece
// and tile falls to the same square of the next floor. A piece over a square
// the new floor lacks dies (the King too); a piece landing on an enemy
// destroys both. The Legendary Scroll of Utanapishtim lies on the last floor.
//
// Every random choice (floor shapes, waves, droplets, the enemy's moves)
// comes from a seeded generator kept in the state, so a run replays exactly
// from its inputs.

import { isAttack, actionsOf, computeBudget, createUnit, destroy, findRole, log, rulesFor, unitsOf, type Rules } from './rules';
import { legalOptions } from './options';
import { noteToken } from './notation';
import type { Budget, Command, DescentState, GameState, Input, Piece, PlayerId, Sq } from './types';

export const DESCENT_SIZE = 16;
export const DESCENT_FLOORS = 25;
/** Files of the home row (rank 1), always on the board. */
export const HOME_FILES: readonly [number, number] = [2, 13];

// ---------------------------------------------------------------------------
// Randomness (mulberry32; the state lives in DescentState.rng)
// ---------------------------------------------------------------------------

export function rand(d: DescentState): number {
  let t = (d.rng = (d.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (d: DescentState, n: number) => Math.floor(rand(d) * n);
const pick = <T>(d: DescentState, list: readonly T[]): T => list[randInt(d, list.length)];

export function newDescentState(seed: number): DescentState {
  return {
    seed,
    rng: seed | 0,
    floor: 1,
    droplets: 0,
    drops: [],
    scroll: null,
    budget: { E: 0, P: 0, D: 0, M: 0, I: 0 },
    fell: [],
    lost: [],
  };
}

// ---------------------------------------------------------------------------
// Floor shapes
// ---------------------------------------------------------------------------

/**
 * A random floor shape inside the 16x16 area. Each floor mixes one to three
 * styles: winding bands (hard bends are straight sideways runs, soft bends a
 * diagonal drift), rooms joined by corridors with square corners, and
 * cave-like blobs. Then the edges are roughened and a few blocked islands
 * are cut out, never in the bottom middle. Everything is joined to the home
 * row, which is always exactly c1-n1.
 */
export function generateMask(d: DescentState): string {
  const N = DESCENT_SIZE;
  for (let attempt = 0; ; attempt++) {
    const open: boolean[] = new Array(N * N).fill(false);
    const inside = (f: number, r: number) => f >= 0 && r >= 0 && f < N && r < N;
    const set = (f: number, r: number, v = true) => {
      if (inside(f, r)) open[r * N + f] = v;
    };
    const isOpen = (f: number, r: number) => inside(f, r) && open[r * N + f];
    const brush = (f: number, r: number, rad: number) => {
      for (let dr = -rad; dr <= rad; dr++)
        for (let df = -rad; df <= rad; df++) if (Math.abs(df) + Math.abs(dr) <= rad + (rad > 1 ? 1 : 0)) set(f + df, r + dr);
    };
    const openList = () => open.flatMap((o, i) => (o ? [i] : []));

    // Home row and a clear start area above it.
    for (let f = HOME_FILES[0]; f <= HOME_FILES[1]; f++) set(f, 0);
    for (let r = 1; r <= 2; r++) for (let f = 3; f <= 12; f++) set(f, r);

    /** A winding band from (f, r) up to rank `top`. */
    const band = (f: number, r: number, top: number, rad: number) => {
      while (r < top) {
        brush(f, r, rad);
        const roll = rand(d);
        if (roll < 0.4) r++;
        else if (roll < 0.65) {
          // Hard bend: a straight run sideways.
          const dir = f < 3 ? 1 : f > 12 ? -1 : rand(d) < 0.5 ? -1 : 1;
          const len = 2 + randInt(d, 5);
          for (let i = 0; i < len && f + dir >= 0 && f + dir <= N - 1; i++) {
            f += dir;
            brush(f, r, Math.min(rad, 1));
          }
        } else {
          // Soft bend: drift diagonally.
          f = Math.max(0, Math.min(N - 1, f + (rand(d) < 0.5 ? -1 : 1)));
          r++;
        }
        if (rand(d) < 0.3) rad = Math.max(0, Math.min(2, rad + (rand(d) < 0.5 ? -1 : 1)));
      }
      brush(f, r, rad);
    };
    /** An L-shaped corridor (square corner) from a square to the nearest open square. */
    const corridor = (f: number, r: number, wide: boolean) => {
      let best = -1;
      let bestD = Infinity;
      for (const q of openList()) {
        const dd = Math.abs((q % N) - f) + Math.abs(Math.floor(q / N) - r);
        if (dd < bestD && q !== r * N + f) (bestD = dd), (best = q);
      }
      if (best < 0) return;
      const tf = best % N;
      const tr = Math.floor(best / N);
      const horizFirst = rand(d) < 0.5;
      const cf = horizFirst ? tf : f;
      const cr = horizFirst ? r : tr;
      for (const [a, b2, c, e] of [
        [f, r, cf, cr],
        [cf, cr, tf, tr],
      ]) {
        for (let x = Math.min(a, c); x <= Math.max(a, c); x++) for (let y = Math.min(b2, e); y <= Math.max(b2, e); y++) {
          set(x, y);
          if (wide) set(x + (a === c ? 1 : 0), y + (a === c ? 0 : 1));
        }
      }
    };

    const styles = ['band', 'twin', 'rooms', 'cave'];
    const chosen = new Set<string>(['band']);
    const extra = randInt(d, 3);
    for (let i = 0; i < extra; i++) chosen.add(pick(d, styles));
    if (chosen.has('twin')) {
      band(2 + randInt(d, 4), 2, N - 1 - randInt(d, 4), randInt(d, 2));
      band(10 + randInt(d, 4), 2, N - 1 - randInt(d, 4), randInt(d, 2));
    } else band(4 + randInt(d, 8), 2, N - 1 - randInt(d, 3), randInt(d, 3));
    if (chosen.has('rooms')) {
      const rooms = 2 + randInt(d, 3);
      for (let i = 0; i < rooms; i++) {
        const w = 3 + randInt(d, 4);
        const h = 2 + randInt(d, 3);
        const f = randInt(d, N - w + 1);
        const r = 4 + randInt(d, N - 4 - h + 1);
        corridor(f + Math.floor(w / 2), r + Math.floor(h / 2), rand(d) < 0.4);
        for (let y = r; y < r + h; y++) for (let x = f; x < f + w; x++) set(x, y);
      }
    }
    if (chosen.has('cave')) {
      // Cellular blob in a random region, joined by a corridor.
      const w = 5 + randInt(d, 7);
      const h = 4 + randInt(d, 6);
      const f0 = randInt(d, N - w + 1);
      const r0 = 4 + randInt(d, N - 4 - h + 1);
      let cave = Array.from({ length: h }, () => Array.from({ length: w }, () => rand(d) < 0.55));
      for (let it = 0; it < 3; it++) {
        cave = cave.map((row, y) =>
          row.map((_, x) => {
            let n = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && cave[y + dy]?.[x + dx]) n++;
            return n >= 4 || (n === 3 && cave[y][x]);
          }),
        );
      }
      cave.forEach((row, y) => row.forEach((c, x) => c && set(f0 + x, r0 + y)));
      corridor(f0 + Math.floor(w / 2), r0 + Math.floor(h / 2), false);
    }
    // Ragged edges: nibble border squares away from the start area.
    const nibbles = 6 + randInt(d, 18);
    for (let i = 0; i < nibbles; i++) {
      const q = pick(d, openList());
      const qf = q % N;
      const qr = Math.floor(q / N);
      if (qr <= 2) continue;
      const edge = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([a, b2]) => !isOpen(qf + a, qr + b2));
      if (edge) open[q] = false;
    }
    // Blocked islands, never in the bottom middle.
    const islands = randInt(d, 5);
    for (let i = 0; i < islands; i++) {
      const q = pick(d, openList());
      const qf = q % N;
      const qr = Math.floor(q / N);
      const w = 1 + randInt(d, 3);
      const h = 1 + randInt(d, 2);
      const cells: number[] = [];
      const bottomMiddle = (f: number, r: number) => r < 6 && f >= 3 && f <= 12;
      for (let dr = 0; dr < h; dr++)
        for (let df = 0; df < w; df++) if (isOpen(qf + df, qr + dr) && !bottomMiddle(qf + df, qr + dr)) cells.push((qr + dr) * N + qf + df);
      for (const c of cells) open[c] = false;
      // An island must not cut the floor apart.
      if (!connected(open)) for (const c of cells) open[c] = true;
    }
    // The home row is exactly c1-n1.
    for (let f = 0; f < N; f++) open[f] = f >= HOME_FILES[0] && f <= HOME_FILES[1];
    keepReachable(open);
    const count = open.filter(Boolean).length;
    if ((count >= 75 && count <= 190) || attempt >= 40) return open.map((o) => (o ? '1' : '0')).join('');
  }
}

function neighbours4(q: number): number[] {
  const N = DESCENT_SIZE;
  const f = q % N;
  const r = Math.floor(q / N);
  const out: number[] = [];
  if (f > 0) out.push(q - 1);
  if (f < N - 1) out.push(q + 1);
  if (r > 0) out.push(q - N);
  if (r < N - 1) out.push(q + N);
  return out;
}

/** Open squares reachable (orthogonally) from the home row. */
function reachable(open: boolean[]): Set<number> {
  const seen = new Set<number>();
  const queue: number[] = [];
  for (let f = HOME_FILES[0]; f <= HOME_FILES[1]; f++) if (open[f]) (seen.add(f), queue.push(f));
  while (queue.length) {
    const q = queue.shift()!;
    for (const n of neighbours4(q)) if (open[n] && !seen.has(n)) (seen.add(n), queue.push(n));
  }
  return seen;
}

function connected(open: boolean[]): boolean {
  return reachable(open).size === open.filter(Boolean).length;
}

function keepReachable(open: boolean[]): void {
  const seen = reachable(open);
  for (let i = 0; i < open.length; i++) if (open[i] && !seen.has(i)) open[i] = false;
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

/** Enemy types: the floor they first appear on and their weight in a wave's strength. */
export const ENEMIES: ReadonlyArray<{ unit: string; from: number; power: number }> = [
  { unit: 'soldier', from: 1, power: 1 },
  { unit: 'warrior', from: 1, power: 2 },
  { unit: 'vaulter', from: 3, power: 2 },
  { unit: 'horse', from: 5, power: 3 },
  { unit: 'bishop', from: 8, power: 3 },
  { unit: 'rook', from: 12, power: 5 },
];

/** A floor's wave: its strength grows every floor, and stronger types join on later floors. */
export function waveFor(d: DescentState, floor: number): string[] {
  let points = 3 + 2 * floor;
  const out: string[] = [];
  while (points > 0 && out.length < 18) {
    const pool = ENEMIES.filter((e) => e.from <= floor && e.power <= points);
    if (!pool.length) break;
    // Later floors lean toward their newest, strongest types.
    const weights = pool.map((e) => 1 + Math.max(0, floor - e.from) / 4 + e.power / 2);
    let x = rand(d) * weights.reduce((a, b) => a + b, 0);
    let i = 0;
    while (x >= weights[i] && i < pool.length - 1) x -= weights[i++];
    out.push(pool[i].unit);
    points -= pool[i].power;
  }
  return out;
}

/** Pick `n` squares from `cands`, weighted toward the middle and the far end. */
function spawnSquares(d: DescentState, cands: Sq[], n: number): Sq[] {
  const N = DESCENT_SIZE;
  const list = [...cands];
  const out: Sq[] = [];
  while (out.length < n && list.length) {
    const w = list.map((q) => 0.25 + Math.floor(q / N) / (N - 1));
    let x = rand(d) * w.reduce((a, b) => a + b, 0);
    let i = 0;
    while (x >= w[i] && i < list.length - 1) x -= w[i++];
    out.push(list[i]);
    list.splice(i, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Starting a floor
// ---------------------------------------------------------------------------

/**
 * Set up the current floor (`d.floor`): a new shape, the wave, then whatever
 * is already on the board falls onto it. On the first floor nothing falls and
 * the wave avoids the King and Queen. Returns the new Rules.
 */
export function startFloor(s: GameState, first: boolean): Rules {
  const d = s.descent!;
  const N = DESCENT_SIZE;
  s.mask = generateMask(d);
  const R = rulesFor(s);
  const g = R.geo;
  if (!first) {
    noteToken(s, `F${d.floor}`, '', false);
    log(s, 'n', `-- Floor ${d.floor} --`);
  }
  // The wave appears, anywhere on the floor except near the home row.
  const cands: Sq[] = [];
  for (let q = 0; q < N * N; q++) if (g.exists(q) && Math.floor(q / N) >= 4 && (!first || s.board[q] === null)) cands.push(q);
  const wave = waveFor(d, d.floor);
  const spots = spawnSquares(d, cands, wave.length);
  const fell = new Set<Sq>();
  // Pieces from the floor above land: on a missing square they die; on an enemy, both die.
  // The King's fate is settled last, so the rest of the fall happens even when it ends the run.
  const falling = first ? [] : Object.values(s.pieces).sort((a, b) => a.id - b.id || String(a.owner).localeCompare(String(b.owner)));
  const king = findRole(R, s, 0, 'king');
  const crushed = new Map<Sq, Piece>();
  let kingFate: 'void' | 'crushed' | null = null;
  d.lost = [];
  for (const p of falling) {
    if (!g.exists(p.sq)) {
      d.lost.push(p.uid);
      if (p === king) kingFate = 'void';
      else destroy(R, s, p.uid, 1, 'falls where the floor is missing');
    } else if (spots.includes(p.sq)) {
      crushed.set(p.sq, p);
      if (p === king) kingFate = 'crushed';
    } else fell.add(p.sq);
  }
  spots.forEach((q, i) => {
    const under = crushed.get(q);
    if (!under) {
      createUnit(R, s, 1, wave[i], q);
      return;
    }
    // The falling piece lands on the enemy: both are destroyed.
    d.lost.push(under.uid);
    const why = `lands on a Blue ${R.unit(wave[i]).name}; both are destroyed`;
    if (under !== king) destroy(R, s, under.uid, 1, why);
    s.board[q] = null; // the King (if it is him) is lifted until the end
    destroy(R, s, createUnit(R, s, 1, wave[i], q).uid, 0, 'is crushed from above');
    if (under === king) s.board[q] = king.uid;
  });
  // Tiles fall too.
  for (let q = 0; q < s.tiles.length; q++) {
    const t = s.tiles[q];
    if (!t) continue;
    if (!g.exists(q)) s.tiles[q] = null;
    else {
      t.spent = false;
      if (!first) fell.add(q);
    }
  }
  s.landings = []; // arriving on a floor is not a landing
  // Droplets to collect, and the Scroll on the last floor.
  const empty = () => {
    const out: Sq[] = [];
    for (let q = N; q < N * N; q++) if (g.exists(q) && s.board[q] === null && !d.drops.includes(q) && q !== d.scroll) out.push(q);
    return out;
  };
  d.drops = [];
  const n = 1 + randInt(d, 3);
  for (let i = 0; i < n; i++) {
    const free = empty();
    if (free.length) d.drops.push(pick(d, free));
  }
  d.scroll = null;
  if (d.floor === DESCENT_FLOORS) {
    const free = empty().sort((a, b) => b - a);
    const far = free.filter((q) => Math.floor(q / N) >= Math.floor(free[0] / N) - 1);
    if (far.length) d.scroll = pick(d, far);
  }
  d.fell = [...fell];
  d.budget = computeBudget(R, s, 0);
  s.budget = { ...d.budget };
  if (king && kingFate)
    destroy(R, s, king.uid, 1, kingFate === 'void' ? 'falls where the floor is missing' : 'lands on an enemy; both are destroyed');
  return R;
}

/** A Red unit landing on a droplet or the Scroll picks it up. */
export function pickUp(R: Rules, s: GameState, p: Piece): boolean {
  const d = s.descent!;
  if (p.owner !== 0 || p.kind !== 'unit') return false;
  const i = d.drops.indexOf(p.sq);
  if (i >= 0) {
    d.drops.splice(i, 1);
    d.droplets++;
    log(s, 0, `Red picks up a stone droplet at ${R.geo.name(p.sq)} (${d.droplets} held)`);
  }
  if (d.scroll === p.sq) {
    d.scroll = null;
    log(s, 0, 'Red takes the Legendary Scroll of Utanapishtim');
    return true;
  }
  return false;
}

/** Placing a stone in Descent spends a droplet and adds what that placement produces to the floor's budget. */
export function stonePlaced(R: Rules, s: GameState, before: Budget): void {
  const d = s.descent!;
  d.droplets = Math.max(0, d.droplets - 1);
  const after = computeBudget(R, s, 0);
  for (const k of Object.keys(after) as Array<keyof Budget>) s.budget[k] += Math.max(0, after[k] - before[k]);
}

// ---------------------------------------------------------------------------
// The enemy
// ---------------------------------------------------------------------------

/** King-step distance to every square from `from`, over the floor's squares (pieces ignored). */
function distances(R: Rules, from: Sq): Map<Sq, number> {
  const g = R.geo;
  const dist = new Map<Sq, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const q = queue.shift()!;
    for (const n of g.area(q, 1, false)) if (!dist.has(n)) (dist.set(n, dist.get(q)! + 1), queue.push(n));
  }
  return dist;
}

export type AiDecision = Input | { type: 'pass' };

/**
 * Blue's choice for its pending decision. Main action: attack a Red unit if
 * any unit can (the King first); otherwise move a random unit that can get
 * closer to the Red King, as close as it can. Other decisions: hit Red if
 * possible, else decline what can be declined, else any option.
 */
export function aiDecide(R: Rules, s: GameState, opts: Command[] = legalOptions(s)): AiDecision {
  const d = s.descent!;
  const pend = s.pending!;
  const player = pend.player;
  const king = findRole(R, s, 0, 'king');
  const specOf = (c: Command) => (c.a === -1 && pend.kind === 'effect' ? pend.spec : actionsOf(R, s, s.pieces[c.unit])[c.a]);
  const target = (c: Command) => {
    const q = c.picks[0];
    const t = typeof q === 'number' ? s.board[q] : null;
    return t ? s.pieces[t] : undefined;
  };
  const hits = opts.filter((c) => {
    const sp = specOf(c);
    const t = target(c);
    return !!sp && isAttack(sp) && t?.owner === 0 && t.kind === 'unit';
  });
  if (hits.length) {
    const onKing = hits.filter((c) => target(c)?.uid === king?.uid);
    return { type: 'choose', player, cmd: pick(d, onKing.length ? onKing : hits) };
  }
  if (pend.kind === 'action' && pend.context === 'main' && king) {
    const dist = distances(R, king.sq);
    const far = (q: Sq) => dist.get(q) ?? Infinity;
    const byUnit = new Map<string, Command[]>();
    for (const c of opts) if (specOf(c)?.kw === 'move') byUnit.set(c.unit, [...(byUnit.get(c.unit) ?? []), c]);
    const closer: Command[][] = [];
    for (const [uid, moves] of byUnit) {
      const best = Math.min(...moves.map((c) => far(c.picks[0] as Sq)));
      if (best < far(s.pieces[uid].sq)) closer.push(moves.filter((c) => far(c.picks[0] as Sq) === best));
    }
    if (!closer.length) return { type: 'pass' };
    return { type: 'choose', player, cmd: pick(d, pick(d, closer)) };
  }
  const optional = (pend.kind === 'action' || pend.kind === 'effect') && !!pend.optional;
  if (optional || !opts.length) return { type: 'skip', player };
  return { type: 'choose', player, cmd: pick(d, opts) };
}

/** Whether the engine plays this decision itself (Blue in Descent). */
export function isAiTurn(s: GameState): boolean {
  return !!s.descent && !!s.pending && s.pending.player === (1 as PlayerId);
}

/** The Red King and Blue's remaining units, for the UI. */
export function enemiesLeft(s: GameState): number {
  return unitsOf(s, 1).length;
}
