import { describe, expect, it } from 'vitest';
import {
  applyInput,
  actionsOf,
  computeBudget,
  DEFAULT_AGE,
  formatNotation,
  resourceInstances,
  legalOptions,
  newGame,
  newScenario,
  rulesFor,
  type GameState,
  type PlayerId,
} from '../src/engine';
import { castRay } from '../src/engine/targeting';
import { ALL_DIRS } from '../src/engine/geometry';
import { registerAge } from '../src/engine/rules';
import { AGE_1200BC } from '../src/data/age1200bc';
import { at, checkInvariants, has, play, R, scenario, sq } from './helpers';

const K0 = { owner: 0 as const, unit: 'king', at: 'a1' };
const Q0 = { owner: 0 as const, unit: 'queen', at: 'c1' };
const K1 = { owner: 1 as const, unit: 'king', at: 'p16' };
const Q1 = { owner: 1 as const, unit: 'queen', at: 'n16' };

function stones(owner: PlayerId | "n", squares: string[]) {
  return squares.map((s) => ({ owner, at: s }));
}

/** Nine stones in a column: 8 M, enough to keep an Accelerator. */
const M8 = stones(0, ['k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10']);

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
    expect(s.budget).toEqual({ E: 0, P: 0, D: 0, M: 0, I: 0 });
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
    ['row of four', ['d5', 'e5', 'f5', 'g5'], { E: 4, P: 3, D: 0, M: 0, I: 0 }],
    ['column of four', ['d5', 'd6', 'd7', 'd8'], { E: 4, P: 0, D: 0, M: 3, I: 0 }],
    ['diagonal of four', ['d5', 'e6', 'f7', 'g8'], { E: 4, P: 0, D: 3, M: 0, I: 0 }],
    ['2x2 block', ['d5', 'e5', 'd6', 'e6'], { E: 4, P: 2, D: 2, M: 2, I: 0 }],
    ['four isolated', ['a5', 'd5', 'g5', 'j5'], { E: 4, P: 0, D: 0, M: 0, I: 4 }],
  ];
  for (const [name, squares, expected] of shapes) {
    it(name, () => {
      const s = scenario({ pieces: [K0, Q0, K1, Q1, ...stones(0, squares)] });
      expect(computeBudget(R, s, 0)).toEqual(expected);
      expect(s.budget).toEqual(expected);
    });
  }

  it('resource instances are the pairs and singles behind each count', () => {
    const s = scenario({ pieces: [K0, Q0, K1, Q1, ...stones(0, ['d5', 'e5', 'd6', 'j9'])] });
    const inst = resourceInstances(R, s, 0);
    const names = (list: number[][]) => list.map((i) => i.map((q) => R.geo.name(q)).join('-'));
    expect(names(inst.P)).toEqual(['d5-e5']);
    expect(names(inst.M)).toEqual(['d5-d6']);
    expect(names(inst.D)).toEqual(['e5-d6']);
    expect(names(inst.I)).toEqual(['j9']);
    expect(inst.E).toHaveLength(4);
  });

  it('enemy and neutral stones never count, even for isolation', () => {
    const s = scenario({ pieces: [K0, Q0, K1, Q1, ...stones(0, ['e5']), ...stones(1, ['e6']), ...stones('n', ['f5'])] });
    expect(computeBudget(R, s, 0)).toEqual({ E: 1, P: 0, D: 0, M: 0, I: 1 });
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
    expect(computeBudget(R, s1, 0)).toEqual({ E: 1, P: 0, D: 0, M: 0, I: 1 });
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
  it('Shelter builds the owner\'s Scrap, numbered left to right from the turn player', () => {
    const s0 = scenario({
      active: 1,
      pieces: [K0, Q0, K1, Q1, { owner: 1, unit: 'dgate', at: 'h10' }],
    });
    const s1 = play(s0, 'h10', 0, []);
    // Blue's left is the higher file. Blue already has ids 1-3.
    expect(at(s1, 'i9')!.id).toBe(4);
    expect(at(s1, 'h9')!.id).toBe(5);
    expect(at(s1, 'g9')!.id).toBe(6);
    expect(at(s1, 'g9')).toMatchObject({ owner: 1, kind: 'unit', def: 'scrap' });
  });

  it('Shield builds one Scrap in front', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'mgate', at: 'e4' }] });
    const s1 = play(s0, 'e4', 0, []);
    expect(at(s1, 'e5')).toMatchObject({ owner: 0, def: 'scrap' });
    expect(at(s1, 'd5')).toBeUndefined();
  });

  it('the King builds Extension units and gates only; each gate builds only its own type', () => {
    const base = [K0, Q0, K1, Q1, ...stones(0, ['h8', 'j8', 'l8', 'n8'])]; // E4 I4
    const noGate = scenario({ pieces: base });
    expect(has(noGate, 'a1', 2, ['slinger', 'b2'])).toBe(true);
    expect(has(noGate, 'a1', 2, ['igate', 'b2'])).toBe(true);
    expect(has(noGate, 'a1', 2, ['warrior', 'b2'])).toBe(false);
    const withGate = scenario({ pieces: [...base, { owner: 0, unit: 'igate', at: 'f5' }] });
    // The gate unlocks Incursion units for itself, not for the King.
    expect(has(withGate, 'a1', 2, ['warrior', 'b2'])).toBe(false);
    expect(has(withGate, 'f5', 0, ['warrior', 'j8'])).toBe(false); // occupied
    expect(has(withGate, 'f5', 0, ['warrior', 'j9'])).toBe(true); // range4
    expect(has(withGate, 'f5', 0, ['warrior', 'k9'])).toBe(false); // out of range
    expect(has(withGate, 'f5', 0, ['slinger', 'f6'])).toBe(false); // Extension: King only
    expect(has(withGate, 'f5', 0, ['igate', 'f6'])).toBe(true); // a gate builds its own type of gate
    const dg = scenario({ pieces: [...base, { owner: 0, unit: 'dgate', at: 'f5' }] });
    expect(has(dg, 'f5', 1, ['igate', 'f6'])).toBe(false); // but not other types
  });

  it('gate build ranges are one larger (Deduction, Multiplicity range3)', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'dgate', at: 'f5' }, ...stones(0, ['k2', 'l3', 'm4'])], // D2 (diagonal)
    });
    expect(s0.budget.D).toBe(2);
    expect(has(s0, 'f5', 1, ['trailblazer', 'i8'])).toBe(true);
    expect(has(s0, 'f5', 1, ['trailblazer', 'j8'])).toBe(false);
  });

  it('every non-gate unit of a type requires the gate of that type (Extension: none)', () => {
    const gateOf: Record<string, string | undefined> = {
      E: undefined,
      P: 'prevenience',
      D: 'deduction',
      M: 'multiplicity',
      I: 'incursion',
    };
    for (const u of R.age.units) {
      if (!u.cost) continue;
      if (u.gate) expect(u.gate).toBe(gateOf[u.cost.res]);
      else expect(u.requires).toBe(gateOf[u.cost.res]);
    }
  });
});

