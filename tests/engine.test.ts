import { describe, expect, it } from 'vitest';
import {
  applyInput,
  computeBudget,
  DEFAULT_AGE,
  legalOptions,
  newGame,
  type GameState,
  type PlayerId,
} from '../src/engine';
import { castRay } from '../src/engine/targeting';
import { ALL_DIRS } from '../src/engine/geometry';
import { at, checkInvariants, has, play, R, scenario, sq } from './helpers';

const K0 = { owner: 0 as const, unit: 'king', at: 'a1' };
const Q0 = { owner: 0 as const, unit: 'queen', at: 'c1' };
const K1 = { owner: 1 as const, unit: 'king', at: 'p16' };
const Q1 = { owner: 1 as const, unit: 'queen', at: 'n16' };

function stones(owner: PlayerId | "n", squares: string[]) {
  return squares.map((s) => ({ owner, at: s }));
}

describe('setup', () => {
  it('starts with King and Queen, one action, empty budget', () => {
    const s = newGame(DEFAULT_AGE);
    expect(at(s, 'i1')?.def).toBe('king');
    expect(at(s, 'g1')?.def).toBe('queen');
    expect(at(s, 'h16')?.def).toBe('king');
    expect(at(s, 'j16')?.def).toBe('queen');
    expect(at(s, 'i1')?.id).toBe(1);
    expect(at(s, 'g1')?.id).toBe(2);
    expect(s.actionsLeft).toBe(1);
    expect(s.pending).toMatchObject({ kind: 'action', player: 0, context: 'main' });
    expect(s.budget).toEqual({ E: 0, A: 0, D: 0, M: 0, I: 0 });
  });

  it('no starting piece has line of sight to an enemy piece', () => {
    const s = newGame(DEFAULT_AGE);
    for (const p of Object.values(s.pieces)) {
      for (const v of ALL_DIRS) {
        const hit = castRay(R, s, p.sq, v);
        if (hit) expect(hit.owner).toBe(p.owner);
      }
    }
  });
});

describe('economy (§10.2)', () => {
  const shapes: Array<[string, string[], Record<string, number>]> = [
    ['row of four', ['d5', 'e5', 'f5', 'g5'], { E: 4, A: 3, D: 0, M: 0, I: 0 }],
    ['column of four', ['d5', 'd6', 'd7', 'd8'], { E: 4, A: 0, D: 0, M: 3, I: 0 }],
    ['diagonal of four', ['d5', 'e6', 'f7', 'g8'], { E: 4, A: 0, D: 3, M: 0, I: 0 }],
    ['2x2 block', ['d5', 'e5', 'd6', 'e6'], { E: 4, A: 2, D: 2, M: 2, I: 0 }],
    ['four isolated', ['a5', 'd5', 'g5', 'j5'], { E: 4, A: 0, D: 0, M: 0, I: 4 }],
  ];
  for (const [name, squares, expected] of shapes) {
    it(name, () => {
      const s = scenario({ pieces: [K0, Q0, K1, Q1, ...stones(0, squares)] });
      expect(computeBudget(R, s, 0)).toEqual(expected);
      expect(s.budget).toEqual(expected);
    });
  }

  it('enemy and neutral stones never count, even for isolation', () => {
    const s = scenario({ pieces: [K0, Q0, K1, Q1, ...stones(0, ['e5']), ...stones(1, ['e6']), ...stones('n', ['f5'])] });
    expect(computeBudget(R, s, 0)).toEqual({ E: 1, A: 0, D: 0, M: 0, I: 1 });
  });

  it('building spends the budget; nothing carries over', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, ...stones(0, ['h8', 'j8'])] }); // E2 I2
    expect(s0.budget.E).toBe(2);
    const s1 = play(s0, 'a1', 2, ['slinger', 'b2']);
    expect(at(s1, 'b2')?.def).toBe('slinger');
    // Now Blue's turn; Red's budget is gone and will be recomputed next turn.
    expect(s1.active).toBe(1);
  });
});

