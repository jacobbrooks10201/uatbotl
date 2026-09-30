// Age registry, board queries and primitive mutations shared by the engine.

import { Geo } from './geometry';
import type {
  AgeDef,
  Budget,
  BuildScope,
  GameState,
  Owner,
  PassiveSpec,
  Piece,
  PlayerId,
  Sq,
  TileDef,
  TraitSpec,
  UnitDef,
} from './types';
import { RESOURCES } from './types';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class Rules {
  readonly geo: Geo;
  readonly units = new Map<string, UnitDef>();
  readonly tiles = new Map<string, TileDef>();

  constructor(readonly age: AgeDef) {
    this.geo = new Geo(age.boardSize);
    for (const u of age.units) this.units.set(u.id, u);
    for (const t of age.tiles) this.tiles.set(t.id, t);
  }

  unit(id: string): UnitDef {
    const u = this.units.get(id);
    if (!u) throw new Error(`Unknown unit: ${id}`);
    return u;
  }
  tile(id: string): TileDef {
    const t = this.tiles.get(id);
    if (!t) throw new Error(`Unknown tile: ${id}`);
    return t;
  }
}

const registry = new Map<string, Rules>();

export function registerAge(age: AgeDef): Rules {
  const r = new Rules(age);
  registry.set(age.id, r);
  return r;
}

