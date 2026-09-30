# Rules implementation notes

The spec (`init-spec_v0_7.md`) and roster (`1200_BC_unit_spec.md`) leave some cases open. This file records how the engine resolves each one, so playtesters know what they are testing and designers can overrule it. Each entry names the code that implements it.

## Turn flow

- **Passive order.** The active player's units resolve their passives in ID order (§4.1). A Kingsgift or Queensgift passive resolves at the King's or Queen's ID (§9.3). *(engine.ts `passives` task)*
- **Several base actions** (Accelerator). Each one is taken in turn. Stalemate (§5) applies only when the *first* action of the turn has no legal option. If a later action has no legal option, it is forfeited. *(engine.ts `actionPhase`)*
- **Build Action** (Building Committee) is a passive, so it is mandatory. Scrap costs 0, so the King can usually build something. The Committee therefore normally forces a build every turn. This follows §4 ("passives cannot be declined") and is worth watching in playtests.
- **Self-Execute** grants an action that the owner may **decline**. It is a tile consequence, not a passive.
- **Forced single choices auto-resolve.** Non-main decisions with exactly one legal option resolve by themselves: a Displace with one free square, a passive forward Shoot, a forced Build with one option. Main actions always wait for the player.
- **Draw offers** stay open until the other player accepts, declines, or takes a main action (taking one declines implicitly).

## Legality: actions must do something

- A **Shoot** is offered only in directions where it would hit a piece. An empty shot does nothing, and allowing it would amount to a free pass.
- **Stonepush / Push** is offered only if at least one piece would move. **Castle** is offered only if the King or the unit would move.
- **Moveattack** (Speartrick) needs a target from the landing square. Moving onto a tile without attacking is the plain Move action.
- **Shelter / Shield** need at least one free square in front.
- **Undertaking as an action** must place a stone. When Undertaking comes from a passive (Ardent Follower) or a tile (Undertaker), "do as much as possible" applies: if no move-and-place exists, a move alone is allowed ("Place no stone").

## Tiles

- **Nested cascades resolve depth-first.** When a tile's effect lands more pieces, those landings resolve, in ID order, before the rest of the landings from the original action.
- **A tile activates only if the landed piece is still on it** when its turn to resolve comes. For example, a piece killed by an earlier Burst in the same cascade triggers nothing. That tile is not spent.
- **Who decides a tile's choices:** the landed unit's owner, or the turn player for a stone (§12.3). This can be the *opponent* during your turn, e.g. choosing where their own unit is displaced.
- **The non-turn player has no budget.** If an enemy unit gets a Self-Execute action on your turn and builds, only 0-cost units are affordable.
- **Tiles are built only by the gate named in "Built by".** The King's "anything unlocked" covers units, not tiles.
- **Unitary tiles:** one of each per board half (ranks 1–8 / 9–16).
- **Lay onto an occupied square** counts as a landing for the piece standing there (§12.2).
- **Pave leaves its tile only if the square just left has none** (§12.4). The move always happens.
- **Undertaker** uses the landing unit's first Move action as its range. It does nothing to a stone or to a unit with no Move action.

## Pieces and targeting

- **Area attacks** (Burst) damage every piece in range1inc in ID order. The first Ipseity death ends the game at once.
- **Kills** go to the Captures box of the player who owns the damage source. Tile damage belongs to the turn player (§13).
- **Relocate / Reallocate** move one piece (x = 1 is all the roster uses), of any owner, including Kings. The acting unit cannot move itself.
- **Castle:** the King moves up to two squares toward the unit. The unit then lands on the square beside the King on the far side from where the unit started, if that square is empty. As in chess castling, the unit ends up on the side the King came from.
- **Stones created together** (Shelter) are numbered left to right from the turn player's view: ascending file for Red, descending for Blue.
- **Reinforce** is implemented as a keyword (7 HP, immovable, stops push chains) but no unit has it yet, as in the roster.
- **Setup placement is not a landing.**

## Repetition

The start-of-turn position key contains: side to move, and each square's piece (owner + unit type, or stone / reinforced stone) and tile type. HP and IDs are ignored (§5). The third occurrence is a draw.
