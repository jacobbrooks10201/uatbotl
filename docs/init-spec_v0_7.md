# Uatbotl — Design Spec v0.7

Uatbotl is a two-player, perfect-information, zero-luck digital strategy game for the web. Its depth is **spatial rather than numerical**: positions are decided by where things are, what they see, and what they block, not by accumulating stat advantages. Numbers stay small.

This document holds the core rules and the canonical age, **1200 BC**. The unit and tile roster lives separately in `1200_BC_unit_spec.md`.

---

## 1. Terminology

| Term | Meaning |
|---|---|
| **Square** | A cell of the board. |
| **Piece** | Anything that occupies a square: units (including the King, Queen, and gates) and stones. |
| **Unit** | A player-owned piece with HP and, usually, actions or passives. Gates are units. |
| **Unit ID** | A permanent number given to each piece when it is created. It defines creation order and resolution order. |
| **Gate** | A unit that unlocks other units and can build them within its build range. |
| **Stone** | A blocking piece. Player-colored stones generate resources for their owner; neutral stones belong to no one. |
| **Tile** | A floor object on a square. Side-neutral. Does not occupy and never blocks. |
| **Action** | Something a unit does when the player spends an action on it. |
| **Passive** | An effect that resolves in the passive phase. Mandatory, but may involve choices. |
| **Trait** | A permanent property of a piece or tile (e.g. Memory, Shotboost). Not a passive. |
| **Keyword** | A named, parameterized effect used by actions, passives, and tiles (e.g. Pave, Shoot). See §15. |
| **Captures** | Each player's box of pieces they have killed (§13). Not a capture in the chess sense. |

Never use "tile" for a board square.

Parameters are written in braces: `Move: {range1}`.

---

## 2. Structure: Historical Ages

The game ships as configurations keyed to historical ages. **Ages are different formats, not replacements.** Each has its own roster, tiles, gates, and resources, and is independently balanceable and shippable.

**1200 BC is the canonical age** and is designed first. A leaner, simpler 3000 BC set will be derived from it later.

**1200 BC scope:** 3 gates, 5 resources (all level-1, no derived resources), target roster of roughly 20–50 units.

---

## 3. Board and Setup

**16×16 square grid.** Files a–p run left to right from Player 1's side; ranks 1–16 run from Player 1's back rank to Player 2's.

Each player begins with **only a King and a Queen** on their back rank. From each player's own perspective, the back rank reads:

```
. . . . . . Q . K . . . . . . .
```

| Player | Queen | King |
|---|---|---|
| P1 | g1 | i1 |
| P2 | j16 | h16 |

The pairs are offset and interleaved so that no starting piece has line of sight to any enemy piece; otherwise Player 1 opens with a free shot.

There are no stones or tiles at the start. Starting tile configurations remain a design lever, but the game must be sound on a bare grid.

**Occupancy is absolute: nothing may enter an occupied square.** Stones and units (including gates) occupy. Tiles do not. This is the foundation of the spatial system; blocking, walling, and suppression all follow from it.

**Directions.** Forward is relative to a piece's owner: toward the opponent's back rank. Neutral pieces use the turn player's forward. Horizontal means along a rank and vertical means along a file, which is the same for both players.

**Board halves.** Ranks 1–8 are Player 1's half; ranks 9–16 are Player 2's half. Unitary tiles use this (§12).

No pie rule.

---

## 4. Turn Structure

**1. Start of turn.** The active player's resource budget is computed from their stones (§10.2).

**2. Passive phase.** All of the active player's passives resolve, one piece at a time, in unit ID order. Passives are mandatory and cannot be declined, including when they harm the player's own pieces. A passive may involve choices (where to move, which square to target); the player makes them as it resolves. If a passive has no fully legal outcome, it does as much as possible.

**3. Action phase.** One action, plus any bonus actions granted during the turn (§6).

**4. End of turn.** Every piece **without** Memory regenerates to full HP. This happens at the end of *every* turn, not just its owner's. Spent tiles reset. Any unspent budget is lost.

*Design intent is that long, convoluted passive chains are uncommon and not strong.* The creation-order list is available in the UI but not surfaced prominently (§16).

