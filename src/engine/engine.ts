// The Uatbotl rules engine.
//
// The engine is a small interpreter over a stack of serialisable tasks. It runs
// until it needs a decision (`state.pending`) or the game ends. Inputs answer
// decisions. Everything is deterministic: a game is fully described by its
// starting age and its list of inputs, which is what makes local undo,
// save files and (later) online lockstep / server-authoritative play simple.

import { commandKey, legalOptions, lineSquares, planCastle, wallVectors } from './options';
import { formatNotation, formatMoves, noteAppend, noteMainPhase, noteToken, noteTurnStart, optionText, optionTexts, symOf } from './notation';
import {
  actionsOf,
  budgetText,
  computeBudget,
  arrive,
  createStone,
  createUnit,
  damage,
  describePiece,
  destroy,
  effectivePassives,
  emptyBudget,
  endGame,
  forwardOf,
  hasEffectiveTrait,
  log,
  movePiece,
  other,
  pieceAt,
  placeTile,
  rulesFor,
  sortPieces,
  unitDef,
  unitsOf,
  type Rules,
} from './rules';
import { attackTargets, planPush, rangeSquares, shotDamage } from './targeting';
import type { ActionSpec, Command, GameOptions, GameState, Input, Landing, PassiveSpec, Pending, PlayerId, Sq } from './types';

export { commandKey, legalOptions } from './options';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export function newGame(ageId: string, opts: GameOptions = {}): GameState {
  const R = rulesFor(ageId, checkOptions(ageId, opts));
  const base = rulesFor(ageId).geo;
  const g = R.geo;
  // Keep every starting offset: files shift to stay centred; each side keeps
  // its distance from its own back edge.
  const df = Math.floor((g.width - base.width) / 2);
  return newScenario(
    ageId,
    {
      pieces: R.age.start.flatMap((list, player) =>
        list.map(({ unit, at }) => {
          const q = base.parse(at);
          const r = base.half(q) === 0 ? base.rank(q) : base.rank(q) + g.height - base.height;
          return { owner: player as PlayerId, unit, at: g.name(g.sq(base.file(q) + df, r)) };
        }),
      ),
    },
    opts,
  );
}

/** Validate game options; returns them with the age defaults filled in. */
export function checkOptions(ageId: string, opts: GameOptions): Required<GameOptions> {
  const age = rulesFor(ageId).age;
  const width = opts.width ?? age.boardSize;
  const height = opts.height ?? age.boardSize;
  if (width !== height || !age.boardSizes.includes(width))
    throw new Error(`Board size must be one of ${age.boardSizes.map((n) => `${n}x${n}`).join(', ')}`);
  return { width, height };
}

/** A custom starting position, for tests, puzzles and playtest setups. */
export interface Scenario {
  /** Pieces in creation order. Omit `unit` for a stone. */
  pieces: Array<{ owner: PlayerId | 'n'; unit?: string; at: string; hp?: number; reinforced?: boolean }>;
  tiles?: Array<{ tile: string; at: string }>;
  active?: PlayerId;
  turn?: number;
}

