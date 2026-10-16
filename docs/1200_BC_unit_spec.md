# Uatbotl — 1200 BC Unit and Tile Roster

Canonical age. Board, setup, stones, resource budgets, keywords, traits, ranges, and tile types are defined in the core spec (`init-spec_v0_7.md`). All names are placeholders.

# Resources (design space)

- **Extension** (stone count): general utilities, and maybe weaker generic alternatives to more specialized options.
- **Prevenience** (horizontal pairs): defensive capabilities, walls, protection. Defensive mobility as well.
- **Deduction** (diagonal pairs): tile-laying combos, and units that work well with tile activation.
- **Multiplicity** (vertical pairs): ramping up more units.
- **Incursion** (stones in no other template): aggressive, high-damage units and tiles.

# Build rules

- The **King** builds Extension units and gates (any type). It is the only builder of Extension units.
- **Gift units** (Accelerator, Ardent Follower, Advisor, Royal Path, General) all have 1 HP, can't move, are **Unitary** and **Fragile**, and can **Self-destruct**.
- Every non-gate unit of a type (Prevenience, Deduction, Multiplicity, Incursion) **requires the gate of that type**, and only that gate builds it.
- A gate builds its own type's units, its own type's gates, and its own tiles. It never builds another type's gate.
- Gate walls (Shelter, Shield) are built from the owner's **Scrap**, not neutral stones.

# Units

## King
HP: 10
Passives: +1 Action
Actions:
    1. Move: {range1}
    2. Attack: {range1} {dmg=1}
    3. Build: {Extension units, or gates} {range1}
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
    4. Stonepush: {eight directions ray} {any distance}. The first piece along a ray, if it is a stone, is pushed away along that ray as far as the player chooses; pieces ahead of it are pushed too.
Traits:
- Memory
Note: Queensgift effects can modify her (the Ardent Follower gives her a stone throw passive).

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

## Prevenience

P1: Prevenience Gate
HP: 1
Cost: 2 P
Actions:
    1. Shelter {5}: a 5×1 wall of Scrap in front.
    2. Build: {Prevenience units and gates} {range1}

P2: Castler
HP: 1
Cost: 2 P
Requirements: Prevenience Gate
Actions:
    1. Castle: {horizontal}
    2. Move: {range1}

P3: Hoglouse
HP: 1
Cost: 2 P
Requirements: Prevenience Gate
Actions:
    1. Relocate: {1} unit from {range1} to {range1}
    2. Move: {range2}

P4: Stone Director
HP: 1
Cost: 1 P
Requirements: Prevenience Gate
Actions: Reallocate: {1} stone from {range1} to {range1}

P5: Advisor
Cost: 2 P
Requirements: Prevenience Gate
HP: 1
Can't move.
Traits:
- Fragile: at the start of its owner's turn, dies if their stones can no longer produce its cost.
- Unitary (one per player)
- Kingsgift: in the passive phase, the King may make a move (his Move {range1}). He may decline.
Actions: Self-destruct

## Deduction

D1: Deduction Gate
HP: 1
Cost: 2 D
Actions:
    1. Shelter: Scrap on the square in front and both forward diagonals.
    2. Build: {Deduction units and gates} {range3}

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

D1t: To Dust
Type: Consequence
Built by: Deduction Gate
Cost: 2 D
Effect: destroys every stone (any owner, reinforced too) in the 3×3 around the tile, its own square included. Kills go to the turn player.

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

D5: Path Clearer
HP: 1
Cost: 3 D
Requirements: Deduction Gate
Actions:
    1. Move: {horizontal, up to 3}
    2. Clear: destroys every stone on its file, the whole length of the board. No line of sight needed; units are untouched.

D6: Royal Path
Cost: 2 D
Requirements: Deduction Gate
HP: 1
Can't move.
Traits:
- Fragile: at the start of its owner's turn, dies if their stones can no longer produce its cost.
- Unitary (one per player)
- Kingsgift: the Royal Path trait. After a tile activates on the King (once its cascade has resolved), he may move to an adjacent square. If that lands on another tile, it activates and he may step again.
Actions: Self-destruct