describe('Prevenience Gate', () => {
  it('Shelter {5} raises a 5×1 wall of Scrap in front', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'pgate', at: 'h5' }] });
    const s1 = play(s0, 'h5', 0, []);
    for (const f of ['f6', 'g6', 'h6', 'i6', 'j6']) expect(at(s1, f)).toMatchObject({ owner: 0, def: 'scrap' });
    expect(at(s1, 'e6')).toBeUndefined();
    expect(at(s1, 'k6')).toBeUndefined();
  });

  it('builds Prevenience units in range1 only; Stone Director costs 1 P', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'pgate', at: 'h5' }, ...stones(0, ['k2', 'l2'])] }); // A1
    expect(s0.budget.P).toBe(1);
    expect(has(s0, 'h5', 1, ['stonedirector', 'i6'])).toBe(true);
    expect(has(s0, 'h5', 1, ['stonedirector', 'j7'])).toBe(false); // range1
    expect(has(s0, 'h5', 1, ['castler', 'i6'])).toBe(false); // 2 A
    expect(has(s0, 'a1', 2, ['stonedirector', 'b2'])).toBe(false); // not the King
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
  it('Ardent Follower gives the Queen a stone throw passive: a stone along her rays, no move', () => {
    const s0 = scenario({ active: 1, pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'follower', at: 'h3' }, ...stones(0, ['m2', 'm3', 'm4'])] }); // M2
    const s1 = play(s0, 'p16', 0, ['o15']); // Blue passes; Red's passive phase
    expect(s1.pending).toMatchObject({ kind: 'effect', player: 0, source: 'passive', spec: { kw: 'throw' } });
    expect(s1.pending).not.toHaveProperty('optional', true); // passives are mandatory
    expect(() => play(s1, null, -1, ['d3'])).toThrow(); // not on a ray
    const s2 = play(s1, null, -1, ['f4']);
    expect(at(s2, 'c1')?.def).toBe('queen'); // she stays
    expect(at(s2, 'f4')).toMatchObject({ kind: 'stone', owner: 0 });
    expect(s2.pending).toMatchObject({ kind: 'action', context: 'main' });
    expect(formatNotation(s2)).toBe('16x16 1... Ko15 2. Q@f4|');
    // Not an action of hers.
    expect(actionsOf(R, s2, at(s2, 'c1')!).some((a) => a.kw === 'throw')).toBe(false);
  });

  it('Accelerator grants the King an extra action', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'accelerator', at: 'h3' }, ...M8] });
    expect(s0.actionsLeft).toBe(2);
  });

  it('Accelerator costs 8 M, is built by a Multiplicity Gate, and is unitary per player', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'mgate', at: 'e4' }, ...M8] });
    expect(s0.budget.M).toBe(8);
    expect(has(s0, 'e4', 1, ['accelerator', 'e5'])).toBe(true);
    expect(has(s0, 'a1', 2, ['accelerator', 'b2'])).toBe(false); // not the King
    const s1 = play(s0, 'e4', 1, ['accelerator', 'e5']);
    const s2 = play(s1, 'p16', 0, ['o15']);
    expect(s2.actionsLeft).toBe(2);
    expect(legalOptions(s2).some((c) => c.picks[0] === 'accelerator')).toBe(false);
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

