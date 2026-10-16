// Match layer: the seam between the UI and "where the game lives".
//
// The UI only ever talks to a MatchClient. Today that is a LocalMatch
// (hotseat, both seats on one screen). An online client implements the same
// interface: it sends inputs to a server and applies the inputs the server
// broadcasts back. Because the engine is deterministic and an entire game is
// its input log, the wire protocol only has to carry Inputs (see docs/ONLINE.md).

import {
  applyInput,
  applyInputMut,
  DEFAULT_AGE,
  IllegalInput,
  newGame,
  type GameOptions,
  type GameState,
  type Input,
  type PlayerId,
} from '../engine';

export interface MatchClient {
  readonly state: GameState;
  /** Seats this client may act for. Hotseat: both. Online: one. */
  readonly seats: readonly PlayerId[];
  readonly inputs: readonly Input[];
  /** Validate and apply an input. Throws IllegalInput if it is not legal. */
  submit(input: Input): void;
  canUndo(): boolean;
  undo(): void;
  subscribe(fn: () => void): () => void;
}

export interface SaveFile {
  format: 'uatbotl-save';
  version: 1;
  age: string;
  /** Board size etc. Absent in older saves (default board). */
  options?: GameOptions;
  inputs: Input[];
}

/** Keep a full snapshot every N inputs; undo replays forward from the nearest one. */
const CHECKPOINT_EVERY = 16;

export class LocalMatch implements MatchClient {
  readonly seats: readonly PlayerId[] = [0, 1];
  private current: GameState;
  private checkpoints = new Map<number, GameState>();
  private log: Input[] = [];
  private listeners = new Set<() => void>();

  constructor(
    readonly age: string = DEFAULT_AGE,
    inputs: Input[] = [],
    readonly options: GameOptions = {},
  ) {
    this.current = newGame(age, options);
    this.checkpoints.set(0, structuredClone(this.current));
    for (const i of inputs) this.push(applyInput(this.current, i), i);
  }

  get state(): GameState {
    return this.current;
  }
  get inputs(): readonly Input[] {
    return this.log;
  }

  submit(input: Input): void {
    if (!this.seats.includes(input.player)) throw new IllegalInput('Not your seat');
    this.push(applyInput(this.current, input), input);
    this.emit();
  }

  canUndo(): boolean {
    return this.log.length > 0;
  }

  /** The state after the first `n` inputs (for replay). Replays from the nearest checkpoint. */
  stateAt(n: number): GameState {
    n = Math.max(0, Math.min(n, this.log.length));
    if (n === this.log.length) return this.current;
    const base = Math.floor(n / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
    const s = structuredClone(this.checkpoints.get(base)!);
    for (let i = base; i < n; i++) applyInputMut(s, this.log[i]);
    return s;
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.log.pop();
    const n = this.log.length;
    for (const k of this.checkpoints.keys()) if (k > n) this.checkpoints.delete(k);
    const base = Math.floor(n / CHECKPOINT_EVERY) * CHECKPOINT_EVERY;
    const s = structuredClone(this.checkpoints.get(base)!);
    for (let i = base; i < n; i++) applyInputMut(s, this.log[i]);
    this.current = s;
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  toSave(): SaveFile {
    return { format: 'uatbotl-save', version: 1, age: this.age, options: { ...this.options }, inputs: [...this.log] };
  }

  static fromSave(data: unknown): LocalMatch {
    const f = data as SaveFile;
    if (!f || f.format !== 'uatbotl-save' || !Array.isArray(f.inputs)) throw new Error('Not a Uatbotl save file');
    return new LocalMatch(f.age, f.inputs, f.options ?? {});
  }

  private push(next: GameState, input: Input): void {
    this.current = next;
    this.log.push(input);
    if (this.log.length % CHECKPOINT_EVERY === 0) this.checkpoints.set(this.log.length, structuredClone(next));
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