describe('Queen', () => {
  it('Undertaking moves then places a stone along a ray from the new square', () => {
    const s0 = newGame(DEFAULT_AGE);
    expect(has(s0, 'g1', 0, ['g1', 'g5'])).toBe(false); // must move
    const s1 = play(s0, 'g1', 0, ['g4', 'k8']);
    expect(at(s1, 'g4')?.def).toBe('queen');
    const stone = at(s1, 'k8')!;
    expect(stone.kind).toBe('stone');
    expect(stone.owner).toBe(0);
    expect(stone.id).toBe(3);
    expect(computeBudget(R, s1, 0)).toEqual({ E: 1, A: 0, D: 0, M: 0, I: 1 });
  });

  it('Shoot hits the first piece along a ray, including own pieces', () => {
    const s0 = newGame(DEFAULT_AGE);
    const s1 = play(s0, 'g1', 2, ['i1']); // Queen shoots own King
    expect(at(s1, 'i1')!.hp).toBe(9);
    // Memory: the King keeps the damage after the turn ends.
    const s2 = play(s1, 'h16', 0, ['h15']);
    expect(at(s2, 'i1')!.hp).toBe(9);
  });
});

describe('health', () => {
  it('pieces without Memory regenerate at the end of every turn', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 1, at: 'c5' }] });
    const s1 = play(s0, 'c1', 2, ['c5']);
    // Stone was hit for 1 and regenerated at end of turn.
    expect(at(s1, 'c5')!.hp).toBe(5);
  });

  it('killing a King with Ipseity ends the game; kill goes to the killer', () => {
    const s0 = scenario({ pieces: [K0, Q0, { ...K1, at: 'c9', hp: 1 }, Q1] });
    const s1 = play(s0, 'c1', 2, ['c9']);
    expect(s1.result).toEqual({ winner: 0, reason: 'ipseity' });
    expect(s1.captures[0]).toHaveLength(1);
  });
});

describe('pushes', () => {
  it('Stonepush cascades and records every pushed piece as landed', () => {
    const s0 = scenario({
      pieces: [{ ...K0, at: 'e4' }, Q0, K1, Q1, ...stones(0, ['f4']), { owner: 1, unit: 'scrap', at: 'g4' }],
      tiles: [{ tile: 'burst', at: 'h4' }],
    });
    const s1 = play(s0, 'e4', 3, ['f4', 'g4']);
    expect(at(s1, 'g4')?.kind).toBe('stone');
    // Scrap was pushed onto Burst at h4 and killed by it (1 HP).
    expect(at(s1, 'h4')).toBeUndefined();
    expect(s1.captures[0]).toHaveLength(1); // tile damage is the turn player's
  });

  it('the board edge and reinforced stones stop a push', () => {
    const edge = scenario({ pieces: [{ ...K0, at: 'n1' }, Q0, K1, Q1, ...stones(0, ['o1', 'p1'])] });
    expect(has(edge, 'n1', 3, ['o1', 'p1'])).toBe(false);
    const rein = scenario({
      pieces: [{ ...K0, at: 'e4' }, Q0, K1, Q1, ...stones(0, ['f4']), { owner: 'n', at: 'g4', reinforced: true }],
    });
    expect(has(rein, 'e4', 3, ['f4', 'g4'])).toBe(false);
    expect(has(rein, 'e4', 3, ['f4', 'g5'])).toBe(true);
  });
});

describe('gates', () => {
  it('Shelter numbers neutral stones left to right from the turn player', () => {
    const s0 = scenario({
      active: 1,
      pieces: [K0, Q0, K1, Q1, { owner: 1, unit: 'dgate', at: 'h10' }],
    });
    const s1 = play(s0, 'h10', 0, []);
    // Blue's left is the higher file.
    expect(at(s1, 'i9')!.id).toBe(1);
    expect(at(s1, 'h9')!.id).toBe(2);
    expect(at(s1, 'g9')!.id).toBe(3);
    expect(at(s1, 'g9')!.owner).toBe('n');
  });

  it('unlocking follows controlled gates; gates build in range', () => {
    const base = [K0, Q0, K1, Q1, ...stones(0, ['h8', 'j8', 'l8', 'n8'])]; // I4
    const noGate = scenario({ pieces: base });
    expect(has(noGate, 'a1', 2, ['warrior', 'b2'])).toBe(false);
    const withGate = scenario({ pieces: [...base, { owner: 0, unit: 'igate', at: 'f5' }] });
    expect(has(withGate, 'a1', 2, ['warrior', 'b2'])).toBe(true);
    expect(has(withGate, 'f5', 0, ['warrior', 'i8'])).toBe(true); // range3
    expect(has(withGate, 'f5', 0, ['warrior', 'j8'])).toBe(false);
    expect(has(withGate, 'f5', 0, ['slinger', 'f6'])).toBe(false); // not an Incursion unit
  });
});