describe('ray stonepush (Queen, Bishop, Rook)', () => {
  it('pushes the first piece along a ray, if a stone, any distance; chains ahead move too', () => {
    const s0 = scenario({
      pieces: [K0, { ...Q0, at: 'd4' }, K1, Q1, { owner: 1, at: 'd6' }, { owner: 'n', at: 'd9' }],
    });
    // Queen's action 3. The stone on d6 can end on d7, d8, d9 (pushing d9's stone) … up to d15.
    expect(has(s0, 'd4', 3, ['d6', 'd7'])).toBe(true);
    expect(has(s0, 'd4', 3, ['d6', 'd15'])).toBe(true);
    expect(has(s0, 'd4', 3, ['d6', 'd16'])).toBe(false); // the stone ahead hits the edge first
    const s1 = play(s0, 'd4', 3, ['d6', 'd12']);
    expect(at(s1, 'd12')?.owner).toBe(1);
    expect(at(s1, 'd13')?.owner).toBe('n'); // pushed ahead: d9 + the 3 steps after contact
    expect(at(s1, 'd6')).toBeUndefined();
  });

  it('only stones, only along the unit\'s own rays; reinforced stones do not move', () => {
    const s0 = scenario({
      pieces: [
        K0,
        Q0,
        K1,
        Q1,
        { owner: 0, unit: 'bishop', at: 'e4' },
        { owner: 0, unit: 'rook', at: 'j4' },
        { owner: 0, at: 'g6' },
        { owner: 0, at: 'j7' },
        { owner: 0, at: 'e8' },
        { owner: 1, unit: 'warrior', at: 'l4' },
        { owner: 'n', at: 'h4', reinforced: true },
      ],
    });
    expect(has(s0, 'e4', 2, ['g6', 'i8'])).toBe(true); // diagonal
    expect(has(s0, 'e4', 2, ['e8', 'e9'])).toBe(false); // not a bishop ray
    expect(has(s0, 'j4', 2, ['j7', 'j10'])).toBe(true);
    expect(has(s0, 'j4', 2, ['l4', 'm4'])).toBe(false); // a unit, not a stone
    expect(has(s0, 'j4', 2, ['h4', 'g4'])).toBe(false); // reinforced
  });
});

