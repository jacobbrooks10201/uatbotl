// Game notation: chess-like, plain typable ASCII, no brackets of any kind.
//
//   16x16 1. Qg4@k8 Kh15 2. K+Sch2,Kh3 Va*e9#|Wa:e7 ... 1-0
//
// The header is the board size. Each round is "N. red blue" ("N... blue" if
// Blue moves first). A turn is its prelude (passives, bonus builds), then
// "|", then its main actions; actions are joined by ",". Consequences attach
// to the action that caused them.
//
// P is a unit's notation code (its glyph, or `sym`), optionally followed by
// its origin file, rank or square when another unit with that code could
// produce the same text. T is a tile code.
//
//   Pf2        Move                      P:f2       Attack
//   P*f2       Shoot                     P+Xf2      Build unit or tile X on f2
//   P>f2g3     Push / Stonepush / ray Stonepush: the piece on f2 goes to g3
//              (Push and Stonepush name the first square of the push)
//   Pf2@c5     Undertaking, stone on c5  Pf2@       Undertaking, no stone
//   PO-O       Castle                    Pf2-f3     Relocate / Reallocate f2's piece to f3
//   P=         Shelter / Shield          Pf3T       Pave: move to f3, leaving tile T
//   PTf2       Lay tile T on f2          Pf2:f5     Moveattack: move to f2, attack f5
//   P^f2       Reinforce                 P&         Clear the stones on its line
//   P~         Self-destruct             P@f2       Stone throw: a stone on f2, no move
//   P-         A declined option: the Advisor's King move, Royal Path, the General's bonus Attack
//
// Consequences, in the order they happen. A square is written only when it
// differs from the last square written:
//
//   !Tf2       tile T on f2 activates    #f2        the piece on f2 dies
//   ##f2       a King dies               d6         a displaced piece's square (after !Dp)
//   -          a Self-Execute action declined
//
// The result follows the last turn: 1-0, 0-1 or 1/2-1/2.
//
// Every choice's text is unique among the legal options of its decision, so
// `parseNotation` can rebuild the exact input list from the text alone.

import { actionsOf, type Rules } from './rules';
import type { ActionSpec, Command, GameState, PlayerId, Sq } from './types';

export interface NoteTurn {
  turn: number;
  player: PlayerId;
  pre: string[];
  main: string[];
  phase: 'pre' | 'main';
  /** Last square written, so repeated squares can be omitted. */
  last: string;
}

// ---------------------------------------------------------------------------
// Recording (called by the engine)
// ---------------------------------------------------------------------------

function cur(s: GameState): NoteTurn | undefined {
  return s.notes[s.notes.length - 1];
}

export function noteTurnStart(s: GameState): void {
  s.notes.push({ turn: s.turn, player: s.active, pre: [], main: [], phase: 'pre', last: '' });
}

export function noteMainPhase(s: GameState): void {
  const c = cur(s);
  if (c) c.phase = 'main';
}

/** A new action token, or (nested) one continuing the previous token, e.g. a Self-Execute action. */
export function noteToken(s: GameState, text: string, last: string, nested: boolean): void {
  const c = cur(s);
  if (!c) return;
  const list = c[c.phase];
  if (nested && list.length) list[list.length - 1] += text;
  else list.push(text);
  c.last = last;
}

/** Append a consequence mark. `sq` is omitted when it repeats the last square, unless forced. */
export function noteAppend(s: GameState, mark: string, sq?: string, force = false): void {
  const c = cur(s);
  if (!c) return;
  let t = mark;
  if (sq !== undefined && (force || sq !== c.last)) t += sq;
  if (sq !== undefined) c.last = sq;
  const list = c[c.phase];
  if (list.length) list[list.length - 1] += t;
  else list.push(t);
}

// ---------------------------------------------------------------------------
// Text of a choice
// ---------------------------------------------------------------------------

/** Notation code of a unit or tile. */
export function symOf(R: Rules, id: string): string {
  const u = R.units.get(id);
  return u ? (u.sym ?? u.glyph) : R.tile(id).sym;
}

/** The spec a command uses. `cache` holds each unit's action list for the current decision. */
function specFor(R: Rules, s: GameState, c: Command, cache: Map<string, ActionSpec[]>): ActionSpec | null {
  if (c.a === -1) return s.pending?.kind === 'effect' ? s.pending.spec : null;
  const p = s.pieces[c.unit];
  if (!p?.def) return null;
  let acts = cache.get(p.uid);
  if (!acts) cache.set(p.uid, (acts = actionsOf(R, s, p)));
  return acts[c.a] ?? null;
}

