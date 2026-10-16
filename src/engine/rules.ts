// Age registry, board queries and primitive mutations shared by the engine.

import { Geo } from './geometry';
import type {
  ActionSpec,
  AgeDef,
  Budget,
  BuildScope,
  GameOptions,
  GameState,
  Owner,
  PassiveSpec,
  Piece,
  PlayerId,
  Resource,
  Sq,
  TileDef,
  TraitSpec,
  UnitDef,
} from './types';
import { RESOURCES } from './types';
import { noteAppend } from './notation';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class Rules {
  readonly geo: Geo;
  readonly units = new Map<string, UnitDef>();
  readonly tiles = new Map<string, TileDef>();
  /** Unit types that give gifts (hot-path lookup). */
  readonly giftDefs = new Set<string>();
  /** The age with unit and tile costs set for this board size. */
  readonly age: AgeDef;

  constructor(age: AgeDef, width = age.boardSize, height = age.boardSize) {
    this.geo = new Geo(width, height);
    const sized = age.costsBySize[width] ?? {};
    const resize = <T extends { id: string; cost?: { res: Resource; n: number } }>(d: T): T =>
      d.cost && sized[d.id] !== undefined ? { ...d, cost: { ...d.cost, n: sized[d.id] } } : d;
    this.age = age = { ...age, units: age.units.map(resize), tiles: age.tiles.map(resize) };
    for (const u of age.units) {
      this.units.set(u.id, u);
      if (u.traits.some((t) => t.kw === 'queensgift' || t.kw === 'kingsgift')) this.giftDefs.add(u.id);
    }
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

const ages = new Map<string, AgeDef>();
/** Rules per age and board size, keyed "age:WxH". */
const registry = new Map<string, Rules>();

export function registerAge(age: AgeDef): Rules {
  ages.set(age.id, age);
  for (const k of registry.keys()) if (k.startsWith(`${age.id}:`)) registry.delete(k);
  return rulesFor(age.id);
}

/** Rules for an age (default board size), or for a game state (its own board size). */
export function rulesFor(ageOrState: string | GameState, opts: GameOptions = {}): Rules {
  const id = typeof ageOrState === 'string' ? ageOrState : ageOrState.age;
  const age = ages.get(id);
  if (!age) throw new Error(`Age not registered: ${id}`);
  const w = typeof ageOrState === 'string' ? (opts.width ?? age.boardSize) : ageOrState.width;
  const h = typeof ageOrState === 'string' ? (opts.height ?? age.boardSize) : ageOrState.height;
  const key = `${id}:${w}x${h}`;
  let r = registry.get(key);
  if (!r) registry.set(key, (r = new Rules(age, w, h)));
  return r;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

/** Actions that only deal damage count as attacks (Attack and Shoot), e.g. for the General. */
export function isAttack(spec: ActionSpec): boolean {
  return spec.kw === 'attack' || spec.kw === 'shoot';
}

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

type GiftTrait = Extract<TraitSpec, { kw: 'queensgift' | 'kingsgift' }>;

/**
 * Gifts a piece receives from its owner's units (§9.3): Kingsgift to the King,
 * Queensgift to the Queen. In ID order of the givers; non-additive duplicates
 * add nothing.
 */
function giftsTo(R: Rules, s: GameState, p: Piece): GiftTrait[] {
  const d = unitDef(R, p);
  if (!d || p.owner === 'n') return [];
  const kws = new Set<string>();
  if (d.role === 'king') kws.add('kingsgift');
  if (d.role === 'queen') kws.add('queensgift');
  const out: GiftTrait[] = [];
  const seen = new Set<string>();
  const givers: Piece[] = [];
  for (const q of Object.values(s.pieces)) if (q.owner === p.owner && q.def && R.giftDefs.has(q.def)) givers.push(q);
  if (!givers.length) return out;
  givers.sort((a, b) => a.id - b.id);
  for (const q of givers) {
    for (const t of unitDef(R, q)?.traits ?? []) {
      if (!kws.has(t.kw)) continue;
      const g = t as GiftTrait;
      const key = JSON.stringify([g.kw, g.passive, g.action, g.trait]);
      if (!g.additive) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(g);
    }
  }
  return out;
}

/** Passives of a piece, including gifted ones. */
export function effectivePassives(R: Rules, s: GameState, p: Piece): PassiveSpec[] {
  const d = unitDef(R, p);
  if (!d) return [];
  return [...d.passives, ...giftsTo(R, s, p).flatMap((g) => (g.passive ? [g.passive] : []))];
}

/** Action slots of a piece: its own, then gifted ones. A Command's `a` indexes this list. */
export function actionsOf(R: Rules, s: GameState, p: Piece): ActionSpec[] {
  const d = unitDef(R, p);
  if (!d) return [];
  return [...d.actions, ...giftsTo(R, s, p).flatMap((g) => (g.action ? [g.action] : []))];
}

/** Whether a piece has a trait, its own or gifted. */
export function hasEffectiveTrait(R: Rules, s: GameState, p: Piece, kw: TraitSpec['kw']): boolean {
  return hasTrait(R, p, kw) || giftsTo(R, s, p).some((g) => g.trait?.kw === kw);
}

/** Gifted traits of a piece (for display). */
export function giftedTraits(R: Rules, s: GameState, p: Piece): TraitSpec[] {
  return giftsTo(R, s, p).flatMap((g) => (g.trait ? [g.trait] : []));
}

// ---------------------------------------------------------------------------
// Economy (§10.2)
// ---------------------------------------------------------------------------

export function emptyBudget(): Budget {
  return { E: 0, P: 0, D: 0, M: 0, I: 0 };
}

/**
 * Every template instance behind a player's budget (§10.2): a pair of stones
 * for Prevenience (horizontal), Multiplicity (vertical) and Deduction
 * (diagonal), a single stone for Extension and Incursion (isolated stones).
 */
export function resourceInstances(R: Rules, s: GameState, player: PlayerId): Record<Resource, Sq[][]> {
  const g = R.geo;
  const own = new Set<Sq>();
  for (const p of piecesOf(s, player)) if (p.kind === 'stone') own.add(p.sq);
  const at = (f: number, r: number) => (g.inBounds(f, r) && own.has(g.sq(f, r)) ? g.sq(f, r) : null);
  const out: Record<Resource, Sq[][]> = { E: [], P: [], D: [], M: [], I: [] };
  for (const sq of [...own].sort((a, b) => a - b)) {
    const f = g.file(sq);
    const r = g.rank(sq);
    out.E.push([sq]);
    const pair = (res: Resource, q: Sq | null) => {
      if (q !== null) out[res].push([sq, q]);
    };
    pair('P', at(f + 1, r));
    pair('M', at(f, r + 1));
    pair('D', at(f + 1, r + 1));
    pair('D', at(f - 1, r + 1));
    // Incursion: part of no other template, i.e. no own stone in any of the 8 neighbours.
    let isolated = true;
    for (let df = -1; df <= 1 && isolated; df++)
      for (let dr = -1; dr <= 1; dr++) if ((df || dr) && at(f + df, r + dr) !== null) isolated = false;
    if (isolated) out.I.push([sq]);
  }
  return out;
}

export function computeBudget(R: Rules, s: GameState, player: PlayerId): Budget {
  const inst = resourceInstances(R, s, player);
  const b = emptyBudget();
  for (const r of RESOURCES) b[r] = inst[r].length;
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

/** Whether a builder with `scope` may build unit `u` at all (ignoring unlocks and budget). */
export function scopeAllows(scope: BuildScope, u: UnitDef): boolean {
  if ('gate' in scope) return u.gate ? u.gate === scope.gate : u.requires === scope.gate;
  if (u.gate) return !!scope.gates;
  return !u.requires && u.cost?.res === scope.res;
}

/** Everything a builder with `scope` may build for `player`, ignoring budget and squares. */
export function buildablesFor(R: Rules, s: GameState, player: PlayerId, scope: BuildScope): Buildable[] {
  const gates = controlledGates(R, s, player);
  const out: Buildable[] = [];
  for (const u of R.age.units) {
    if (!u.cost || !scopeAllows(scope, u)) continue;
    if (u.requires && !gates.has(u.requires)) continue;
    // Unitary units: one per player.
    if (u.traits.some((t) => t.kw === 'unitary') && unitsOf(s, player).some((p) => p.def === u.id)) continue;
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
  arrive(s, sq);
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
  arrive(s, to);
}

/** Note that something moved to or was created on `sq` this turn. */
export function arrive(s: GameState, sq: Sq): void {
  if (!s.arrivals.includes(sq)) s.arrivals.push(sq);
}

export function placeTile(R: Rules, s: GameState, sq: Sq, def: string): void {
  s.tiles[sq] = { def, spent: false };
  arrive(s, sq);
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
  kill(R, s, uid, by);
}

/** Destroy a piece outright (Clear, Self-destruct). `by` gets it in Captures (§13). */
export function destroy(R: Rules, s: GameState, uid: string, by: PlayerId, why: string): void {
  const p = s.pieces[uid];
  if (!p || s.result) return;
  log(s, by, `${describePiece(R, p)} ${why}`);
  kill(R, s, uid, by);
}

function kill(R: Rules, s: GameState, uid: string, by: PlayerId): void {
  const p = s.pieces[uid];
  s.board[p.sq] = null;
  delete s.pieces[uid];
  s.dead[uid] = { ...p, hp: 0, capturedBy: by, turn: s.turn };
  s.captures[by].push(uid);
  log(s, by, `${describePiece(R, p)} dies`);
  const ipseity = hasTrait(R, p, 'ipseity') && p.owner !== 'n';
  noteAppend(s, ipseity ? '##' : '#', R.geo.name(p.sq));
  if (ipseity) endGame(s, other(p.owner as PlayerId), 'ipseity');
}

export function budgetText(b: Budget): string {
  return RESOURCES.map((r) => `${r}${b[r]}`).join(' ');
}