### 4.1 Unit IDs and resolution order

Every piece gets a permanent ID when it is created, counting up within its own sequence. IDs are never reused: a dead piece keeps its number.

- **King is #1 and Queen is #2** for each player.
- **Stones have IDs too**, hidden by default in the ID menu. **Neutral stones have their own neutral ID sequence.**
- When several stones are created at once, they are numbered **left to right from the turn player's perspective**.

Whenever several things would resolve at once — passives, tile activations from a single action, anything else simultaneous — they resolve in **ID order**. When pieces of different sides are involved:

**Turn player's IDs → neutral IDs → opponent's IDs**, each ascending.

Order is therefore always fully determined. There is no simultaneity to arbitrate.

---

## 5. Game End

- **Win: Ipseity.** If a unit with Ipseity dies, its owner loses. In 1200 BC only the King has Ipseity.
- **Resignation.** A player may resign at any time.
- **Stalemate loses.** If the active player has no legal action in the action phase, they lose. This should be rare; heavy stone flooding is the most likely route.
- **Draw by agreement.** Players can agree to a draw.
- **Draw by repetition.** If the same board state occurs for the third time, the game is drawn. **Board state means the start-of-turn configuration of pieces and tiles on the board.** Internal state does not matter: differing HP is still the same state, and IDs are ignored, so two of your own stones swapping places is the same state.

---

## 6. Action Economy

**One base action per turn**, granted by the King's `+1 Action` passive.

**Units do not act independently. Units expand the menu your actions can spend on.** Army size does not change turn length.

**Bonus actions exist but are limited and expensive.** In 1200 BC the sources are:

- **Build Action** passives (e.g. Building Committee): an extra action, taken immediately, that must be a Build.
- **Self-Execute** tiles: an extra action, taken immediately by the unit that landed on the tile. Unitary.

Combos and chains are intended. They are bounded by the cost of bonus-action sources, by the per-turn resource budget, by Unitary, and by the once-per-turn tile rule (§12).

---

## 7. Health and Damage

**Memory** is a trait: pieces with it retain damage between turns. In 1200 BC, the King, the Queen, and the Clay Wall have it. Everything else, including gates and stones, regenerates to full at end of turn.

**HP scale:** most units have 1 HP; 3 HP is rare; the King and Queen have 10; stones have 5, or 7 when reinforced. Individual damage sources deal 1, occasionally 2 or more. **Keeping any single hit at 3 damage or less is a current design constraint, not a rule.**

**Consequence: HP is a burst threshold, not a pool.** A 2 HP piece without Memory cannot be killed unless 2 damage lands *in the same turn*. There is no chip damage outside Memory pieces. Killing something means assembling simultaneous damage in one turn from:

- **Passive damage** (passive phase)
- **Tile damage** (triggered by landing, chainable)
- **Actions** (the base action and any bonus actions)

This keeps killing a positioning problem rather than a damage race.

**Stones are deliberately hard to destroy by damage.** Moving them is the cheaper answer (§10).

Attacks may target any piece, including your own. Because the King has Memory, damage to him is permanent unless healed.

**Healing.** Heal and queenheal effects are planned as unit actions but are not in the current roster.

---

## 8. Movement, Line of Sight, and Targeting

**Eight rays** from a piece, extending until blocked. **Stones and units (including gates) block LoS. Tiles do not.**

### 8.1 Range kinds

- **Ray ranges** (queensmove, rooksmove, bishopsmove, forward, horizontal). A move ends on any empty square along the ray before the first piece.
- **Jump ranges** (knightsmove, forwardjumpX, triforwardjumpX). Pieces in between are ignored; only the destination matters.
- **Area ranges** (rangeX). Any square within the area. A **move** into an area range needs a clear path: some sequence of single steps through empty squares, no longer than X, that ends on the destination.
- **Direction sets** (eight directions, orthogonal, diagonal, forward, horizontal) are used by Shoot and Push, which pick one direction.

**Selection.** A range describes the set of legal squares. An effect picks **one** of them unless it explicitly says "all."

### 8.2 Passing over tiles

A moving piece passes over tiles along its path without triggering them. **Only the landing square matters.**

