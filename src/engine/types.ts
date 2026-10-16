// Core type definitions for the Uatbotl engine.

import type { NoteTurn } from './notation';
//
// Everything here is plain, JSON-serialisable data. The whole game state can be
// snapshotted, sent over a network, or rebuilt by replaying the input log.

// ---------------------------------------------------------------------------
// Age data (the "data file" — see src/data)
// ---------------------------------------------------------------------------

export type Resource = 'E' | 'P' | 'D' | 'M' | 'I';
export const RESOURCES: readonly Resource[] = ['E', 'P', 'D', 'M', 'I'];
export type Budget = Record<Resource, number>;

/** Gate families. A unit with `gate` set counts as a gate of that family. */
export type GateType = string;

/**
 * Range strings, parsed by `geometry.parseRange`:
 *  - `rangeN`, `rangeNinc`, `adjacent`             (area)
 *  - `queensmove`, `rooksmove`, `bishopsmove`      (unlimited rays)
 *  - `<dirset>` or `<dirset>N`, e.g. `horizontal1` (rays, optionally limited)
 *  - `knightsmove`, `forwardjumpN`, `triforwardjumpN` (jumps)
 */
export type RangeSpec = string;

/** Direction sets for Shoot / Castle / Push. */
export type DirSet = 'eight' | 'orthogonal' | 'diagonal' | 'forward' | 'horizontal' | 'vertical';

export type BuildScope =
  /** Units of resource type `res` that need no gate, plus (with `gates`) every gate. The King. */
  | { res: Resource; gates?: boolean }
  /** Gates of this type, units requiring this gate, and tiles built by this gate. */
  | { gate: GateType };

export type ActionSpec =
  | { kw: 'move'; range: RangeSpec }
  | { kw: 'attack'; range: RangeSpec; dmg: number }
  | { kw: 'shoot'; dirs: DirSet; dmg: number }
  | { kw: 'build'; range: RangeSpec; scope: BuildScope }
  | { kw: 'push'; dist: number }
  | { kw: 'stonepush'; dist: number }
  /** Push the first piece along a ray, if it is a stone, any distance away along that ray. */
  | { kw: 'raypush'; dirs: DirSet }
  | { kw: 'undertaking'; range: RangeSpec }
  | { kw: 'castle'; dirs: DirSet }
  | { kw: 'relocate'; count: number; from: RangeSpec; to: RangeSpec }
  | { kw: 'reallocate'; count: number; from: RangeSpec; to: RangeSpec }
  /** Fill the `width` squares centred in front (default 3) with `unit`s of the owner, or neutral stones. */
  | { kw: 'shelter'; width?: number; unit?: string }
  /** Fill the square in front with a `unit` of the owner, or a neutral stone. */
  | { kw: 'shield'; unit?: string }
  | { kw: 'pave'; move: RangeSpec; tile: string }
  | { kw: 'lay'; tile: string; range: RangeSpec }
  | { kw: 'moveattack'; move: RangeSpec; attack: RangeSpec; dmg: number; requireTile?: boolean }
  | { kw: 'reinforce'; range: RangeSpec }
  /** Destroy every stone on the unit's file (`vertical`) or rank (`horizontal`). No line of sight needed. */
  | { kw: 'clear'; line: 'vertical' | 'horizontal' }
  /** The unit destroys itself. */
  | { kw: 'selfdestruct' }
  /** Place an own stone on an empty square in range, without moving (the Queen's stone throw). */
  | { kw: 'throw'; range: RangeSpec };

export type ActionKw = ActionSpec['kw'];

export type PassiveSpec =
  | { kw: 'extraAction'; n: number }
  | { kw: 'buildAction'; n: number }
  | { kw: 'shoot'; dirs: DirSet; dmg: number }
  | { kw: 'undertaking'; range: RangeSpec }
  /** Passive Move / Attack: done if possible, skipped if not (e.g. blocked). `optional`: may be declined. */
  | { kw: 'move'; range: RangeSpec; optional?: boolean }
  | { kw: 'attack'; range: RangeSpec; dmg: number }
  /** Passive stone throw (Ardent Follower's gift to the Queen). Mandatory when possible. */
  | { kw: 'throw'; range: RangeSpec }
  /** An optional bonus Attack, taken with any of the owner's units that has an Attack action (General). */
  | { kw: 'bonusAttack'; n: number };

