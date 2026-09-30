import {
  applyInput,
  commandKey,
  DEFAULT_AGE,
  legalOptions,
  newScenario,
  rulesFor,
  type Command,
  type GameState,
  type PlayerId,
  type Scenario,
} from '../src/engine';

export const R = rulesFor(DEFAULT_AGE);
export const sq = (n: string) => R.geo.parse(n);
export const nm = (q: number) => R.geo.name(q);

export function scenario(sc: Scenario): GameState {
  return newScenario(DEFAULT_AGE, sc);
}

export function at(s: GameState, name: string) {
  const uid = s.board[sq(name)];
  return uid ? s.pieces[uid] : undefined;
}

/** Normalise picks: square names become squares, other strings stay (def ids, 'none'). */
function norm(picks: string[]): Array<number | string> {
  return picks.map((p) => (/^[a-p]\d{1,2}$/.test(p) ? sq(p) : p));
}

/** Find a legal option for the piece on `from`, action slot `a`, with the given picks. */
export function option(s: GameState, from: string | null, a: number, picks: string[]): Command {
  const want = norm(picks);
  const unit = from ? at(s, from)?.uid : s.pending && 'piece' in s.pending ? s.pending.piece : undefined;
  const opts = legalOptions(s);
  const found = opts.find(
    (c) =>
      (unit === undefined || c.unit === unit || (s.pending?.kind === 'effect' && c.unit === s.pending.unit)) &&
      c.a === a &&
      c.picks.length === want.length &&
      c.picks.every((p, i) => p === want[i]),
  );
  if (!found) {
    const mine = opts.filter((c) => unit === undefined || c.unit === unit).map(commandKey);
    throw new Error(`No option ${from} a=${a} [${picks}] — have: ${mine.slice(0, 40).join('  ')}`);
  }
  return found;
}

export function play(s: GameState, from: string | null, a: number, picks: string[] = []): GameState {
  const player = s.pending!.player as PlayerId;
  return applyInput(s, { type: 'choose', player, cmd: option(s, from, a, picks) });
}

export function has(s: GameState, from: string, a: number, picks: string[]): boolean {
  try {
    option(s, from, a, picks);
    return true;
  } catch {
    return false;
  }
}

/** Board/piece map consistency. */
export function checkInvariants(s: GameState): void {
  let count = 0;
  s.board.forEach((uid, i) => {
    if (!uid) return;
    count++;
    const p = s.pieces[uid];
    if (!p) throw new Error(`board ${i} → missing piece ${uid}`);
    if (p.sq !== i) throw new Error(`piece ${uid} sq ${p.sq} ≠ board ${i}`);
    if (p.hp <= 0) throw new Error(`piece ${uid} alive with hp ${p.hp}`);
  });
  if (count !== Object.keys(s.pieces).length) throw new Error('piece count mismatch');
}