/** The action text after the unit glyph, plus the last square it names. */
function body(R: Rules, spec: ActionSpec, picks: Command['picks']): [string, string] {
  const n = (q: Sq | string) => R.geo.name(q as Sq);
  const a = picks[0];
  const b = picks[1];
  switch (spec.kw) {
    case 'move':
      return [n(a), n(a)];
    case 'attack':
      return [`:${n(a)}`, n(a)];
    case 'shoot':
      return [`*${n(a)}`, n(a)];
    case 'build':
      return [`+${symOf(R, a as string)}${n(b)}`, n(b)];
    case 'push':
    case 'stonepush':
    case 'raypush':
      return [`>${n(a)}${n(b)}`, n(b)];
    case 'undertaking':
      return b === 'none' ? [`${n(a)}@`, n(a)] : [`${n(a)}@${n(b)}`, n(b)];
    case 'castle':
      return ['O-O', ''];
    case 'relocate':
    case 'reallocate':
      return [`${n(a)}-${n(b)}`, n(b)];
    case 'shelter':
    case 'shield':
      return ['=', ''];
    case 'pave':
      return [`${n(a)}${symOf(R, spec.tile)}`, n(a)];
    case 'lay':
      return [`${symOf(R, spec.tile)}${n(a)}`, n(a)];
    case 'moveattack':
      return [`${n(a)}:${n(b)}`, n(b)];
    case 'reinforce':
      return [`^${n(a)}`, n(a)];
    case 'clear':
      return ['&', ''];
    case 'selfdestruct':
      return ['~', ''];
    case 'throw':
      return [`@${n(a)}`, n(a)];
  }
}

/**
 * Text of every legal option of the current decision (and the last square
 * each names), in the order of `opts`. Units that share a glyph and would
 * otherwise read the same are told apart by origin file, then rank, then the
 * full square.
 */
export function optionTexts(R: Rules, s: GameState, opts: Command[]): Array<[string, string]> {
  const pend = s.pending;
  if (pend?.kind === 'displace') {
    return opts.map((c) => {
      const q = R.geo.name(c.picks[0] as Sq);
      return [q, q];
    });
  }
  const actionCache = new Map<string, ActionSpec[]>();
  const base = opts.map((c) => {
    const p = s.pieces[c.unit];
    const [text, last] = body(R, specFor(R, s, c, actionCache)!, c.picks);
    return { glyph: symOf(R, p.def!), text, last, sq: p.sq };
  });
  const groups = new Map<string, number[]>();
  base.forEach((b, i) => {
    const k = `${b.glyph}|${b.text}`;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const g = R.geo;
  return opts.map((c, i) => {
    const b = base[i];
    let dis = '';
    if (c.a >= 0) {
      const rivals = groups.get(`${b.glyph}|${b.text}`)!.filter((j) => opts[j].unit !== c.unit && opts[j].a >= 0);
      if (rivals.length) {
        const sameFile = rivals.some((j) => g.file(base[j].sq) === g.file(b.sq));
        const sameRank = rivals.some((j) => g.rank(base[j].sq) === g.rank(b.sq));
        const name = g.name(b.sq);
        dis = !sameFile ? name[0] : !sameRank ? name.slice(1) : name;
      }
    }
    return [b.glyph + dis + b.text, b.last];
  });
}

/** Text of one legal option (`cmd` must be in `opts`). */
export function optionText(R: Rules, s: GameState, cmd: Command, opts: Command[]): [string, string] {
  const i = opts.indexOf(cmd);
  if (i < 0) throw new Error('optionText: command is not among the options');
  return optionTexts(R, s, opts)[i];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "|" appears once the main phase starts, so a turn's text only ever grows by appending. */
function turnText(t: NoteTurn): string {
  const main = t.main.join(',');
  if (!t.pre.length) return main;
  return t.phase === 'main' ? `${t.pre.join(',')}|${main}` : t.pre.join(',');
}

/** The moves, without header or result. */
export function formatMoves(s: GameState): string {
  const out: string[] = [];
  let round = 0;
  let open = false; // a round line with Red's turn awaiting Blue's
  for (const t of s.notes) {
    const text = turnText(t);
    if (!text) continue;
    if (t.player === 0) {
      round++;
      out.push(`${round}. ${text}`);
      open = true;
    } else {
      if (!open) {
        round++;
        out.push(`${round}... ${text}`);
      } else out[out.length - 1] += ` ${text}`;
      open = false;
    }
  }
  return out.join(' ');
}

export function resultText(s: GameState): string {
  if (!s.result) return '';
  return s.result.winner === null ? '1/2-1/2' : s.result.winner === 0 ? '1-0' : '0-1';
}

/** Full notation: board size, moves, result. */
export function formatNotation(s: GameState): string {
  return [`${s.width}x${s.height}`, formatMoves(s), resultText(s)].filter(Boolean).join(' ');
}

/** One line per round, for display. */
export function notationRounds(s: GameState): string[] {
  return formatMoves(s).split(/ (?=\d+\.)/).filter(Boolean);
}