export type TraitSpec =
  | { kw: 'memory' }
  | { kw: 'ipseity' }
  | { kw: 'unitary' }
  /** Dies whenever its owner's stones can no longer produce its cost (capability, not this turn's budget). */
  | { kw: 'fragile' }
  /** After a tile activates on this unit, it may move to an adjacent square (again after each further tile). */
  | { kw: 'royalpath' }
  /**
   * A grant to the owner's King (kingsgift) or Queen (queensgift). Non-additive
   * duplicates add nothing.
   */
  | {
      kw: 'queensgift' | 'kingsgift';
      passive?: PassiveSpec;
      action?: ActionSpec;
      trait?: TraitSpec;
      additive: boolean;
      text?: string;
    };

export interface UnitDef {
  id: string;
  /** Roster code, e.g. "D3". */
  code: string;
  name: string;
  /** Short glyph shown on the board (1–2 chars). */
  glyph: string;
  /** Code in game notation (letters only), when the glyph is not plain letters. */
  sym?: string;
  role?: 'king' | 'queen';
  hp: number;
  /** Omitted for units that cannot be built (King, Queen). */
  cost?: { res: Resource; n: number };
  requires?: GateType;
  gate?: GateType;
  actions: ActionSpec[];
  passives: PassiveSpec[];
  traits: TraitSpec[];
  note?: string;
}

export type TileEffect =
  | { kw: 'displace' }
  | { kw: 'attackArea'; range: RangeSpec; dmg: number }
  | { kw: 'selfExecute' }
  | { kw: 'undertaker' }
  /** Destroy every stone in range of the tile (including the tile's own square with `inc`). */
  | { kw: 'clearStones'; range: RangeSpec }
  | { kw: 'none' };

export interface TileDef {
  id: string;
  code: string;
  name: string;
  glyph: string;
  /** Code in game notation (letters only). */
  sym: string;
  type: 'consequence' | 'dogma';
  effect: TileEffect;
  cost?: { res: Resource; n: number };
  builtBy?: GateType;
  unitary?: boolean;
  shotboost?: number;
  /** Presentation hint (spec §16: tiles carry colour). */
  color: string;
  text: string;
}