### 8.3 Shots and ray attacks

A **Shoot** is a projectile. It travels along one direction from the shooter and hits the first piece it reaches. If the ray contains no piece, the shot does nothing.

The squares the shot **passes over** are every square from the shooter's neighbor up to and including the target's square. A piece standing on a Shotboost tile therefore boosts the shot that hits it.

**Any unlimited-range attack along a ray is a Shoot.** `Attack` is reserved for range-limited targeting, so the two never blur. Where an Attack does use a ray, it targets the first piece along it and nothing behind.

---

## 9. King and Queen

Full stat blocks are in the roster. Rules-relevant notes:

### 9.1 King

- Passive: **+1 Action**. Traits: **Memory**, **Ipseity**. 10 HP.
- **Move** 1 square, **Attack** adjacent for 1.
- **Build:** anything unlocked, adjacent squares only.
- **Stonepush {1}:** push an adjacent stone one square. This is how a walled-in King breaks out.

King building is intentionally slow and trade-offy. It is all you have early; later it operates alongside gates.

### 9.2 Queen

- 10 HP, trait **Memory**.
- **Undertaking** (action): move as a queen, then place one of your stones on an empty square along a ray from the new square. **Movement is mandatory**; she cannot stand still and place.
- **Move** as a queen.
- **Shoot** in any of the eight directions for 1.
- The Queen is the main source of new stones. The only other source of player-colored stones is the Undertaker tile.

**Queen death** does not lose the game. It removes the main source of new stones; afterward, new player-colored stones can come only from Undertaker tiles. This is intended.

### 9.3 Queensgift and Kingsgift

**Queensgift** and **Kingsgift** are generic traits: a piece with one modifies its owner's Queen or King in the specified way, for as long as it is on the board. The modification belongs to the Queen or King, so **her or his ID governs when the granted passive resolves.** A duplicate granting the same modification adds nothing, unless the modification is additive (`+1 Action`), in which case each source adds its own.

The first Queensgift is the **Ardent Follower's** (3 Extension): the Queen gains Undertaking as a **passive**, while keeping it as an action. This speeds up the early economy, so players don't have to choose between growing and doing things. Because the passive is mandatory, it can become a liability later, and a player may want to kill their own follower.

---

## 10. Stones and Economy

Stones simultaneously **block movement**, **block LoS**, and (if player-colored) **generate resources**. One primitive, three consequences, in permanent tension.

- **5 HP, no Memory.** Difficult to destroy; comparatively easy to move. Dedicated stone-moving and stone-destroying units are planned; the Stone Director and the King's Stonepush are the first.
- **Player-colored stones** come from Undertaking and count toward their owner's resources.
- **Neutral stones** come from gate actions (Shelter, Shield). They block both players and count for no one.
- Stones **trigger tiles** when placed on or moved onto them (§12). A stone sitting on a Dogma tile keeps it pressed.
- Killed stones go to the killer's Captures (§13).

### 10.1 Reinforced stones

**Reinforce** is an action that upgrades a stone: it gains **7 HP and can no longer be moved** by any effect. It still blocks, still counts for resources, and still regenerates to full (7) at end of turn.

An immovable stone stops a push chain: a push that would move one does nothing to it or to anything behind it.

*Reinforce is not yet assigned to a unit. A reversing effect is planned, though probably not in 1200 BC.*

### 10.2 Per-turn budget

**At the start of each turn, the active player's resources are computed from the exact current arrangement of their stones.** That is the budget for the turn:

- **Building spends it.** Each build deducts its cost. A second build in the same turn has to fit into what is left, so multiple buys spread resources thin.
- **Nothing carries over.** Unspent budget is lost at end of turn, and the budget is recomputed from scratch next turn. There is no cap.
- **Stones don't change the budget mid-turn.** Stones placed, moved, or killed during a turn affect the next budget, not the current one.
- **A cost of 0 (Scrap) is always affordable.**