describe('tiles', () => {
  it('Pave leaves Displace; landing on it asks the owner; once per turn', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'dgate', at: 'e3' }, { owner: 0, unit: 'trailblazer', at: 'e5' }],
    });
    const s1 = play(s0, 'e5', 0, ['e6']);
    expect(s1.tiles[sq('e5')]?.def).toBe('displace');
    const s2 = play(s1, 'p16', 0, ['o15']); // Blue passes time
    // Trailblazer steps back onto the Displace tile.
    const s3 = play(s2, 'e6', 1, ['e5']);
    expect(s3.pending).toMatchObject({ kind: 'displace', player: 0 });
    const s4 = play(s3, null, -2, ['d6']);
    expect(at(s4, 'd6')?.def).toBe('trailblazer');
    expect(s4.active).toBe(1);
  });

  it('Lay under a piece lands it; Burst hits range1inc in ID order', () => {
    const s0 = scenario({
      pieces: [
        K0,
        Q0,
        K1,
        Q1,
        { owner: 0, unit: 'dgate', at: 'e3' },
        { owner: 0, unit: 'trapthrower', at: 'e4' },
        { owner: 1, unit: 'warrior', at: 'e6' },
        { owner: 1, unit: 'warrior', at: 'f7' },
        { owner: 0, at: 'd6' },
      ],
    });
    const s1 = play(s0, 'e4', 1, ['e6']);
    expect(at(s1, 'e6')).toBeUndefined();
    expect(at(s1, 'f7')).toBeUndefined();
    expect(at(s1, 'd6')!.hp).toBe(5); // regenerated
    expect(s1.captures[0]).toHaveLength(2);
    expect(s1.tiles[sq('e6')]?.def).toBe('burst');
  });

  it('Speartrick Moveattack only lands on tiles, and attacks before the tile', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'speartrick', at: 'e4' }, { owner: 1, unit: 'rook', at: 'e10' }],
      tiles: [{ tile: 'displace', at: 'e7' }],
    });
    expect(has(s0, 'e4', 1, ['h7', 'h10'])).toBe(false); // no tile at h7
    const s1 = play(s0, 'e4', 1, ['e7', 'e10']);
    expect(at(s1, 'e10')).toBeUndefined();
    expect(s1.pending).toMatchObject({ kind: 'displace', player: 0 });
  });

  it('Undertaker makes the landing unit perform Undertaking with its own Move range', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'hoglouse', at: 'e4' }],
      tiles: [{ tile: 'undertaker', at: 'e5' }],
    });
    const s1 = play(s0, 'e4', 1, ['e5']);
    expect(s1.pending).toMatchObject({ kind: 'effect', player: 0 });
    const s2 = play(s1, null, -1, ['e7', 'g7']);
    expect(at(s2, 'e7')?.def).toBe('hoglouse');
    expect(at(s2, 'g7')?.kind).toBe('stone');
    expect(at(s2, 'g7')?.owner).toBe(0);
  });

  it('Self-Execute grants an optional immediate action to the landing unit', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'warrior', at: 'e4' }],
      tiles: [{ tile: 'selfexecute', at: 'e5' }],
    });
    const s1 = play(s0, 'e4', 0, ['e5']);
    expect(s1.pending).toMatchObject({ kind: 'action', context: 'selfExecute', optional: true });
    const s2 = play(s1, 'e5', 0, ['e6']);
    expect(at(s2, 'e6')?.def).toBe('warrior');
    expect(s2.active).toBe(1);
    const skipped = applyInput(s1, { type: 'skip', player: 0 });
    expect(skipped.active).toBe(1);
  });

  it('Unitary tiles: one per board half', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'mgate', at: 'e4' }, ...stones(0, ['k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10'])],
      tiles: [{ tile: 'selfexecute', at: 'a8' }],
    });
    expect(s0.budget.M).toBe(8);
    expect(has(s0, 'e4', 1, ['selfexecute', 'e5'])).toBe(false);
    expect(has(s0, 'e4', 1, ['selfexecute', 'e6'])).toBe(false);
  });
});

describe('gifts and bonus actions', () => {
  it('Ardent Follower gives the Queen a passive Undertaking', () => {
    const s0 = scenario({ active: 1, pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'follower', at: 'h3' }] });
    const s1 = play(s0, 'p16', 0, ['o15']);
    // Red's turn: passive phase asks the Queen to Undertake before any action.
    expect(s1.pending).toMatchObject({ kind: 'effect', player: 0 });
    const s2 = play(s1, null, -1, ['c4', 'f4']);
    expect(at(s2, 'f4')?.kind).toBe('stone');
    expect(s2.pending).toMatchObject({ kind: 'action', context: 'main' });
  });

  it('Accelerator grants the King an extra action (additive)', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'accelerator', at: 'h3' }, { owner: 0, unit: 'accelerator', at: 'j3' }],
    });
    expect(s0.actionsLeft).toBe(3);
  });

  it('Building Committee forces a Build during the passive phase', () => {
    const s0 = scenario({ active: 1, pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'committee', at: 'h3' }] });
    const s1 = play(s0, 'p16', 0, ['o15']);
    expect(s1.pending).toMatchObject({ kind: 'action', context: 'build', player: 0 });
    expect(legalOptions(s1).every((c) => c.picks[0] === 'scrap')).toBe(true);
    const s2 = play(s1, 'a1', 2, ['scrap', 'b1']);
    expect(at(s2, 'b1')?.def).toBe('scrap');
    expect(s2.pending).toMatchObject({ kind: 'action', context: 'main' });
  });
});

