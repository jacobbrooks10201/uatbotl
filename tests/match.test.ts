import { describe, expect, it } from 'vitest';
import { legalOptions } from '../src/engine';
import { LocalMatch } from '../src/net/match';

function playRandom(m: LocalMatch, n: number, seed = 7) {
  let x = seed;
  const rand = () => (x = (x * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < n && !m.state.result; i++) {
    const opts = legalOptions(m.state);
    m.submit({ type: 'choose', player: m.state.pending!.player, cmd: opts[Math.floor(rand() * opts.length)] });
  }
}

describe('LocalMatch', () => {
  it('undo across checkpoints restores the exact earlier state', () => {
    const m = new LocalMatch();
    const states: string[] = [JSON.stringify(m.state)];
    let x = 3;
    const rand = () => (x = (x * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 40 && !m.state.result; i++) {
      const opts = legalOptions(m.state);
      m.submit({ type: 'choose', player: m.state.pending!.player, cmd: opts[Math.floor(rand() * opts.length)] });
      states.push(JSON.stringify(m.state));
    }
    while (m.canUndo()) {
      m.undo();
      expect(JSON.stringify(m.state)).toBe(states[m.inputs.length]);
    }
  });

  it('save files replay to the same state', () => {
    const m = new LocalMatch();
    playRandom(m, 30);
    const loaded = LocalMatch.fromSave(JSON.parse(JSON.stringify(m.toSave())));
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(m.state));
  });

  it('save files keep the board size', () => {
    const m = new LocalMatch(undefined, [], { width: 12, height: 12 });
    playRandom(m, 30);
    const loaded = LocalMatch.fromSave(JSON.parse(JSON.stringify(m.toSave())));
    expect([loaded.state.width, loaded.state.height]).toEqual([12, 12]);
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(m.state));
  });

  it('older saves without options load on the default board', () => {
    const m = new LocalMatch();
    playRandom(m, 10);
    const { options: _omit, ...old } = m.toSave();
    void _omit;
    expect(LocalMatch.fromSave(old).state.width).toBe(16);
  });
});
