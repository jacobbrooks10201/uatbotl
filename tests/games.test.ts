// The sample games in games/ must load from their notation and replay to the
// identical game, and games/every-unit.txt must involve the whole roster.

import { describe, expect, it } from 'vitest';
import everyUnit from '../games/every-unit.txt?raw';
import { DEFAULT_AGE, formatNotation, parseNotation, rulesFor } from '../src/engine';
import { LocalMatch } from '../src/net/match';

describe('games/every-unit.txt', () => {
  const text = everyUnit.trim();
  const parsed = parseNotation(text, DEFAULT_AGE);

  it('reads back to exactly the same notation', () => {
    expect(formatNotation(parsed.state)).toBe(text);
  });

  it('replays: a match built from its inputs, and from its save file, reaches the same game', () => {
    const m = new LocalMatch(DEFAULT_AGE, parsed.inputs, parsed.options);
    expect(formatNotation(m.state)).toBe(text);
    const loaded = LocalMatch.fromSave(JSON.parse(JSON.stringify(m.toSave())));
    expect(JSON.stringify(loaded.state)).toBe(JSON.stringify(m.state));
    // Every intermediate position is reachable for the replay viewer, and each one's notation is a prefix of the game.
    for (let n = 0; n <= m.inputs.length; n += 7) expect(text.startsWith(formatNotation(m.stateAt(n)))).toBe(true);
  });

  it('builds every unit and every buildable tile', () => {
    const R = rulesFor(parsed.state);
    const seen = new Set<string>();
    for (const i of parsed.inputs) if (i.type === 'choose' && typeof i.cmd.picks[0] === 'string') seen.add(i.cmd.picks[0]);
    const buildable = [...R.age.units.filter((u) => u.cost).map((u) => u.id), ...R.age.tiles.filter((t) => t.cost).map((t) => t.id)];
    expect(buildable.filter((id) => !seen.has(id))).toEqual([]);
    // Paved tiles (Displace, Undertaker) appear too.
    for (const sym of ['Dp', 'Ut']) expect(text).toContain(sym);
  });
});