export function rulesFor(ageOrState: string | GameState): Rules {
  const id = typeof ageOrState === 'string' ? ageOrState : ageOrState.age;
  const r = registry.get(id);
  if (!r) throw new Error(`Age not registered: ${id}`);
  return r;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

export function pieceAt(s: GameState, sq: Sq | null): Piece | undefined {
  if (sq === null) return undefined;
  const uid = s.board[sq];
  return uid ? s.pieces[uid] : undefined;
}

export function isEmpty(s: GameState, sq: Sq): boolean {
  return s.board[sq] === null;
}

/** Forward direction (+1 / -1 in ranks). Neutral pieces use the turn player's forward. */
export function forwardOf(s: GameState, owner: Owner): number {
  const p = owner === 'n' ? s.active : owner;
  return p === 0 ? 1 : -1;
}

/** Sort key for §4.1 resolution order: turn player → neutral → opponent, each by ID. */
export function orderKey(s: GameState, p: Pick<Piece, 'owner' | 'id'>): number {
  const group = p.owner === s.active ? 0 : p.owner === 'n' ? 1 : 2;
  return group * 1_000_000 + p.id;
}

export function sortPieces<T extends Pick<Piece, 'owner' | 'id'>>(s: GameState, list: T[]): T[] {
  return [...list].sort((a, b) => orderKey(s, a) - orderKey(s, b));
}

export function unitDef(R: Rules, p: Piece): UnitDef | undefined {
  return p.kind === 'unit' && p.def ? R.unit(p.def) : undefined;
}

export function hasTrait(R: Rules, p: Piece, kw: TraitSpec['kw']): boolean {
  const d = unitDef(R, p);
  return !!d && d.traits.some((t) => t.kw === kw);
}

export function piecesOf(s: GameState, owner: Owner): Piece[] {
  return Object.values(s.pieces).filter((p) => p.owner === owner);
}

export function unitsOf(s: GameState, owner: Owner): Piece[] {
  return piecesOf(s, owner)
    .filter((p) => p.kind === 'unit')
    .sort((a, b) => a.id - b.id);
}

export function findRole(R: Rules, s: GameState, owner: PlayerId, role: 'king' | 'queen'): Piece | undefined {
  return unitsOf(s, owner).find((p) => unitDef(R, p)?.role === role);
}

/** Gate families this player controls (spec §11: unlocking). */
export function controlledGates(R: Rules, s: GameState, player: PlayerId): Set<string> {
  const out = new Set<string>();
  for (const p of unitsOf(s, player)) {
    const g = unitDef(R, p)?.gate;
    if (g) out.add(g);
  }
  return out;
}

/**
 * Effective passives of a piece, including Kingsgift / Queensgift grants from
 * its owner's other pieces (§9.3). Non-additive duplicates add nothing.
 */
export function effectivePassives(R: Rules, s: GameState, p: Piece): PassiveSpec[] {
  const d = unitDef(R, p);
  if (!d) return [];
  const out: PassiveSpec[] = [...d.passives];
  if (!d.role || p.owner === 'n') return out;
  const giftKw = d.role === 'king' ? 'kingsgift' : 'queensgift';
  const seen = new Set<string>();
  for (const q of unitsOf(s, p.owner)) {
    const qd = unitDef(R, q);
    if (!qd) continue;
    for (const t of qd.traits) {
      if (t.kw !== giftKw) continue;
      const key = JSON.stringify(t.passive);
      if (!t.additive) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(t.passive);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Economy (§10.2)
// ---------------------------------------------------------------------------

export function emptyBudget(): Budget {
  return { E: 0, A: 0, D: 0, M: 0, I: 0 };
}

export function computeBudget(R: Rules, s: GameState, player: PlayerId): Budget {
  const g = R.geo;
  const own = new Set<Sq>();
  for (const p of piecesOf(s, player)) if (p.kind === 'stone') own.add(p.sq);
  const has = (f: number, r: number) => g.inBounds(f, r) && own.has(g.sq(f, r));
  const b = emptyBudget();
  for (const sq of own) {
    const f = g.file(sq);
    const r = g.rank(sq);
    b.E++;
    if (has(f + 1, r)) b.A++;
    if (has(f, r + 1)) b.M++;
    if (has(f + 1, r + 1)) b.D++;
    if (has(f - 1, r + 1)) b.D++;
    // Incursion: part of no other template, i.e. no own stone in any of the 8 neighbours.
    let isolated = true;
    for (let df = -1; df <= 1 && isolated; df++)
      for (let dr = -1; dr <= 1; dr++) if ((df || dr) && has(f + df, r + dr)) isolated = false;
    if (isolated) b.I++;
  }
  return b;
}

/** Budget available to `player` right now. Only the turn player has one. */
export function budgetFor(s: GameState, player: PlayerId): Budget {
  return player === s.active ? s.budget : emptyBudget();
}

export interface Buildable {
  kind: 'unit' | 'tile';
  id: string;
  cost: { res: keyof Budget; n: number };
}

/** Everything a builder with `scope` may build for `player`, ignoring budget and squares. */
export function buildablesFor(R: Rules, s: GameState, player: PlayerId, scope: BuildScope): Buildable[] {
  const gates = controlledGates(R, s, player);
  const out: Buildable[] = [];
  for (const u of R.age.units) {
    if (!u.cost) continue;
    if (u.requires && !gates.has(u.requires)) continue;
    if ('gate' in scope && !(u.gate || u.requires === scope.gate)) continue;
    out.push({ kind: 'unit', id: u.id, cost: u.cost });
  }
  if ('gate' in scope) {
    for (const t of R.age.tiles) {
      if (t.cost && t.builtBy === scope.gate) out.push({ kind: 'tile', id: t.id, cost: t.cost });
    }
  }
  return out;
}

export function affordable(b: Budget, cost: { res: keyof Budget; n: number }): boolean {
  return cost.n <= 0 || b[cost.res] >= cost.n;
}

export function tileAllowedAt(R: Rules, s: GameState, sq: Sq, tileId: string): boolean {
  if (s.tiles[sq]) return false;
  const t = R.tile(tileId);
  if (t.unitary) {
    const half = R.geo.half(sq);
    for (let i = 0; i < s.tiles.length; i++) {
      const ti = s.tiles[i];
      if (ti && ti.def === tileId && R.geo.half(i) === half) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function log(s: GameState, player: Owner, text: string): void {
  s.log.push({ turn: s.turn, player, text });
}

export function describePiece(R: Rules, p: Piece): string {
  const side = p.owner === 'n' ? 'Neutral' : p.owner === 0 ? 'Red' : 'Blue';
  const name = p.kind === 'stone' ? (p.reinforced ? 'reinforced stone' : 'stone') : unitDef(R, p)!.name;
  return `${side} ${name} #${p.id}`;
}

function newPiece(R: Rules, s: GameState, owner: Owner, kind: 'unit' | 'stone', sq: Sq, def?: string): Piece {
  if (s.board[sq] !== null) throw new Error(`Square ${R.geo.name(sq)} is occupied`);
  const key = owner === 'n' ? 'n' : owner === 0 ? '0' : '1';
  const id = s.nextId[key]++;
  const hp = kind === 'stone' ? R.age.stoneHp : R.unit(def!).hp;
  const p: Piece = { uid: `${key}#${id}`, id, owner, kind, sq, hp, maxHp: hp };
  if (def) p.def = def;
  s.pieces[p.uid] = p;
  s.board[sq] = p.uid;
  s.landings.push({ uid: p.uid, sq });
  return p;
}

export function createUnit(R: Rules, s: GameState, owner: PlayerId, def: string, sq: Sq): Piece {
  return newPiece(R, s, owner, 'unit', sq, def);
}

export function createStone(R: Rules, s: GameState, owner: Owner, sq: Sq): Piece {
  return newPiece(R, s, owner, 'stone', sq);
}

/** Move a piece to an empty square. Records a landing. */
export function movePiece(s: GameState, uid: string, to: Sq): void {
  const p = s.pieces[uid];
  if (s.board[to] !== null) throw new Error('Destination occupied');
  s.board[p.sq] = null;
  s.board[to] = uid;
  p.sq = to;
  s.landings.push({ uid, sq: to });
}

export function placeTile(R: Rules, s: GameState, sq: Sq, def: string): void {
  s.tiles[sq] = { def, spent: false };
  // A tile placed beneath a piece is a landing for that piece (§12.2).
  const uid = s.board[sq];
  if (uid) s.landings.push({ uid, sq });
  void R;
}

export function endGame(s: GameState, winner: PlayerId | null, reason: NonNullable<GameState['result']>['reason']): void {
  if (s.result) return;
  s.result = { winner, reason };
  s.tasks = [];
  s.pending = null;
  s.landings = [];
}

/** Deal damage. `by` is the player credited with any kill (§13). */
export function damage(R: Rules, s: GameState, uid: string, n: number, by: PlayerId): void {
  const p = s.pieces[uid];
  if (!p || s.result || n <= 0) return;
  p.hp -= n;
  log(s, by, `${describePiece(R, p)} takes ${n} damage (${Math.max(p.hp, 0)}/${p.maxHp})`);
  if (p.hp > 0) return;
  s.board[p.sq] = null;
  delete s.pieces[uid];
  s.dead[uid] = { ...p, hp: 0, capturedBy: by, turn: s.turn };
  s.captures[by].push(uid);
  log(s, by, `${describePiece(R, p)} dies`);
  if (hasTrait(R, p, 'ipseity') && p.owner !== 'n') endGame(s, other(p.owner), 'ipseity');
}

export function budgetText(b: Budget): string {
  return RESOURCES.map((r) => `${r}${b[r]}`).join(' ');
}