## Multiplicity

M1: Multiplicity Gate
HP: 1
Cost: 2 M
Actions:
    1. Shield: Scrap on the square in front.
    2. Build: {Multiplicity units and gates} {range3}

M2: Building Committee
HP: 1
Cost: 2 M
Requirements: Multiplicity Gate
Passives: Build Action {+1}

M3: Accelerator
Cost: 8 M
Requirements: Multiplicity Gate
HP: 1
Can't move.
Traits:
- Fragile: at the start of its owner's turn, dies if their stones can no longer produce its cost.
- Unitary (one per player)
- Kingsgift: the King gains an additional +1 Action passive.
Actions: Self-destruct

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

M5: Ardent Follower
Cost: 2 M
Requirements: Multiplicity Gate
HP: 1
Can't move.
Traits:
- Fragile: at the start of its owner's turn, dies if their stones can no longer produce its cost.
- Unitary (one per player)
- Queensgift: the Queen gains a **stone throw** passive: each passive phase she places a stone of hers on an empty square along her rays (queensmove), without moving.
Actions: Self-destruct

## Incursion

I1: Incursion Gate
HP: 1
Cost: 2 I
Actions: Build: {Incursion units and gates} {range4}
Note: no wall action by design; less defensible on its own.

I1b: Aggressive Incursion Gate
HP: 1
Cost: 8 I
Actions: Build: {Incursion units and gates} {forwardjump6}
Note: counts as an Incursion Gate for unlocking. Builds onto a single square, six forward. No wall action.

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
    2. Attack: {adjacent} {dmg=2}

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
    3. Stonepush: {diagonal ray} {any distance}

I6: Rook
HP: 1
Cost: 5 I
Requirements: Incursion Gate
Actions:
    1. Move: {rooksmove}
    2. Shoot: {orthogonal} {dmg=1}
    3. Stonepush: {orthogonal ray} {any distance}

I7: Soldier
HP: 1
Cost: 1 I
Requirements: Incursion Gate
Passives:
    1. Move: {forward 1}. Skipped if the square is occupied; it never pushes.
    2. Attack: {forward 1} {dmg=1}. Hits whatever is directly in front after the move, own pieces included. Skipped if the square is empty.
Note: no actions.

I8: General
Cost: 2 I
Requirements: Incursion Gate
HP: 1
Can't move.
Traits:
- Fragile: at the start of its owner's turn, dies if their stones can no longer produce its cost.
- Unitary (one per player)
Passives: Bonus Attack. In the passive phase, at the General's ID, its owner may take one Attack action with any of their units that has one. Optional.
Actions: Self-destruct

# Unassigned actions

- **Reinforce** — upgrade a stone to 7 HP and immovable. Needs a home unit, a resource, a cost, and a range.

# Ideas

## Unrated
- Tile with Shotboost {+2} and no landing effect.

## Weak

## Medium
- Unit with Kingsgift: {double the King's maximum HP}. Low-priced Prevenience. Can't move. 1 HP.
- Unit that "punches" an adjacent stone, launching it in a direction (N/S/E/W). If it hits a unit, it stops there and deals 5 damage.

## Powerful
- Tile that nullifies damage your units would take this turn (a way to prevent self-damage from AoE).
- Tile (Dogma): your amount of each resource is only how much more of it you have than your opponent.
- Tile (Dogma): no player can build units of the resource type of the unit on it. No effect if a stone.
- Tile (Dogma): shrinks the board vertically by 2 squares, 1 per side, pushing everything. If a column is full, it shrinks only as much as it can.
- Passive that duplicates a unit (maybe the one closest to the enemy King; creation order breaks ties) next to a stationary unit.
- Vertical line: moves stones away from the center (can push other stones in turn, but not units).