describe('roster additions', () => {
  it('gift units can self-destruct; the owner gets the capture', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'accelerator', at: 'h3' }, ...M8] });
    const s1 = play(s0, 'h3', 0, []);
    expect(at(s1, 'h3')).toBeUndefined();
    expect(s1.captures[0]).toHaveLength(1);
    expect(formatNotation(s1)).toBe('16x16 1. Ac~#h3');
    for (const unit of ['accelerator', 'follower', 'advisor', 'royalpath', 'general']) {
      const d = R.unit(unit);
      expect(d.actions).toEqual([{ kw: 'selfdestruct' }]);
      expect(d.hp).toBe(1);
      for (const kw of ['fragile', 'unitary']) expect(d.traits.some((t) => t.kw === kw), `${unit} ${kw}`).toBe(true);
    }
  });

  it('Fragile: checked at the start of its owner\'s turn, against the stones\' capability', () => {
    // Follower costs 2 M: three stones in a column. Blue's Path Clearer clears the m-file on Blue's turn.
    const c0 = scenario({
      active: 1,
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'follower', at: 'h3' }, { owner: 1, unit: 'pathclearer', at: 'm9' }, ...stones(0, ['m2', 'm3', 'm4'])],
    });
    const c1 = play(c0, 'm9', 1, []);
    // Still standing during Blue's turn ...
    expect(at(c0, 'h3')?.def).toBe('follower');
    // ... gone at the start of Red's, before passives: no stone throw this turn.
    expect(c1.active).toBe(0);
    expect(at(c1, 'h3')).toBeUndefined();
    expect(c1.pending).toMatchObject({ kind: 'action', context: 'main' });
    expect(formatNotation(c1)).toBe('16x16 1... PC&#m2#m3#m4 2. #h3|');
    // With the capability intact it stays.
    const ok = scenario({ active: 1, pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'follower', at: 'h3' }, ...stones(0, ['m2', 'm3', 'm4'])] });
    expect(at(play(play(ok, 'p16', 0, ['o15']), null, -1, ['f4']), 'h3')?.def).toBe('follower');
  });

  it('Advisor: in the passive phase the King may make a move, or decline', () => {
    const base = [K0, Q0, K1, Q1, { owner: 0 as const, unit: 'advisor', at: 'h3' }, ...stones(0, ['l2', 'm2', 'n2'])]; // P2
    const a0 = scenario({ active: 1, pieces: base });
    const a1 = play(a0, 'p16', 0, ['o15']);
    expect(a1.pending).toMatchObject({ kind: 'effect', player: 0, optional: true, source: 'passive' });
    const moved = play(a1, null, -1, ['b2']);
    expect(at(moved, 'b2')?.def).toBe('king');
    expect(moved.pending).toMatchObject({ kind: 'action', context: 'main' });
    const declined = applyInput(a1, { type: 'skip', player: 0 });
    expect(at(declined, 'a1')?.def).toBe('king');
    expect(formatNotation(moved)).toBe('16x16 1... Ko15 2. Kb2|');
    expect(formatNotation(declined)).toBe('16x16 1... Ko15 2. K-|');
  });

  it('Royal Path: after a tile activates on the King, he may step to an adjacent square, again on each new tile', () => {
    const pieces = [{ ...K0, at: 'e4' }, Q0, K1, Q1, { owner: 0 as const, unit: 'royalpath', at: 'h3' }, ...stones(0, ['l3', 'm4', 'n5'])]; // D2
    const s0 = scenario({ pieces, tiles: [{ tile: 'burst', at: 'e5' }, { tile: 'burst', at: 'e6' }] });
    const s1 = play(s0, 'e4', 0, ['e5']); // onto Burst: the King takes 1, then may step
    expect(s1.pending).toMatchObject({ kind: 'effect', player: 0, optional: true, source: 'Royal Path' });
    const s2 = play(s1, null, -1, ['e6']); // onto the second Burst: may step again
    expect(s2.pending).toMatchObject({ kind: 'effect', source: 'Royal Path' });
    const s3 = play(s2, null, -1, ['f7']);
    expect(at(s3, 'f7')?.def).toBe('king');
    expect(at(s3, 'f7')?.hp).toBe(8);
    expect(s3.active).toBe(1);
    expect(formatNotation(s3)).toBe('16x16 1. Ke5!BuKe6!BuKf7');
    const declined = applyInput(s1, { type: 'skip', player: 0 });
    expect(at(declined, 'e5')?.def).toBe('king');
    expect(formatNotation(declined)).toBe('16x16 1. Ke5!BuK-');
    // Without a Royal Path there is no step.
    const plain = play(scenario({ pieces: [{ ...K0, at: 'e4' }, Q0, K1, Q1], tiles: [{ tile: 'burst', at: 'e5' }] }), 'e4', 0, ['e5']);
    expect(plain.active).toBe(1);
  });

  it('General: in the passive phase, one optional bonus attack (Attack or Shoot) with any unit', () => {
    const pieces = [
      K0,
      Q0,
      K1,
      Q1,
      { owner: 0 as const, unit: 'general', at: 'h3' },
      { owner: 0 as const, unit: 'warrior', at: 'e4' },
      { owner: 0 as const, unit: 'bishop', at: 'c3' },
      { owner: 1 as const, unit: 'claywall', at: 'e5' },
      ...stones(0, ['n2', 'p4']), // I2
    ];
    const s0 = scenario({ active: 1, pieces });
    const s1 = play(s0, 'p16', 0, ['o15']);
    expect(s1.pending).toMatchObject({ kind: 'action', context: 'attack', optional: true, player: 0 });
    // Only actions that just deal damage: the Warrior's Attack, the Bishop's and Queen's Shoots; never a Move.
    const kws = legalOptions(s1).map((c) => `${s1.pieces[c.unit].def}:${R.unit(s1.pieces[c.unit].def!).actions[c.a].kw}`);
    expect(new Set(kws)).toEqual(new Set(['warrior:attack', 'bishop:shoot', 'queen:shoot']));
    const shot = play(s1, 'c3', 1, ['e5']);
    expect(formatNotation(shot)).toBe('16x16 1... Ko15 2. Bi*e5|');
    const s2 = play(s1, 'e4', 1, ['e5']);
    expect(at(s2, 'e5')?.hp).toBe(1); // Warrior hits for 2
    expect(s2.pending).toMatchObject({ kind: 'action', context: 'main' });
    expect(formatNotation(s2)).toBe('16x16 1... Ko15 2. Wa:e5|');
    const declined = applyInput(s1, { type: 'skip', player: 0 });
    expect(declined.pending).toMatchObject({ kind: 'action', context: 'main' });
    expect(formatNotation(declined)).toBe('16x16 1... Ko15 2. Gn-|');
    // Nothing to attack or shoot (no Queen or Bishop, whose shots could hit their own side): no prompt.
    const none = scenario({
      active: 1,
      pieces: pieces.filter((p) => !('unit' in p) || !['claywall', 'bishop', 'queen'].includes(p.unit as string) || p === Q1),
    });
    expect(play(none, 'p16', 0, ['o15']).pending).toMatchObject({ kind: 'action', context: 'main' });
  });

  it('Building Committee costs 2 M', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'mgate', at: 'e4' }, ...stones(0, ['k2', 'k3', 'k4'])] });
    expect(s0.budget.M).toBe(2);
    expect(has(s0, 'e4', 1, ['committee', 'e5'])).toBe(true);
  });

  it('To Dust: built by a Deduction Gate; landing destroys every stone in the 3×3, for the turn player', () => {
    const d2 = stones(0, ['k2', 'l3', 'm4']); // D2
    const g = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'dgate', at: 'e3' }, ...d2] });
    expect(has(g, 'e3', 1, ['todust', 'e5'])).toBe(true);
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'warrior', at: 'e4' }, { owner: 1, at: 'd6' }, { owner: 'n', at: 'f6' }, { owner: 0, at: 'e7' }, { owner: 1, unit: 'warrior', at: 'f5' }],
      tiles: [{ tile: 'todust', at: 'e5' }],
    });
    const s1 = play(s0, 'e4', 0, ['e5']);
    expect(at(s1, 'd6')).toBeUndefined();
    expect(at(s1, 'f6')).toBeUndefined();
    expect(at(s1, 'e7')?.kind).toBe('stone'); // outside the 3×3
    expect(at(s1, 'f5')?.def).toBe('warrior'); // units are untouched
    expect(at(s1, 'e5')?.def).toBe('warrior');
    expect(s1.captures[0]).toHaveLength(2);
    // ID order across owners (§4.1): the turn player's, then neutral, then the opponent's.
    expect(formatNotation(s1)).toBe('16x16 1. Wae5!TD#f6#d6');
  });

  it('Path Clearer: moves sideways up to 3; clears every stone on its file without line of sight', () => {
    const s0 = scenario({
      pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'pathclearer', at: 'd5' }, { owner: 1, at: 'd3' }, { owner: 1, unit: 'warrior', at: 'd8' }, { owner: 'n', at: 'd12' }, { owner: 0, at: 'e9' }],
    });
    expect(has(s0, 'd5', 0, ['g5'])).toBe(true);
    expect(has(s0, 'd5', 0, ['h5'])).toBe(false);
    expect(has(s0, 'd5', 0, ['d6'])).toBe(false);
    const s1 = play(s0, 'd5', 1, []);
    expect(at(s1, 'd3')).toBeUndefined();
    expect(at(s1, 'd12')).toBeUndefined(); // behind the Warrior: no line of sight needed
    expect(at(s1, 'd8')?.def).toBe('warrior');
    expect(at(s1, 'e9')?.kind).toBe('stone');
    expect(formatNotation(s1)).toBe('16x16 1. PC&#d12#d3'); // neutral before the opponent's (§4.1)
    const none = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'pathclearer', at: 'd5' }] });
    expect(has(none, 'd5', 1, [])).toBe(false); // nothing to clear
  });

  it('Warrior attacks for 2', () => {
    const s0 = scenario({ pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'warrior', at: 'e4' }, { owner: 1, unit: 'claywall', at: 'e5' }] });
    expect(at(play(s0, 'e4', 1, ['e5']), 'e5')?.hp).toBe(1);
  });

  it('Soldier: passive step forward, then attack forward; a blocked step is skipped, never a push', () => {
    const run = (extra: Parameters<typeof scenario>[0]['pieces']) => {
      const s0 = scenario({ active: 1, pieces: [K0, Q0, K1, Q1, { owner: 0, unit: 'soldier', at: 'e4' }, ...extra] });
      return play(s0, 'p16', 0, ['o15']); // Blue passes; Red's passive phase runs
    };
    const open = run([{ owner: 1, unit: 'warrior', at: 'e6' }]);
    expect(at(open, 'e5')?.def).toBe('soldier');
    expect(at(open, 'e6')).toBeUndefined();
    expect(formatNotation(open)).toBe('16x16 1... Ko15 2. Soe5,So:e6#|');
    const blocked = run([{ owner: 1, at: 'e5' }]);
    expect(at(blocked, 'e4')?.def).toBe('soldier'); // stayed put
    expect(at(blocked, 'e5')?.kind).toBe('stone'); // hit, regenerates at end of turn
    expect(formatNotation(blocked)).toBe('16x16 1... Ko15 2. So:e5|');
    const empty = run([]);
    expect(at(empty, 'e5')?.def).toBe('soldier');
    expect(formatNotation(empty)).toBe('16x16 1... Ko15 2. Soe5|');
    expect(has(empty, 'e5', 0, [])).toBe(false); // no actions of its own
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

  it('HP counts for repetition: draining a Memory unit each cycle is not a repeat', () => {
    // Red's King hits its own Queen every turn while Blue's King steps back and forth.
    let s = scenario({ pieces: [K0, { ...Q0, at: 'b1' }, K1, Q1] });
    for (let i = 0; i < 8; i++) s = play(play(s, 'a1', 1, ['b1']), i % 2 ? 'o16' : 'p16', 0, [i % 2 ? 'p16' : 'o16']);
    expect(s.result).toBeNull();
    expect(at(s, 'b1')?.hp).toBe(2);
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

describe('board size', () => {
  it('keeps the King/Queen offsets on a smaller board', () => {
    const s = newGame(DEFAULT_AGE, { width: 12, height: 12 });
    const g = rulesFor(s).geo;
    const name = (uid: string) => g.name(s.pieces[uid].sq);
    expect([s.width, s.height, s.board.length]).toEqual([12, 12, 144]);
    expect(name('0#1')).toBe('g1'); // King
    expect(name('0#2')).toBe('e1'); // Queen
    expect(name('1#1')).toBe('f12');
    expect(name('1#2')).toBe('h12');
  });

  it('no starting line of sight on any allowed size', () => {
    for (const n of R.age.boardSizes) {
      const s = newGame(DEFAULT_AGE, { width: n, height: n });
      const RR = rulesFor(s);
      const ps = Object.values(s.pieces);
      expect(ps).toHaveLength(4);
      for (const p of ps) {
        for (const v of ALL_DIRS) {
          const hit = castRay(RR, s, p.sq, v);
          if (hit) expect(hit.owner).toBe(p.owner);
        }
      }
      // Same relative offsets as the default board.
      const f = (uid: string) => RR.geo.file(s.pieces[uid].sq);
      expect([f('0#2') - f('0#1'), f('1#1') - f('0#1'), f('1#2') - f('0#1')]).toEqual([-2, -1, 1]);
    }
  });

  it('only the listed square sizes are allowed', () => {
    expect(R.age.boardSizes).toEqual([8, 12, 16]);
    expect(() => newGame(DEFAULT_AGE, { width: 10, height: 10 })).toThrow();
    expect(() => newGame(DEFAULT_AGE, { width: 8, height: 12 })).toThrow();
    expect(() => newGame(DEFAULT_AGE, { width: 8 })).toThrow();
    expect(() => newGame(DEFAULT_AGE, { width: 8.5, height: 8.5 })).toThrow();
  });

  it('pieces move to the far edge of a small board', () => {
    const s0 = newGame(DEFAULT_AGE, { width: 8, height: 8 });
    const g = rulesFor(s0).geo;
    const q = s0.pieces['0#2'];
    const dests = legalOptions(s0).filter((c) => c.unit === q.uid && c.a === 1).map((c) => g.name(c.picks[0] as number));
    expect(g.name(q.sq)).toBe('c1');
    expect(dests).toContain('a3'); // diagonal to the a-file
    expect(dests).toContain('c8'); // up the file to the last rank
  });

  it('costs can be set per board size', () => {
    // Every cost is the same on every size for now.
    for (const n of R.age.boardSizes) {
      const RR = rulesFor(DEFAULT_AGE, { width: n, height: n });
      for (const u of R.age.units) expect(RR.unit(u.id).cost).toEqual(u.cost);
    }
    const RR = registerAge({ ...AGE_1200BC, id: 'sized', costsBySize: { 8: { slinger: 4, burst: 1 } } });
    expect(RR.unit('slinger').cost).toEqual({ res: 'E', n: 1 });
    const small = rulesFor('sized', { width: 8, height: 8 });
    expect(small.unit('slinger').cost).toEqual({ res: 'E', n: 4 });
    expect(small.tile('burst').cost).toEqual({ res: 'D', n: 1 });
    expect(small.age.units.find((u) => u.id === 'slinger')!.cost!.n).toBe(4);
    // A King with 3 E can't afford the 4 E Slinger on 8x8.
    const s = newScenario('sized', {
      pieces: [
        { owner: 0, unit: 'king', at: 'a1' },
        { owner: 0, unit: 'queen', at: 'c1' },
        { owner: 1, unit: 'king', at: 'h8' },
        { owner: 1, unit: 'queen', at: 'f8' },
        ...stones(0, ['e4', 'g4', 'e6']),
      ],
    }, { width: 8, height: 8 });
    const builds = legalOptions(s).filter((c) => c.picks[0] === 'slinger');
    expect(builds).toEqual([]);
    expect(legalOptions(s).some((c) => c.picks[0] === 'scrap')).toBe(true); // the King can build
  });
});

describe('arrivals (the other player\'s last turn)', () => {
  it('records squares moved to or created on, per turn', () => {
    const s0 = newGame(DEFAULT_AGE);
    expect(s0.arrivals).toEqual([]);
    const s1 = play(s0, 'g1', 0, ['g4', 'k8']); // Red: Undertaking to g4, stone on k8
    expect(s1.active).toBe(1);
    expect(s1.lastArrivals.map((q) => R.geo.name(q)).sort()).toEqual(['g4', 'k8']);
    expect(s1.arrivals).toEqual([]);
    const s2 = play(s1, 'h16', 0, ['h15']);
    expect(s2.lastArrivals.map((q) => R.geo.name(q))).toEqual(['h15']);
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