export function newScenario(ageId: string, sc: Scenario, opts: GameOptions = {}): GameState {
  const R = rulesFor(ageId, checkOptions(ageId, opts));
  const n = R.geo.squares;
  const s: GameState = {
    age: ageId,
    width: R.geo.width,
    height: R.geo.height,
    turn: 1,
    active: 0,
    pieces: {},
    board: new Array(n).fill(null),
    tiles: new Array(n).fill(null),
    nextId: { '0': 1, '1': 1, n: 1 },
    budget: emptyBudget(),
    actionsLeft: 0,
    actionTaken: false,
    dead: {},
    captures: [[], []],
    tasks: [{ t: 'startTurn' }],
    pending: null,
    landings: [],
    arrivals: [],
    lastArrivals: [],
    result: null,
    repetition: {},
    drawOffer: null,
    log: [],
    notes: [],
  };
  s.active = sc.active ?? 0;
  s.turn = sc.turn ?? 1;
  for (const d of sc.pieces) {
    const sq = R.geo.parse(d.at);
    const p = d.unit
      ? createUnit(R, s, d.owner as PlayerId, d.unit, sq)
      : createStone(R, s, d.owner, sq);
    if (d.reinforced) {
      p.reinforced = true;
      p.maxHp = p.hp = R.age.reinforcedStoneHp;
    }
    if (d.hp !== undefined) p.hp = d.hp;
  }
  for (const t of sc.tiles ?? []) s.tiles[R.geo.parse(t.at)] = { def: t.tile, spent: false };
  s.landings = []; // setup placement is not a landing
  s.arrivals = [];
  run(R, s);
  return s;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class IllegalInput extends Error {}

/** Apply an input to a copy of the state and return the new state. Throws IllegalInput. */
export function applyInput(state: GameState, input: Input): GameState {
  const s: GameState = structuredClone(state);
  applyInputMut(s, input);
  return s;
}

/** In-place variant of applyInput. */
export function applyInputMut(s: GameState, input: Input): void {
  const R = rulesFor(s);
  if (s.result) throw new IllegalInput('The game is over');
  switch (input.type) {
    case 'resign':
      log(s, input.player, `${side(input.player)} resigns`);
      endGame(s, other(input.player), 'resignation');
      return;
    case 'offerDraw':
      if (s.drawOffer === null) {
        s.drawOffer = input.player;
        log(s, input.player, `${side(input.player)} offers a draw`);
      }
      return;
    case 'acceptDraw':
      if (s.drawOffer === null || s.drawOffer === input.player) throw new IllegalInput('No draw offer to accept');
      log(s, input.player, `${side(input.player)} accepts the draw`);
      endGame(s, null, 'agreement');
      return;
    case 'declineDraw':
      if (s.drawOffer === null || s.drawOffer === input.player) throw new IllegalInput('No draw offer to decline');
      s.drawOffer = null;
      log(s, input.player, `${side(input.player)} declines the draw`);
      return;
    case 'skip': {
      const p = s.pending;
      if (!p || p.player !== input.player) throw new IllegalInput('Not your decision');
      if (!((p.kind === 'action' || p.kind === 'effect') && p.optional)) throw new IllegalInput('This decision cannot be skipped');
      if (p.kind === 'effect') {
        // A declined optional effect (Advisor's move, Royal Path) is written as the unit's code and "-".
        log(s, input.player, `${side(input.player)} declines ${p.source}`);
        noteToken(s, `${symOf(R, s.pieces[p.unit].def!)}-`, '', p.source !== 'passive');
      } else if (p.context === 'attack' && p.by) {
        // A declined bonus Attack is written as the granting unit's code and "-" (Gn-).
        log(s, input.player, `${side(input.player)} declines the bonus Attack`);
        noteToken(s, `${symOf(R, s.pieces[p.by]?.def ?? 'general')}-`, '', false);
      } else {
        log(s, input.player, `${side(input.player)} declines the bonus action`);
        noteAppend(s, '-');
      }
      s.pending = null;
      run(R, s);
      return;
    }
    case 'choose': {
      const p = s.pending;
      if (!p || p.player !== input.player) throw new IllegalInput('Not your decision');
      const key = commandKey(input.cmd);
      const opts = legalOptions(s);
      const cmd = opts.find((c) => commandKey(c) === key);
      if (!cmd) throw new IllegalInput(`Illegal choice: ${key}`);
      resolveChoice(R, s, cmd, opts);
      run(R, s);
      return;
    }
  }
}

/** Player the UI should ask right now, or null. */
export function decider(s: GameState): PlayerId | null {
  return s.pending ? s.pending.player : null;
}

/** Look up the ActionSpec a command refers to. */
export function specOf(s: GameState, cmd: Command): ActionSpec | null {
  const R = rulesFor(s);
  if (cmd.a === -1) return s.pending?.kind === 'effect' ? s.pending.spec : null;
  if (cmd.a < 0) return null;
  const p = s.pieces[cmd.unit];
  const d = p && unitDef(R, p);
  return d ? (actionsOf(R, s, p)[cmd.a] ?? null) : null;
}

/** Positional key of the start-of-turn board for repetition (§5). HP and IDs are ignored. */
export function positionKey(s: GameState): string {
  const parts: string[] = [`t${s.active}`];
  for (let i = 0; i < s.board.length; i++) {
    const uid = s.board[i];
    const tile = s.tiles[i];
    if (!uid && !tile) continue;
    let e = `${i}`;
    if (uid) {
      const p = s.pieces[uid];
      e += `:${p.owner}${p.kind === 'stone' ? (p.reinforced ? 'R' : 'S') : p.def}`;
    }
    if (tile) e += `/${tile.def}`;
    parts.push(e);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

const side = (p: PlayerId | 'n') => (p === 'n' ? 'Neutral' : p === 0 ? 'Red' : 'Blue');

function flushLandings(s: GameState): void {
  if (!s.landings.length || s.result) {
    s.landings = [];
    return;
  }
  const withIds = s.landings
    .filter((l) => s.pieces[l.uid])
    .map((l) => ({ ...l, owner: s.pieces[l.uid].owner, id: s.pieces[l.uid].id }));
  const list: Landing[] = sortPieces(s, withIds).map(({ uid, sq }) => ({ uid, sq }));
  s.landings = [];
  if (list.length) s.tasks.push({ t: 'landings', list });
}

/** Ask for a decision. Decisions with no option are skipped; single forced options auto-resolve. */
function request(R: Rules, s: GameState, p: Pending): void {
  s.pending = p;
  if (p.kind === 'action' && p.context === 'main') return;
  const opts = legalOptions(s);
  if (opts.length === 0) {
    s.pending = null;
    return;
  }
  const optional = (p.kind === 'action' || p.kind === 'effect') && !!p.optional;
  if (opts.length === 1 && !optional) resolveChoice(R, s, opts[0], opts);
}

function run(R: Rules, s: GameState): void {
  flushLandings(s);
  let guard = 0;
  while (!s.pending && !s.result && s.tasks.length) {
    if (++guard > 100_000) throw new Error('Engine loop guard tripped');
    const task = s.tasks[s.tasks.length - 1];
    switch (task.t) {
      case 'startTurn': {
        s.tasks.pop();
        const key = positionKey(s);
        s.repetition[key] = (s.repetition[key] ?? 0) + 1;
        if (s.repetition[key] >= 3) {
          log(s, 'n', 'Third repetition of the position: draw');
          endGame(s, null, 'repetition');
          return;
        }
        noteTurnStart(s);
        s.lastArrivals = s.arrivals;
        s.arrivals = [];
        s.budget = computeBudget(R, s, s.active);
        s.actionsLeft = 0;
        s.actionTaken = false;
        log(s, s.active, `-- Turn ${s.turn}: ${side(s.active)} -- budget ${budgetText(s.budget)}`);
        checkFragile(R, s);
        if (s.result) return;
        const uids = sortPieces(s, unitsOf(s, s.active)).map((p) => p.uid);
        s.tasks.push({ t: 'endTurn' }, { t: 'actionPhase' }, { t: 'passives', uids });
        break;
      }
      case 'passives': {
        const uid = task.uids.shift();
        if (uid === undefined) {
          s.tasks.pop();
          break;
        }
        const p = s.pieces[uid];
        if (p) {
          const specs = effectivePassives(R, s, p);
          if (specs.length) s.tasks.push({ t: 'passiveSpecs', uid, specs: [...specs] });
        }
        break;
      }
      case 'passiveSpecs': {
        const spec = task.specs.shift();
        if (!spec) {
          s.tasks.pop();
          break;
        }
        if (s.pieces[task.uid]) runPassive(R, s, task.uid, spec);
        break;
      }
      case 'actionPhase': {
        noteMainPhase(s);
        if (s.actionsLeft <= 0) {
          s.tasks.pop();
          break;
        }
        s.pending = { kind: 'action', player: s.active, context: 'main', optional: false };
        if (legalOptions(s).length === 0) {
          s.pending = null;
          if (!s.actionTaken) {
            log(s, s.active, `${side(s.active)} has no legal action`);
            endGame(s, other(s.active), 'stalemate');
            return;
          }
          s.actionsLeft = 0; // later actions with no legal option are forfeited
        }
        break;
      }
      case 'bonusAttack':
        s.tasks.pop();
        request(R, s, { kind: 'action', player: task.player, context: 'attack', optional: true, by: task.by });
        break;
      case 'bonusBuild':
        s.tasks.pop();
        request(R, s, { kind: 'action', player: task.player, context: 'build', optional: false });
        break;
      case 'landings': {
        const l = task.list.shift();
        if (!l) {
          s.tasks.pop();
          break;
        }
        resolveLanding(R, s, l);
        break;
      }
      case 'royalPath': {
        s.tasks.pop();
        const k = s.pieces[task.uid];
        if (k && k.owner !== 'n')
          request(R, s, {
            kind: 'effect',
            player: k.owner,
            unit: k.uid,
            spec: { kw: 'move', range: 'adjacent' },
            fallback: false,
            source: 'Royal Path',
            optional: true,
          });
        break;
      }
      case 'endTurn': {
        s.tasks.pop();
        for (const p of Object.values(s.pieces)) {
          const d = unitDef(R, p);
          const memory = !!d && d.traits.some((t) => t.kw === 'memory');
          if (!memory) p.hp = p.maxHp;
        }
        for (const t of s.tiles) if (t) t.spent = false;
        s.budget = emptyBudget();
        s.active = other(s.active);
        s.turn++;
        s.tasks.push({ t: 'startTurn' });
        break;
      }
    }
    flushLandings(s);
  }
}

/**
 * Start of turn: the turn player's Fragile units die if this turn's budget
 * (what their stones produce) no longer covers their cost. Before passives,
 * so a fallen unit grants nothing this turn.
 */
function checkFragile(R: Rules, s: GameState): void {
  for (const p of unitsOf(s, s.active)) {
    const d = unitDef(R, p)!;
    if (!d.cost || !d.traits.some((t) => t.kw === 'fragile')) continue;
    if (s.budget[d.cost.res] < d.cost.n) {
      destroy(R, s, p.uid, s.active, `crumbles: its owner can no longer produce ${d.cost.n}${d.cost.res}`);
      if (s.result) return;
    }
  }
}

function runPassive(R: Rules, s: GameState, uid: string, spec: PassiveSpec): void {
  const p = s.pieces[uid];
  const player = p.owner as PlayerId;
  switch (spec.kw) {
    case 'extraAction':
      s.actionsLeft += spec.n;
      break;
    case 'buildAction':
      for (let i = 0; i < spec.n; i++) s.tasks.push({ t: 'bonusBuild', player });
      break;
    case 'bonusAttack':
      for (let i = 0; i < spec.n; i++) s.tasks.push({ t: 'bonusAttack', player, by: uid });
      break;
    case 'throw':
      request(R, s, { kind: 'effect', player, unit: uid, spec, fallback: false, source: 'passive' });
      break;
    case 'shoot':
      request(R, s, { kind: 'effect', player, unit: uid, spec, fallback: false, source: 'passive' });
      break;
    case 'undertaking':
      request(R, s, { kind: 'effect', player, unit: uid, spec, fallback: true, source: 'passive' });
      break;
    // Passive Move / Attack: done if possible; a blocked move or an empty square in range is skipped.
    case 'move':
      request(R, s, {
        kind: 'effect',
        player,
        unit: uid,
        spec: { kw: 'move', range: spec.range },
        fallback: false,
        source: 'passive',
        optional: !!spec.optional,
      });
      break;
    case 'attack':
      request(R, s, { kind: 'effect', player, unit: uid, spec, fallback: false, source: 'passive' });
      break;
  }
}

/** Destroy every stone on `squares`, in ID order. Returns false if the game ended. */
function clearStones(R: Rules, s: GameState, squares: Sq[], by: PlayerId): boolean {
  const stones = squares.map((q) => pieceAt(s, q)).filter((p): p is NonNullable<typeof p> => p?.kind === 'stone');
  for (const st of sortPieces(s, stones)) {
    destroy(R, s, st.uid, by, 'is cleared');
    if (s.result) return false;
  }
  return true;
}

function resolveLanding(R: Rules, s: GameState, l: Landing): void {
  const tile = s.tiles[l.sq];
  const p = s.pieces[l.uid];
  // The tile only activates if the piece is still standing on it (interpretation, see docs/RULES_NOTES.md).
  if (!tile || tile.spent || !p || p.sq !== l.sq) return;
  const def = R.tile(tile.def);
  if (def.type !== 'consequence') return;
  tile.spent = true;
  log(s, s.active, `${def.name} at ${R.geo.name(l.sq)} activates on ${describePiece(R, p)}`);
  noteAppend(s, `!${def.sym}`, R.geo.name(l.sq));
  // Royal Path: once this tile's whole cascade has resolved, the unit may step to an adjacent square.
  if (p.kind === 'unit' && hasEffectiveTrait(R, s, p, 'royalpath')) s.tasks.push({ t: 'royalPath', uid: p.uid });
  const owner: PlayerId = p.owner === 'n' || p.kind === 'stone' ? s.active : p.owner;
  const e = def.effect;
  switch (e.kw) {
    case 'none':
      break;
    case 'displace':
      request(R, s, { kind: 'displace', player: owner, piece: p.uid });
      break;
    case 'attackArea': {
      const hit = attackAreaTargets(R, s, l.sq, e.range);
      for (const t of hit) {
        damage(R, s, t.uid, e.dmg, s.active); // tile damage belongs to the turn player (§13)
        if (s.result) return;
      }
      break;
    }
    case 'clearStones':
      // Tile kills belong to the turn player (§13).
      clearStones(R, s, rangeSquares(R, s, l.sq, e.range, forwardOf(s, s.active)), s.active);
      break;
    case 'selfExecute':
      if (p.kind !== 'unit') break;
      request(R, s, { kind: 'action', player: owner, context: 'selfExecute', unit: p.uid, optional: true });
      break;
    case 'undertaker': {
      if (p.kind !== 'unit') break;
      const move = unitDef(R, p)?.actions.find((a) => a.kw === 'move');
      if (!move || move.kw !== 'move') break;
      request(R, s, {
        kind: 'effect',
        player: owner,
        unit: p.uid,
        spec: { kw: 'undertaking', range: move.range },
        fallback: true,
        source: def.name,
      });
      break;
    }
  }
}

function attackAreaTargets(R: Rules, s: GameState, center: Sq, range: string) {
  const fw = forwardOf(s, s.active);
  // attackTargets on an area range returns occupied squares; `inc` includes the tile square.
  const squares = attackTargets(R, s, center, range, fw);
  const pieces = squares.map((q) => s.pieces[s.board[q]!]);
  return sortPieces(s, pieces);
}

// ---------------------------------------------------------------------------
// Applying a chosen command
// ---------------------------------------------------------------------------

function resolveChoice(R: Rules, s: GameState, cmd: Command, opts: Command[]): void {
  const pend = s.pending!;
  const [text, last] = optionText(R, s, cmd, opts);
  s.pending = null;
  if (pend.kind === 'displace') {
    noteAppend(s, '', text, true);
    const p = s.pieces[cmd.unit];
    log(s, pend.player, `${describePiece(R, p)} is displaced to ${R.geo.name(cmd.picks[0] as Sq)}`);
    movePiece(s, cmd.unit, cmd.picks[0] as Sq);
    return;
  }
  if (pend.kind === 'action' && pend.context === 'main') {
    s.actionsLeft--;
    s.actionTaken = true;
    if (s.drawOffer !== null && s.drawOffer !== pend.player) s.drawOffer = null; // moving on declines implicitly
  }
  // Self-Execute actions and tile-driven effects continue the token that triggered them.
  const nested = pend.kind === 'effect' ? pend.source !== 'passive' : pend.context === 'selfExecute';
  noteToken(s, text, last, nested);
  const spec = pend.kind === 'effect' ? pend.spec : actionsOf(R, s, s.pieces[cmd.unit])[cmd.a];
  applySpec(R, s, cmd, spec, pend.player);
}

function applySpec(R: Rules, s: GameState, cmd: Command, spec: ActionSpec, player: PlayerId): void {
  const g = R.geo;
  const p = s.pieces[cmd.unit];
  const by: PlayerId = p.owner === 'n' ? player : p.owner;
  const fw = forwardOf(s, p.owner);
  const who = describePiece(R, p);
  const sqA = cmd.picks[0] as Sq;
  const sqB = cmd.picks[1] as Sq;
  const name = (q: Sq) => g.name(q);

  switch (spec.kw) {
    case 'move':
      log(s, by, `${who} moves ${name(p.sq)}->${name(sqA)}`);
      movePiece(s, p.uid, sqA);
      break;

    case 'attack':
    case 'moveattack': {
      let target = sqA;
      if (spec.kw === 'moveattack') {
        log(s, by, `${who} moves ${name(p.sq)}->${name(sqA)}`);
        movePiece(s, p.uid, sqA);
        target = sqB;
      }
      const t = pieceAt(s, target)!;
      log(s, by, `${who} attacks ${describePiece(R, t)}`);
      damage(R, s, t.uid, spec.dmg, by);
      break;
    }

    case 'shoot': {
      const t = pieceAt(s, sqA)!;
      const dmg = shotDamage(R, s, p.sq, sqA, spec.dmg);
      log(s, by, `${who} shoots ${describePiece(R, t)}`);
      damage(R, s, t.uid, dmg, by);
      break;
    }

    case 'build': {
      const id = cmd.picks[0] as string;
      const at = sqB;
      const unit = R.units.get(id);
      const cost = unit ? unit.cost! : R.tile(id).cost!;
      if (player === s.active) s.budget[cost.res] -= cost.n;
      if (unit) {
        const np = createUnit(R, s, by, id, at);
        log(s, by, `${who} builds ${describePiece(R, np)} at ${name(at)} (${cost.n}${cost.res})`);
      } else {
        placeTile(R, s, at, id);
        log(s, by, `${who} builds ${R.tile(id).name} at ${name(at)} (${cost.n}${cost.res})`);
      }
      break;
    }

    case 'push':
    case 'stonepush':
    case 'raypush': {
      const v = g.dirTo(sqA, sqB)!;
      // Ray stonepush: picks are the stone and where it ends up.
      const plan = planPush(R, s, sqA, v, spec.kw === 'raypush' ? g.dist(sqA, sqB) : spec.dist);
      log(s, by, `${who} pushes ${describePiece(R, pieceAt(s, sqA)!)} (${plan.moves.size} piece(s) move)`);
      // Lift every moving piece, then set them down, so the cascade never collides.
      for (const uid of plan.moves.keys()) s.board[s.pieces[uid].sq] = null;
      for (const [uid, to] of plan.moves) {
        s.board[to] = uid;
        s.pieces[uid].sq = to;
        s.landings.push({ uid, sq: to });
        arrive(s, to);
      }
      break;
    }

    case 'undertaking': {
      log(s, by, `${who} undertakes ${name(p.sq)}->${name(sqA)}`);
      movePiece(s, p.uid, sqA);
      if (cmd.picks[1] !== 'none') {
        const st = createStone(R, s, by, sqB);
        log(s, by, `${describePiece(R, st)} placed at ${name(sqB)}`);
      }
      break;
    }

    case 'castle': {
      const v = g.dirTo(p.sq, sqA)!;
      const plan = planCastle(R, s, p, v)!;
      log(s, by, `${who} castles`);
      if (plan.kingTo !== null) movePiece(s, plan.king.uid, plan.kingTo);
      if (plan.unitTo !== null) movePiece(s, p.uid, plan.unitTo);
      break;
    }

    case 'relocate':
    case 'reallocate': {
      const t = pieceAt(s, sqA)!;
      log(s, by, `${who} moves ${describePiece(R, t)} ${name(sqA)}->${name(sqB)}`);
      movePiece(s, t.uid, sqB);
      break;
    }

    case 'shelter':
    case 'shield': {
      const vs = wallVectors(spec, fw);
      const squares = vs
        .map((v) => g.step(p.sq, v))
        .filter((q): q is Sq => q !== null && s.board[q] === null)
        // Left to right from the turn player's perspective (§4.1).
        .sort((a, b) => (s.active === 0 ? g.file(a) - g.file(b) : g.file(b) - g.file(a)));
      const wall = spec.unit ? R.unit(spec.unit).name : 'stone';
      log(s, by, `${who} raises ${spec.kw === 'shelter' ? 'Shelter' : 'Shield'} (${squares.length} ${wall}(s))`);
      for (const q of squares) {
        if (spec.unit) createUnit(R, s, by, spec.unit, q);
        else createStone(R, s, 'n', q);
      }
      break;
    }

    case 'pave': {
      const from = p.sq;
      log(s, by, `${who} paves ${name(from)}->${name(sqA)}`);
      movePiece(s, p.uid, sqA);
      if (!s.tiles[from]) placeTile(R, s, from, spec.tile);
      break;
    }

    case 'lay':
      log(s, by, `${who} lays ${R.tile(spec.tile).name} at ${name(sqA)}`);
      placeTile(R, s, sqA, spec.tile);
      break;

    case 'clear':
      log(s, by, `${who} clears the ${spec.line === 'vertical' ? 'file' : 'rank'}`);
      clearStones(R, s, lineSquares(R, p.sq, spec.line), by);
      break;

    case 'selfdestruct':
      destroy(R, s, p.uid, by, 'self-destructs');
      break;

    case 'throw': {
      const st = createStone(R, s, by, sqA);
      log(s, by, `${who} throws ${describePiece(R, st)} to ${name(sqA)}`);
      break;
    }


    case 'reinforce': {
      const t = pieceAt(s, sqA)!;
      t.reinforced = true;
      t.maxHp = R.age.reinforcedStoneHp;
      t.hp = t.maxHp;
      log(s, by, `${who} reinforces ${describePiece(R, t)}`);
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Reading notation back
// ---------------------------------------------------------------------------

export interface ParsedGame {
  options: GameOptions;
  inputs: Input[];
  state: GameState;
}

/**
 * Rebuild a game from its notation (see notation.ts). The engine replays the
 * game and, at every decision, takes the option whose text comes next. Where
 * one option's text is a prefix of another's, the wrong branch dies at the
 * next token and the search backs up. Throws if the text is not a game.
 */
export function parseNotation(text: string, ageId: string): ParsedGame {
  let src = text.trim().replace(/\s+/g, ' ');
  const head = /^(\d+)x(\d+)(?: |$)/.exec(src);
  if (!head) throw new Error('Notation must start with the board size, e.g. 16x16');
  const options: GameOptions = { width: Number(head[1]), height: Number(head[2]) };
  src = src.slice(head[0].length);
  const res = / ?(1-0|0-1|1\/2-1\/2)$/.exec(src);
  const result = res?.[1];
  const target = res ? src.slice(0, res.index) : src;
  const start = newGame(ageId, options);
  const R = rulesFor(start);
  // Separators that may precede the next choice's text.
  const sep = /^(?: ?\d+\.(?:\.\.)? | |,|\|)*/;

  const search = (s: GameState, inputs: Input[]): GameState | null => {
    for (;;) {
      const done = formatMoves(s);
      // The text may end mid-game. It may also stop just before forced steps the
      // engine plays by itself (e.g. a passive Shoot with one target), as long
      // as it stops between tokens.
      if (done === target || (done.startsWith(target) && /^[ ,|]/.test(done.slice(target.length)))) {
        const got = finish(s, inputs);
        if (got) return got;
      }
      if (!target.startsWith(done)) return null;
      if (s.result || !s.pending) return null;
      const rest = target.slice(done.length).replace(sep, '');
      const p = s.pending;
      const opts = legalOptions(s);
      const texts = optionTexts(R, s, opts);
      const cands: Input[] = opts
        .filter((_, i) => rest.startsWith(texts[i][0]))
        .map((cmd) => ({ type: 'choose', player: p.player, cmd }));
      if (p.kind === 'action' && p.optional) {
        const skip = p.context === 'attack' && p.by ? `${symOf(R, s.pieces[p.by]?.def ?? 'general')}-` : '-';
        if (rest.startsWith(skip)) cands.push({ type: 'skip', player: p.player });
      }
      if (p.kind === 'effect' && p.optional && rest.startsWith(`${symOf(R, s.pieces[p.unit].def!)}-`))
        cands.push({ type: 'skip', player: p.player });
      if (cands.length === 0) return null;
      if (cands.length === 1) {
        s = applyInput(s, cands[0]);
        inputs.push(cands[0]);
        continue;
      }
      for (const c of cands) {
        const branch = [...inputs, c];
        const got = search(applyInput(s, c), branch);
        if (got) {
          inputs.splice(0, inputs.length, ...branch);
          return got;
        }
      }
      return null;
    }
  };

  // The result: a decisive one the engine did not reach is a resignation; a draw it did not reach was agreed.
  const finish = (s: GameState, inputs: Input[]): GameState | null => {
    if (!s.result && result) {
      const extra: Input[] =
        result === '1/2-1/2'
          ? [
              { type: 'offerDraw', player: s.active },
              { type: 'acceptDraw', player: other(s.active) },
            ]
          : [{ type: 'resign', player: result === '1-0' ? 1 : 0 }];
      for (const i of extra) {
        s = applyInput(s, i);
        inputs.push(i);
      }
    }
    return resultMatches(s) ? s : null;
  };
  const resultMatches = (s: GameState) => (s.result ? formatNotation(s).endsWith(` ${result}`) : !result);

  const inputs: Input[] = [];
  const state = search(start, inputs);
  if (!state) throw new Error('Notation does not describe a legal game');
  return { options, inputs, state };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export function actionLabel(spec: ActionSpec): string {
  switch (spec.kw) {
    case 'move':
      return `Move {${spec.range}}`;
    case 'attack':
      return `Attack {${spec.range}} {dmg=${spec.dmg}}`;
    case 'shoot':
      return `Shoot {${spec.dirs}} {dmg=${spec.dmg}}`;
    case 'build':
      return `Build {${'gate' in spec.scope ? spec.scope.gate : `${spec.scope.res} units${spec.scope.gates ? ' + gates' : ''}`}} {${spec.range}}`;
    case 'push':
      return `Push {${spec.dist}}`;
    case 'stonepush':
      return `Stonepush {${spec.dist}}`;
    case 'raypush':
      return `Stonepush {${spec.dirs} ray} {any distance}`;
    case 'undertaking':
      return `Undertaking {${spec.range}}`;
    case 'castle':
      return `Castle {${spec.dirs}}`;
    case 'relocate':
      return `Relocate {${spec.count}} unit {${spec.from}}→{${spec.to}}`;
    case 'reallocate':
      return `Reallocate {${spec.count}} stone {${spec.from}}→{${spec.to}}`;
    case 'shelter':
      return `${spec.width && spec.width !== 3 ? `Shelter {${spec.width}}` : 'Shelter'}${spec.unit ? ` {${spec.unit}}` : ''}`;
    case 'shield':
      return `Shield${spec.unit ? ` {${spec.unit}}` : ''}`;
    case 'pave':
      return `Pave {${spec.move}} {${spec.tile}}`;
    case 'lay':
      return `Lay {${spec.tile}} {${spec.range}}`;
    case 'moveattack':
      return `Moveattack {${spec.move}} {${spec.attack}} {dmg=${spec.dmg}}${spec.requireTile ? ' (onto a tile)' : ''}`;
    case 'reinforce':
      return `Reinforce {${spec.range}}`;
    case 'clear':
      return `Clear stones {entire ${spec.line === 'vertical' ? 'file' : 'rank'}}`;
    case 'selfdestruct':
      return 'Self-destruct';
    case 'throw':
      return `Stone throw {${spec.range}}`;
  }
}
