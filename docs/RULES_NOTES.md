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
- **Undertaking as an action** must place a stone. When Undertaking comes from a tile (Undertaker), "do as much as possible" applies: if no move-and-place exists, a move alone is allowed ("Place no stone").

## Tiles

- **Nested cascades resolve depth-first.** When a tile's effect lands more pieces, those landings resolve, in ID order, before the rest of the landings from the original action.
- **A tile activates only if the landed piece is still on it** when its turn to resolve comes. For example, a piece killed by an earlier Burst in the same cascade triggers nothing. That tile is not spent.
- **Who decides a tile's choices:** the landed unit's owner, or the turn player for a stone (§12.3). This can be the *opponent* during your turn, e.g. choosing where their own unit is displaced.
- **The non-turn player has no budget.** If an enemy unit gets a Self-Execute action on your turn and builds, only 0-cost units are affordable.
- **Tiles are built only by the gate named in "Built by".** The King builds units, not tiles.
- **Unitary tiles:** one of each per board half (the lower floor(height/2) ranks / the rest; on an odd height the middle rank is Blue's half).
- **Lay onto an occupied square** counts as a landing for the piece standing there (§12.2).
- **Pave leaves its tile only if the square just left has none** (§12.4). The move always happens.
- **Undertaker** uses the landing unit's first Move action as its range. It does nothing to a stone or to a unit with no Move action.

## Building

- **King:** Extension units and gates of every type. **Gates:** gates of their own type (an Incursion Gate builds Incursion and Aggressive Incursion Gates), units that require their own type, and their own tiles. Never another type's gate. *(rules.ts `scopeAllows`)*
- **Unitary units** (all five gift units): one alive per player. Once it dies, another may be built.
- **Aggressive Incursion Gate** got the "+1 gate build range" too: forwardjump5 → forwardjump6.
- **Shelter {n}** fills the n squares centred in front (n odd). Plain Shelter is {3}.
- **Gate walls are Scrap.** Shelter and Shield create the gate owner's Scrap (free, 1 HP, no actions), not neutral stones. They are units, so they get IDs from the owner's sequence, numbered left to right from the turn player. They do not count toward resources. *(the `unit` parameter of `shelter` / `shield`; without it they still make neutral stones)*

## Gifts

- A gift trait grants a **passive**, an **action** or a **trait** to the owner's **King** (Kingsgift) or **Queen** (Queensgift). *(rules.ts `giftsTo`, `actionsOf`, `effectivePassives`, `hasEffectiveTrait`)*
- Gifted passives resolve at the receiver's ID. Gifted actions would come after the unit's own in its action list (none in 1200 BC).
- A duplicate gift adds nothing unless it is additive. All gift units are unitary, so this does not arise in 1200 BC.
- **Stone throw** (Follower → Queen): a **passive**. In the passive phase she places a stone of hers on an empty square her queen's move reaches, without moving. Like all passives it is mandatory whenever possible.
- **Advisor** (→ King): an **optional** passive Move {range1} in the passive phase. The King's owner may decline.
- **Royal Path** (→ King): when a consequence tile activates on the King, once that tile's whole cascade has resolved, the King's owner **may** move him to an adjacent empty square. If that lands on another unspent tile, it activates and he may step again. This can happen on the opponent's turn (e.g. the King is pushed onto a tile); the King's owner decides.
- **General** (its own passive, not a gift): at the General's ID in the passive phase, its owner may take **one attack** with any of their units. Anything that only deals damage counts as an attack: **Attack** (King, Warrior, Horse) and **Shoot** (Queen, Slinger, Vaulter, Bishop, Rook). Moveattack does not count, since it also moves. It is optional; with nothing to attack there is no prompt. Declining is written `Gn-`.

## Fragile

- Checked **at the start of its owner's turn**, right after the budget is computed and before passives: a Fragile unit dies if that budget (what the stones produce, §10.2) is below its cost. A fallen unit grants nothing that turn.
- Between checks it survives, even if its stones are destroyed. Several die in ID order. The kill goes to the owner (the turn player). In notation the death opens that turn's prelude, e.g. `#h3|`.

## Destroying without damage

- **Self-destruct** (the gift units: Accelerator, Ardent Follower, Advisor, Royal Path, General) removes the unit outright. It counts as a kill by its owner, so it goes to the owner's Captures. It is always legal, so a player with such a unit can never be stalemated.
- **Clear** (Path Clearer: its whole file) and **To Dust** (the 3×3 around the tile) destroy stones outright regardless of HP: player-coloured, neutral and reinforced alike. Units are untouched. Several stones die in ID order (§4.1): the turn player's, then neutral, then the opponent's. Clear's kills go to the Path Clearer's owner; To Dust's to the turn player, like other tile kills.
- Clear is offered only if its file holds at least one stone.
- Costs not given by the design were set as: **To Dust 2 D** (as Burst), **Path Clearer 3 D**, 1 HP.

## Passive Move and Attack (Soldier)

- Passives resolve in the passive phase in listed order: the Soldier first steps forward, then attacks the square directly in front.
- "Units do what they can": a blocked step is skipped (no push), and an attack with nothing in front is skipped. Both are single forced choices, so they resolve without asking.
- The attack hits whatever is there, own pieces included, like the Vaulter's passive Shoot.

## Ray Stonepush (Queen, Bishop, Rook)

- Targets the **first piece** along one of the unit's rays (eight / diagonal / orthogonal). It must be a **stone** of any owner. Units block the ray.
- The stone is pushed **away from the pusher, along that ray, any distance the player chooses**. The choice is the square it ends on. Pieces ahead of it are pushed too, like Stonepush.
- The board edge or a reinforced stone anywhere in the chain stops the push. Only end squares the stone can actually reach are offered.
- The pusher does not move.

## Board size

- New games are 8×8, 12×12 or 16×16 (default), listed in the age data as `boardSizes`.
- **Costs can depend on the board size.** The age data's `costsBySize` maps each size to cost overrides by unit or tile id (the resource stays the same); anything not listed costs its base amount. For now every cost is the same on every size.
- **Setup keeps every offset.** Files shift by floor((width − 16) / 2), so the pieces stay centred (exactly, on even widths). Each side stays on its own back rank.
- The board size is part of the save file. Older saves without it load at 16×16. Saves on sizes no longer offered (anything but 8, 12 or 16 square) don't load.

## Pieces and targeting

- **Area attacks** (Burst) damage every piece in range1inc in ID order. The first Ipseity death ends the game at once.
- **Kills** go to the Captures box of the player who owns the damage source. Tile damage belongs to the turn player (§13).
- **Relocate / Reallocate** move one piece (x = 1 is all the roster uses), of any owner, including Kings. The acting unit cannot move itself.
- **Castle:** the King moves up to two squares toward the unit. The unit then lands on the square beside the King on the far side from where the unit started, if that square is empty. As in chess castling, the unit ends up on the side the King came from.
- **Stones created together** (Shelter) are numbered left to right from the turn player's view: ascending file for Red, descending for Blue.
- **Reinforce** is implemented as a keyword (7 HP, immovable, stops push chains) but no unit has it yet, as in the roster.
- **Setup placement is not a landing.**

## Notation

- Recorded by the engine as the game is played (`state.notes`), so tile cascades, deaths and the other player's choices appear in the order they happened. See [`NOTATION.md`](NOTATION.md).
- Forced choices that auto-resolve still appear in the notation, but are not inputs.
- Draw offers and declines do not appear; an agreed draw appears as the result `1/2-1/2`, a resignation as `1-0` / `0-1` with no King death.

## Repetition

The start-of-turn position key contains: side to move, and each square's piece (owner + unit type, or stone / reinforced stone, plus its HP when below full) and tile type. **HP counts:** a cycle that drains a Memory unit (King, Queen, Clay Wall) by 1 each time never repeats. Pieces without Memory are always at full HP at the start of a turn, so only Memory damage matters. IDs are ignored (§5). The third occurrence is a draw.