| Resource | Template (counted per match) | Domain |
|---|---|---|
| **Extension** | Each stone you own | General utility; weaker generic alternatives to specialized options |
| **Anticipation** | Each horizontally adjacent pair | Defense: walls, protection, defensive mobility |
| **Deduction** | Each diagonally adjacent pair | Tile-laying, and units that combo with tile activation |
| **Multiplicity** | Each vertically adjacent pair | Ramp: producing more units and actions |
| **Incursion** | Each stone that is part of no other template (Extension excepted) | Aggressive, high-damage units and tiles |

**Only your own stones count.** Enemy and neutral stones never affect your resources, including whether a stone counts as isolated for Incursion.

**Overlapping templates double-count.** As later ages add templates, Incursion becomes harder to earn, by design.

**Economic geometry**, using four stones:

| Shape | E | A | D | M | I |
|---|---|---|---|---|---|
| Row of four | 4 | 3 | 0 | 0 | 0 |
| Column of four | 4 | 0 | 0 | 3 | 0 |
| Diagonal line of four | 4 | 0 | 3 | 0 | 0 |
| 2×2 block | 4 | 2 | 2 | 2 | 0 |
| Four isolated stones | 4 | 0 | 0 | 0 | 4 |

Walls literally make defense, diagonals make tile play, columns make ramp, blocks generalize, and scattered stones arm you. Removing a stone exactly reverses adding it. **Incursion is the only resource that can drop when you add a stone**: placing a stone next to an isolated stone removes that stone from Incursion.

---

## 11. Gates

Gates are units that **unlock other units** and serve as forward production and defensive structures.

- **Three gates** in 1200 BC, one per adjacency resource: Deduction, Multiplicity, Incursion. Extension and Anticipation units need no gate.
- **Unlocking.** A unit whose requirement names a gate is unlocked while you control at least one gate of that type.
- **Who builds what.** A gate's Build action can place units that require that gate type, or any gate, within the gate's build range. The King can build anything unlocked, adjacent only.
- **Build range is set per gate and can be any range.** The three basic gates use a square area: Deduction range2, Multiplicity range2, Incursion range3 (range2 is the 5×5 area centered on the gate). The Aggressive Incursion Gate builds onto a single square, five forward.
- **1 HP, no Memory** in 1200 BC.
- **Multiple gates of the same type are legal.** They grant no additional unlocks; you build them for position and for their other actions.
- Gates can be built adjacent to the enemy, subject to the builder's range.

### 11.1 Gate walls

The Deduction and Multiplicity Gates have **actions** that create neutral stones in front of them:

- **Shelter** (Deduction Gate): three neutral stones, one forward and one on each forward diagonal.
- **Shield** (Multiplicity Gate): one neutral stone directly forward.

Occupied squares are skipped; nothing is pushed. Since a gate doesn't move, the neutral stones one gate can make are bounded by the squares in front of it.

**The Incursion Gate has no wall action.** It trades defensibility for a larger build range.

**When a gate dies,** its neutral stones persist. If it was your last gate of that type, units requiring it can no longer be built. Units already on the board are unaffected. Cutting off production is the real prize.

---

## 12. Tiles

Tiles are **side-neutral** floor objects: identical effect regardless of who lands on them. They do not occupy, never block movement or line of sight, and render beneath the pieces (§16).

### 12.1 Tile types and traits

1. **Consequence.** Activates when a piece lands on it.
2. **Dogma.** A rule effect that is active while the tile is pressed (anything is on it). Mainly for rule changes.

Tiles can also carry **traits**, which work regardless of type and need no landing:

- **Shotboost {+x}** — a shot passing over this tile gains x damage (§8.3). Boosts stack: a shot crossing several boosted squares adds all of them.

A tile may have a trait and no activation effect at all.

### 12.2 Landing

**Landing** is any arrival on a square: moving, jumping, being built, being relocated, displaced, castled, or pushed, a stone being placed or moved there, or a tile being placed beneath a piece. A piece already standing on a tile at the start of a turn triggers nothing, and a piece passing over a tile triggers nothing (§8.2).

### 12.3 Resolution

