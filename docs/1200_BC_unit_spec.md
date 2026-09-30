# Uatbotl — 1200 BC Unit and Tile Roster

Canonical age. Board, setup, stones, resource budgets, keywords, traits, ranges, and tile types are defined in the core spec (`init-spec_v0_7.md`). All names are placeholders.

# Resources (design space)

- **Extension** (stone count): general utilities, and maybe weaker generic alternatives to more specialized options.
- **Anticipation** (horizontal pairs): defensive capabilities, walls, protection. Defensive mobility as well.
- **Deduction** (diagonal pairs): tile-laying combos, and units that work well with tile activation.
- **Multiplicity** (vertical pairs): ramping up more units.
- **Incursion** (stones in no other template): aggressive, high-damage units and tiles.

# Units

## King
HP: 10
Passives: +1 Action
Actions:
    1. Move: {range1}
    2. Attack: {range1} {dmg=1}
    3. Build: {anything unlocked} {range1}
    4. Stonepush: {1}
Traits:
- Memory
- Ipseity

## Queen
HP: 10
Actions:
    1. Undertaking: {queensmove}
    2. Move: {queensmove}
    3. Shoot: {eight directions} {dmg=1}
Traits:
- Memory
Note: Queensgift effects can modify her.

## Extension

E1: Scrap
HP: 1
Cost: 0 E
Note: no actions; a blocker that is always affordable.

E2: Slinger
HP: 1
Cost: 1 E
Actions: Shoot: {forward} {dmg=1}

E3: Clay Wall
HP: 3
Cost: 3 E
Traits:
- Memory
Note: Memory is intended; the wall wears down over time.

E4: Ardent Follower
HP: 1
Cost: 3 E
Traits:
- Queensgift: the Queen gains Undertaking {queensmove} as a passive. She keeps it as an action.
Note: no actions. Speeds up the early economy; its owner may later want to kill it.

## Anticipation

A1: Castler
HP: 1
Cost: 2 A
Actions:
    1. Castle: {horizontal}
    2. Move: {range1}

A2: Hoglouse
HP: 1
Cost: 2 A
Actions:
    1. Relocate: {1} unit from {range1} to {range1}
    2. Move: {range2}

A3: Stone Director
HP: 1
Cost: 3 A
Actions: Reallocate: {1} stone from {range1} to {range1}

## Deduction

D1: Deduction Gate
HP: 1
Cost: 2 D
Actions:
    1. Shelter
    2. Build: {units requiring Deduction Gate, or gates} {range2}

D2: Trailblazer
HP: 1
Cost: 2 D
Requirements: Deduction Gate
Actions:
    1. Pave: {forwardjump1} {Displace}
    2. Move: {adjacent}

D2t: Displace
Type: Consequence
Created by: Trailblazer
Effect: the piece moves to an adjacent empty square. Its owner chooses; if it is a stone, the turn player chooses.

D3: Trapthrower
HP: 1
Cost: 4 D
Requirements: Deduction Gate
Actions:
    1. Move: {range2}
    2. Lay: {Burst} {triforwardjump2}

D3t: Burst
Type: Consequence
Built by: Deduction Gate
Cost: 2 D
Created by: Trapthrower
Effect: Attack: {all of range1inc} {dmg=1}

D4: Speartrick
HP: 1
Cost: 2 D
Requirements: Deduction Gate
Actions:
    1. Move: {triforwardjump3}
    2. Moveattack: {triforwardjump3} {triforwardjump3} {dmg=2}. Only if the move lands on a tile. The attack is measured from the landing square and resolves before the tile.

## Multiplicity

M1: Multiplicity Gate
HP: 1
Cost: 2 M
Actions:
    1. Shield
    2. Build: {units requiring Multiplicity Gate, or gates} {range2}

M2: Building Committee
HP: 1
Cost: 5 M
Passives: Build Action {+1}

M3: Accelerator
HP: 1
Cost: 8 M
Requirements: Multiplicity Gate
Traits:
- Kingsgift: the King gains an additional +1 Action passive.
Note: no actions, no movement.

M3t: Self-Execute
Type: Consequence
Built by: Multiplicity Gate
Cost: 8 M
Effect: +1 action, taken immediately by the unit that just landed on the tile. No effect if a stone lands here.
Traits:
- Unitary (one per board half)

M4: Queen's Pathbuilder
HP: 1
Cost: 3 M
Requirements: Multiplicity Gate
Actions:
    1. Pave: {forwardjump1} {Undertaker}
    2. Move: {adjacent}

M4t: Undertaker
Type: Consequence
Created by: Queen's Pathbuilder
Effect: the unit performs Undertaking, using the range of its own Move action. No effect if a stone lands here or if the unit has no Move action.

## Incursion

I1: Incursion Gate
HP: 1
Cost: 2 I
Actions: Build: {units requiring Incursion Gate, or gates} {range3}
Note: no wall action by design; less defensible on its own.

I1b: Aggressive Incursion Gate
HP: 1
Cost: 8 I
Actions: Build: {units requiring Incursion Gate, or gates} {forwardjump5}
Note: counts as an Incursion Gate for unlocking. Builds onto a single square, five forward. No wall action.

I2: Vaulter
HP: 1
Cost: 2 I
Requirements: Incursion Gate
Passives: Shoot: {forward} {dmg=1}
Actions:
    1. Shoot: {forward} {dmg=1}
    2. Move: {one square horizontally}
Note: the "vault" is its shot. Passive plus action can deal 2 damage in one turn.

I3: Warrior
HP: 1
Cost: 2 I
Requirements: Incursion Gate
Actions:
    1. Move: {adjacent}
    2. Attack: {adjacent} {dmg=1}

I4: Horse
HP: 1
Cost: 3 I
Requirements: Incursion Gate
Actions:
    1. Move: {knightsmove}
    2. Attack: {knightsmove} {dmg=1}

I5: Bishop
HP: 1
Cost: 3 I
Requirements: Incursion Gate
Actions:
    1. Move: {bishopsmove}
    2. Shoot: {diagonal} {dmg=1}

I6: Rook
HP: 1
Cost: 5 I
Requirements: Incursion Gate
Actions:
    1. Move: {rooksmove}
    2. Shoot: {orthogonal} {dmg=1}

# Unassigned actions

- **Reinforce** — upgrade a stone to 7 HP and immovable. Needs a home unit, a resource, a cost, and a range.

# Ideas

## Unrated
- Tile with Shotboost {+2} and no landing effect.

## Weak

## Medium
- Unit with Kingsgift: {double the King's maximum HP}. Low-priced Anticipation. Can't move. 1 HP.
- Unit that "punches" an adjacent stone, launching it in a direction (N/S/E/W). If it hits a unit, it stops there and deals 5 damage.

## Powerful
- Tile that nullifies damage your units would take this turn (a way to prevent self-damage from AoE).
- Tile (Dogma): your amount of each resource is only how much more of it you have than your opponent.
- Tile (Dogma): no player can build units of the resource type of the unit on it. No effect if a stone.
- Tile (Dogma): shrinks the board vertically by 2 squares, 1 per side, pushing everything. If a column is full, it shrinks only as much as it can.
- Passive that duplicates a unit (maybe the one closest to the enemy King; creation order breaks ties) next to a stationary unit.
- Vertical line: moves stones away from the center (can push other stones in turn, but not units).