describe('passives and cross-player choices', () => {
  it('Vaulter fires its passive forward Shoot at the start of its owner\'s turn', () => {
    const s0 = scenario({
      active: 1,
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'vaulter', at: 'e4' }, { owner: 1, unit: 'warrior', at: 'e9' }],
    });
    const s1 = play(s0, 'p16', 0, ['o15']);
    expect(at(s1, 'e9')).toBeUndefined();
    expect(s1.captures[0]).toHaveLength(1);
    expect(s1.pending).toMatchObject({ kind: 'action', context: 'main', player: 0 });
  });

  it('the displaced unit\'s owner makes the Displace choice, even on the other turn', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'hoglouse', at: 'e5' }, { owner: 1, unit: 'warrior', at: 'e6' }],
      tiles: [{ tile: 'displace', at: 'd6' }],
    });
    const s1 = play(s0, 'e5', 0, ['e6', 'd6']); // relocate the enemy Warrior onto Displace
    expect(s1.pending).toMatchObject({ kind: 'displace', player: 1 });
    expect(() => applyInput(s1, { type: 'choose', player: 0, cmd: legalOptions(s1)[0] })).toThrow();
    const s2 = play(s1, null, -2, ['c7']);
    expect(at(s2, 'c7')?.def).toBe('warrior');
    expect(s2.active).toBe(1);
  });
});

describe('Castle', () => {
  it('King moves two toward the Castler; the Castler lands on the far side', () => {
    const s0 = scenario({ pieces: [{ ...K0, at: 'e1' }, Q0, K1, Q1, { owner: 0, unit: 'castler', at: 'h1' }] });
    const s1 = play(s0, 'h1', 0, ['e1']);
    expect(at(s1, 'g1')?.def).toBe('king');
    expect(at(s1, 'f1')?.def).toBe('castler');
  });
});

describe('game end', () => {
  it('third repetition of a start-of-turn position is a draw', () => {
    let s: GameState = newGame(DEFAULT_AGE);
    const shuffle: Array<[string, string]> = [
      ['i1', 'i2'],
      ['h16', 'h15'],
      ['i2', 'i1'],
      ['h15', 'h16'],
    ];
    for (let i = 0; i < 8 && !s.result; i++) {
      const [from, to] = shuffle[i % 4];
      s = play(s, from, 0, [to]);
    }
    expect(s.result).toEqual({ winner: null, reason: 'repetition' });
  });

  it('resignation and draw by agreement', () => {
    const s0 = newGame(DEFAULT_AGE);
    expect(applyInput(s0, { type: 'resign', player: 0 }).result).toEqual({ winner: 1, reason: 'resignation' });
    const offered = applyInput(s0, { type: 'offerDraw', player: 0 });
    expect(applyInput(offered, { type: 'acceptDraw', player: 1 }).result?.reason).toBe('agreement');
    expect(() => applyInput(offered, { type: 'acceptDraw', player: 0 })).toThrow();
  });

  it('rejects inputs from the wrong player and illegal choices', () => {
    const s0 = newGame(DEFAULT_AGE);
    expect(() => play({ ...s0, pending: { ...s0.pending!, player: 1 } } as GameState, 'g1', 1, ['g2'])).toThrow();
    expect(() =>
      applyInput(s0, { type: 'choose', player: 0, cmd: { unit: '0#2', a: 1, picks: [sq('i1')] } }),
    ).toThrow();
  });
});

describe('determinism & serialisation', () => {
  it('JSON round-trip preserves the game', () => {
    const s0 = play(newGame(DEFAULT_AGE), 'g1', 0, ['g4', 'k8']);
    const copy = JSON.parse(JSON.stringify(s0)) as GameState;
    const a = play(s0, 'h16', 0, ['h15']);
    const b = play(copy, 'h16', 0, ['h15']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    checkInvariants(a);
  });
});