- A tile **resolves after the action or effect that triggered it completes.** If a tile's effect moves a piece onto another tile, the second tile resolves after the first finishes.
- **No tile may activate more than once in a turn. No exceptions.** Once used, a tile is **spent**: it does not activate again this turn. Spent is inert, not blocking — pieces may still move onto it, they simply trigger nothing. Spent tiles reset at end of turn.
- If an effect would move a piece onto an occupied square, apply **do-as-much-as-possible**: the movement resolves as far as it legally can.
- **Choices** in a tile's effect are made by the landing unit's owner, or by the turn player if a stone landed.
- If a tile's effect cannot apply to a stone, a stone landing there does nothing. Some tiles state this explicitly.
- **Unitary tiles:** only one may exist on each half of the board.
- If a single action lands several pieces on several tiles, they resolve in the ID order of §4.1.

### 12.4 Placing tiles

- **A tile cannot be placed on a square that already has a tile.** Lay fails. Pave still moves the unit but leaves nothing behind.
- Tiles come from units (Pave leaves one on the square just left; Lay places one within range) and from gates that can build them.
- Nothing currently pushes or moves tiles, apart from the board-compression Dogma idea. Replacing and removing tiles is deferred.

**Chaining across different tiles is the point.** A single action can cascade across a tile field, bounded by the board and the once-per-turn rule.

Because tiles are side-neutral, a Deduction strategy arms the opponent too. The edge comes from *choosing what and where*, and from fielding units that interact positively with tiles.

---

## 13. Captures

Each player has a **Captures** box: the Uatbotl equivalent of a graveyard.

- **The killer determines the box.** A killed piece goes into the Captures of the player who killed it. Killing your own unit puts it in your own box.
- **The last point of damage decides** when several sources combine for a kill.
- **Tile damage is attributed to the turn player**, following the general principle that tiles are side-neutral and the turn player owns their consequences.
- **Stones count.** A destroyed stone, player-colored or neutral, goes into the killer's Captures.
- **Tiles go nowhere.** A destroyed tile is simply gone.
- Captured pieces keep their IDs.

1200 BC has little or no interaction with Captures. Later ages may add effects that care about the box, such as its size.

---

## 14. Turtling

A turtled player's economy is geometrically concentrated. The answers:

- **Moving stones** breaks patterns and shrinks the opponent's next budget. Reallocate, Relocate, Stonepush, and the planned stone movers target this directly. A cascading push can shift a whole wall at once.
- **Killing gates** blocks production outright.
- **Higher-tier units** overwhelm passive play.

The Incursion Gate's missing wall action makes aggressive bases structurally more exposed than defensive ones.

*Watch item:* a horizontal wall is now literally the Anticipation template, and reinforced stones cannot be pushed at all. Defensive stone shapes pay defensive resources, so the stone-moving and stone-killing roster has to keep pace.

---

## 15. Keywords, Traits, and Ranges

### 15.1 Actions and passives

- **Move: {range}** — move to an empty square in range, by a clear path (§8.1).
- **Jump: {range}** — move ignoring pieces in between.
- **Attack: {range} {dmg}** — deal damage to one piece in range. Range-limited only; unlimited ray attacks are Shoots.
- **Shoot: {directions} {dmg}** — fire a shot along one of the given directions (§8.3).
- **Moveattack: {move range} {attack range} {dmg}** — move, then attack; the attack range is measured from the new square. May carry a condition.
- **Push: {distance}** — choose an adjacent piece and one of the eight directions, and move it that many squares that way. **Pushes cascade:** any piece in the path is pushed along with it, in the same direction, for the same distance. An immovable piece (a reinforced stone) or the board edge stops the chain; the push then resolves as far as it legally can, so a push of 2 with one free square moves 1. Spent tiles do not stop a push. Every pushed piece has landed (§12.2).
- **Stonepush: {distance}** — as Push, but the chosen piece must be an adjacent **stone**. The cascade behind it can move anything.
- **Reinforce** — upgrade a stone to 7 HP and immovable (§10.1). *Not yet assigned to a unit.*
- **Build: {range} {limits}** — place one unlocked unit or buildable tile, paying its cost from the turn's budget, on a square in range. Units need an empty square.
- **Build Action {+x}** — the player immediately takes x additional actions, each of which must be a Build.
- **Undertaking: {range}** — move within range (mandatory), then place one of the unit's owner's stones on an empty square reachable from the new square by the same range. A unit other than the Queen that performs Undertaking uses the range of its own Move action.
- **Pave: {move} {tile}** — move, and leave the tile on the square just left (if that square has no tile).
- **Lay: {tile} {range}** — place the tile on one tile-free square in range.
- **Castle: {direction}** — the unit and its owner's King must be aligned in that direction with nothing between them. The King moves two squares toward the unit; the unit then moves to the square adjacent to the King on the opposite side. If blocked, as much as possible happens.
- **Shelter** — create three neutral stones: forward and both forward diagonals. Occupied squares are skipped.
- **Shield** — create one neutral stone directly forward. Skipped if occupied.
- **Relocate: {x} units from {range} to {range}** — move up to x units of any owner from squares in the first range to empty squares in the second. Ranges are measured from the acting unit.
- **Reallocate: {x} stones from {range} to {range}** — as Relocate, for stones of any owner, including neutral. Reinforced stones cannot be moved.