export interface AgeDef {
  id: string;
  name: string;
  /**
   * Default board size (square). Ranks [0, floor(height/2)) are player 0's
   * half, the rest player 1's.
   */
  boardSize: number;
  /** The square board sizes a game may be created with. */
  boardSizes: number[];
  /**
   * Costs per board size: for each size, unit or tile id → cost amount (the
   * resource stays the same). Anything not listed costs its base `cost.n`.
   */
  costsBySize: Record<number, Record<string, number>>;
  stoneHp: number;
  reinforcedStoneHp: number;
  /**
   * Starting pieces, in ID order, per player, on the default board. On other
   * sizes the setup keeps every offset: files shift to stay centred, and each
   * player keeps their distance from their own back edge.
   */
  start: [Array<{ unit: string; at: string }>, Array<{ unit: string; at: string }>];
  units: UnitDef[];
  tiles: TileDef[];
  resourceNames: Record<Resource, string>;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type PlayerId = 0 | 1;
export type Owner = PlayerId | 'n';

/** Squares are integers: rank * width + file. File 0 = 'a', rank 0 = '1'. */
export type Sq = number;

export interface Piece {
  /** Stable unique key, e.g. "0#3", "n#1". */
  uid: string;
  /** Creation-order ID within its owner's sequence (§4.1). */
  id: number;
  owner: Owner;
  kind: 'unit' | 'stone';
  /** Unit definition id (units only). */
  def?: string;
  sq: Sq;
  hp: number;
  maxHp: number;
  reinforced?: boolean;
}

export interface DeadPiece extends Piece {
  /** Player whose Captures box holds this piece. */
  capturedBy: PlayerId;
  turn: number;
}

export interface TileInst {
  def: string;
  spent: boolean;
}

export interface Landing {
  uid: string;
  sq: Sq;
}

export type Task =
  | { t: 'startTurn' }
  | { t: 'passives'; uids: string[] }
  | { t: 'passiveSpecs'; uid: string; specs: PassiveSpec[] }
  | { t: 'actionPhase' }
  | { t: 'bonusBuild'; player: PlayerId }
  | { t: 'bonusAttack'; player: PlayerId; by: string }
  | { t: 'landings'; list: Landing[] }
  /** Royal Path: after a tile activated on this unit, it may step to an adjacent square. */
  | { t: 'royalPath'; uid: string }
  | { t: 'endTurn' };

/**
 * A decision the engine is waiting for. `player` is who must answer — usually
 * the turn player, but tile choices can belong to the opponent (e.g. Displace
 * of an enemy unit).
 */
export type Pending =
  | {
      kind: 'action';
      player: PlayerId;
      /**
       * main: a regular action. build: a Build Action bonus. selfExecute: bonus
       * action for one unit. attack: a bonus Attack with any unit (General).
       */
      context: 'main' | 'build' | 'selfExecute' | 'attack';
      unit?: string;
      optional: boolean;
      /** The unit that granted a bonus action (General), for notation. */
      by?: string;
    }
  | {
      /** A keyword effect not tied to an action slot (passive Undertaking, passive Shoot, Undertaker tile). */
      kind: 'effect';
      player: PlayerId;
      unit: string;
      spec: ActionSpec;
      /** Allow partial outcomes when no fully legal one exists ("do as much as possible"). */
      fallback: boolean;
      source: string;
      /** The player may decline it. */
      optional?: boolean;
    }
  | { kind: 'displace'; player: PlayerId; piece: string };

/**
 * A fully-specified choice. `a` is the index into the unit's action list,
 * or -1 for the pending effect's spec, or -2 for a displace square.
 * `picks` are the successive selections (squares, or a def id for Build,
 * or 'none' for a skipped stone placement).
 */
export interface Command {
  unit: string;
  a: number;
  picks: Array<Sq | string>;
}

export type Input =
  | { type: 'choose'; player: PlayerId; cmd: Command }
  | { type: 'skip'; player: PlayerId }
  | { type: 'resign'; player: PlayerId }
  | { type: 'offerDraw'; player: PlayerId }
  | { type: 'acceptDraw'; player: PlayerId }
  | { type: 'declineDraw'; player: PlayerId };

export interface GameResult {
  winner: PlayerId | null;
  reason: 'ipseity' | 'resignation' | 'stalemate' | 'agreement' | 'repetition';
}

export interface LogEntry {
  turn: number;
  player: Owner;
  text: string;
}

/** Options chosen when a game is created. */
export interface GameOptions {
  width?: number;
  height?: number;
}


export interface GameState {
  age: string;
  width: number;
  height: number;
  turn: number;
  active: PlayerId;
  pieces: Record<string, Piece>;
  board: Array<string | null>;
  tiles: Array<TileInst | null>;
  nextId: { '0': number; '1': number; n: number };
  /** Remaining budget of the active player this turn. */
  budget: Budget;
  /** Base actions still to take this turn. */
  actionsLeft: number;
  actionTaken: boolean;
  dead: Record<string, DeadPiece>;
  captures: [string[], string[]];
  tasks: Task[];
  pending: Pending | null;
  /** Landings recorded by the effect currently resolving. */
  landings: Landing[];
  /** Squares something moved to or was created on (piece, stone or tile) this turn. */
  arrivals: Sq[];
  /** The same for the previous turn (the other player's). */
  lastArrivals: Sq[];
  result: GameResult | null;
  repetition: Record<string, number>;
  drawOffer: PlayerId | null;
  log: LogEntry[];
  /** Game notation, one entry per turn (see notation.ts). */
  notes: NoteTurn[];
}
