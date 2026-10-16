# Game notation

A chess-like record of a whole game in plain, typable ASCII. It uses no brackets of any kind. It is complete: the game can be rebuilt from the text alone (Moves → **Paste…**, or **Load** with a text file).

```
16x16 1. Qg4@k8 Kh15 2. K+Sch2 Qj13@j9 3. Qg8@d5 K+Slg16 ... 1-0
```

## Layout

- **Header:** the board size, `WIDTHxHEIGHT`: `8x8`, `12x12` or `16x16`.
- **Rounds:** `N. red blue`. A game that starts with Blue begins `1... blue`.
- **A turn** is its **prelude** (Fragile deaths, then passives such as a Vaulter's shot, a Soldier's step, the Queen's stone throw, the King's move from an Advisor, the General's bonus Attack, and Building Committee builds), then `|`, then its **main actions**. Without a prelude, there is no `|`.
- **Actions** within a phase are separated by `,`.
- **Result** after the last turn: `1-0` (Red wins), `0-1` (Blue wins), `1/2-1/2` (draw). A decisive result without a King death (`##`) was a resignation or a stalemate.

## Actions

`P` is the acting unit's code. When another unit with the same code could produce the same text, the code is followed by the unit's origin **file**, else its **rank**, else its full **square**, as in chess (`Wade5`, `Wa6e5`, `Waf4e5`).

| Text | Action |
|---|---|
| `Pf2` | Move to f2 |
| `P:f2` | Attack f2 |
| `P*f2` | Shoot f2 |
| `P+Xf2` | Build unit or tile `X` on f2 |
| `P>f2g3` | Push / Stonepush / ray Stonepush: the piece on f2 goes to g3. For Push and Stonepush, g3 is the first square of the push |
| `Pf2@c5` | Undertaking: move to f2, place a stone on c5 (`Pf2@`: no stone) |
| `PO-O` | Castle |
| `Pf2-f3` | Relocate / Reallocate: the piece on f2 to f3 |
| `P=` | Shelter / Shield |
| `Pf3T` | Pave: move to f3, leaving tile `T` behind |
| `PTf2` | Lay tile `T` on f2 |
| `Pf2:f5` | Moveattack: move to f2, attack f5 |
| `P^f2` | Reinforce |
| `P&` | Clear: destroy the stones on its line (Path Clearer: its file) |
| `P~` | Self-destruct |
| `P@f2` | Stone throw: a stone on f2, without moving (the Queen's passive with an Ardent Follower) |
| `P-` | An optional choice declined: the Advisor's King move (`K-`), Royal Path (`K-`), the General's bonus Attack (`Gn-`) |

## Consequences

These attach directly to the action that caused them, in the order they happen. A square is written only when it differs from the last square written.

| Text | Meaning |
|---|---|
| `!Tf2` | Tile `T` on f2 activates |
| `#f2` | The piece on f2 dies |
| `##f2` | A King dies (the game ends) |
| `d6` | After `!Dp`: where the displaced piece goes (its owner's choice) |
| `-` | A Self-Execute action is declined |
| `!SxWae6` | A Self-Execute, Undertaker or Royal Path action follows its tile directly (`Ke5!BuKe6`, or `Ke5!BuK-` if declined) |

Examples: `PC&#d12#d3` (Path Clearer clears its file; the stones on d12 and d3 are destroyed, in resolution order). `Soe5,So:e6#` (a Soldier's prelude: steps to e5, attacks e6, which dies). `Ac~#h3` (Accelerator on h3 self-destructs). `Q*c9##` (Queen shoots the King on c9, which dies). `TtBue6!Bu##f7` (Trapthrower lays Burst on e6, which activates and kills the pieces on e6 and f7). `Tbe5!Dpd6` (Trailblazer lands on Displace and is moved to d6).

## Codes

Units use their board glyph, except **Scrap** (`Sc`): `K` `Q`, `Sc` `Sl` `CW`, `PG` `Ca` `Hl` `SD` `Ad`, `DG` `Tb` `Tt` `St` `PC` `RP`, `MG` `BC` `Ac` `QP` `AF`, `IG` `XG` `Va` `Wa` `Ho` `Bi` `Ro` `So` `Gn`.

Tiles: **To Dust** `TD`, **Displace** `Dp`, **Burst** `Bu`, **Self-Execute** `Sx`, **Undertaker** `Ut`.

## Why it is unambiguous

At every decision the engine gives each legal option a text, and these texts are always distinct (the disambiguation above guarantees it; a test checks it across random games). `parseNotation` replays the game from the start and, at each decision, takes the option whose text comes next. Consequences are written by the engine, so the parser only checks them. Forced single options resolve by themselves, so a text cut between rounds still reads. The tests convert random games on several board sizes to notation and back to the identical game.

Not recorded: draw offers and declines, which do not change the game. An agreed draw shows as the result.