### 15.2 Traits

- **Memory** — the piece does not regenerate HP at end of turn.
- **Ipseity** — if this unit dies, its owner loses.
- **Unitary** — of a unit: a player may control only one at a time. Of a tile: only one may exist on each half of the board.
- **Queensgift: {effect}** — while this piece is on the board, its owner's Queen is modified as specified.
- **Kingsgift: {effect}** — while this piece is on the board, its owner's King is modified as specified.
- **Shotboost: {+x}** — of a tile: a shot passing over it gains x damage. Stacks with other boosted squares on the same shot's path.

### 15.3 Ranges and direction sets

All distances are measured in the eight directions (a diagonal step counts as 1).

- **rangeX** — every square within distance X, excluding the piece's own square.
- **rangeXinc** — as rangeX, including the piece's own square.
- **adjacent** — same as range1.
- **queensmove** — all eight rays, until blocked.
- **rooksmove** — the four orthogonal rays, until blocked.
- **bishopsmove** — the four diagonal rays, until blocked.
- **knightsmove** — a chess knight's move. Jump range.
- **forwardjumpX** — the one square exactly X forward. Jump range.
- **triforwardjumpX** — three squares: exactly X forward, and exactly X along each forward diagonal. Jump range.

Direction sets, for Shoot and Push:

- **eight directions** — all eight.
- **orthogonal** — the four orthogonal directions.
- **diagonal** — the four diagonal directions.
- **forward** — forward only.
- **horizontal** — the two horizontal directions.

---

## 16. Presentation

- **Red and blue sides, black board.** Each side's pieces are a single color: red or blue. The background and empty squares are black. **Neutral stones are gray.** **Tiles carry color** and render beneath the pieces. The goal is a cool, technical, esoteric look that matches the archaic terminology (Ipseity, Undertaking, Dogma, Captures).
- **Creation order menu.** A subtle arrow in a corner opens a list of the player's units by ID, counting up. IDs of dead units are skipped in the list. Stone IDs are hidden by default.
- **Captures box.** Each player's box is viewable; 1200 BC gives it no gameplay role.

---

## 17. Build Plan

- **Web game.** Ship 1200 BC complete; the 3000 BC subset follows.
- **All numeric values in a data file**, never in code.
- **Archetypes with shared knobs**, not bespoke units.
- **Rule-changing effects are allowed in 1200 BC** (Queensgift, Kingsgift, bonus actions, Dogma tiles), but are expressed as named traits, keywords, and tile types rather than one-off unit code.
- Costs tuned empirically for fun; no a-priori curve.

---

## 18. Deferred

- **Damage ceiling.** Max 3 per hit is a working constraint.
- **Reinforce's home.** Which unit gets it, at what cost and range, and whether it can target neutral or enemy stones.
- **Un-reinforce**, as a separate effect; probably post-1200 BC.
- **More stone movers and destroyers.**
- **Heal and queenheal** units.
- **Tile replacement and removal.**
- **Captures interactions.**
- **Opening sequence.** Early turns likely combine Queen Undertakings with the King repositioning toward future gate sites, plus the question of when to buy an Ardent Follower. Treated as a tuning problem.
- **Incursion's template.** Scattered stones as the aggressive economy is the intended read for now; worth revisiting against the Incursion roster in playtesting.
