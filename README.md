# Uatbotl

A two-player, perfect-information, zero-luck strategy game on a 16×16 board (8×8 and 12×12 can be chosen per game). It is decided spatially: by where pieces are, what they can see, and what they block. This repository implements the canonical age, **1200 BC**, as a web game for local (hotseat) playtesting. The code is structured for online play later.

- Design spec: [`docs/init-spec_v0_7.md`](docs/init-spec_v0_7.md)
- 1200 BC roster: [`docs/1200_BC_unit_spec.md`](docs/1200_BC_unit_spec.md)
- How the engine resolves cases the spec leaves open: [`docs/RULES_NOTES.md`](docs/RULES_NOTES.md)
- Game notation (reading and writing game records): [`docs/NOTATION.md`](docs/NOTATION.md)
- Online play plan: [`docs/ONLINE.md`](docs/ONLINE.md)

## Playtesting

```sh
npm install
npm run dev        # http://localhost:5173
```

Or build a single self-contained file that works offline:

```sh
npm run build      # → dist/index.html (no server or network needed; open it from disk)
```

Every successful build also saves a dated copy as `archive/index-YYYY-MM-DD_HHMMSS.html`.

You can send `dist/index.html` to playtesters as-is. Open that file (or an archived copy), e.g. `chromium dist/index.html`. The `index.html` in the repository root is only the source page for `npm run dev` and the build; opened directly it just points you to `dist/index.html`.

### Controls

- **New game** lets you pick the board size: 8×8, 12×12 or 16×16. The Kings and Queens keep their usual offsets.
- **Last turn:** squares where the other player's previous turn moved or created something (units, stones, tiles; built, moved, pushed, placed or laid) have a thin glow inside the square, drawn over the piece and tile so their colours stay true. Your own changes are not marked as you make them.
- **Drag a unit** onto a square its Move action reaches to move it in one gesture.
- **Click one of your units** to select it. Its first available action is pre-selected, and the panel lists every action with how many legal options it has.
- **Gold dots** are empty target squares. **Orange rings** are target pieces. Click them to complete the action. Multi-step actions (Undertaking: move, then place the stone; Build: what, then where; Push: stone, then direction; ray Stonepush: stone, then where it ends up) walk you through each step. **Esc** or **Back** steps back.
- **Hover** a square to see the piece and tile there: HP, actions, passives (including gifts), traits.
- **Replay:** the bar under the title steps through the game one input at a time: `|<` start, `<` back, `Play`/`Pause`, `>` forward, `>|` live position, or drag the slider. The arrow keys, Home and End do the same. While you look at an earlier position the board is read-only; **Play from here** continues the game from that point (the later inputs are discarded).
- **Paste…** (Moves panel) loads a game from notation, either at its last position or for replay from the start. **Load** takes a save file (`.json`) or a notation text file (`.txt`).
- **Budget:** each resource shows a small icon of the stone shape that produces it (one stone; a horizontal, diagonal or vertical pair; a lone stone). Hover a resource to draw its instances on the board for the side to move: a line between the two stones of each pair (Prevenience, Deduction, Multiplicity), a dot on each single stone (Extension, Incursion). Click to pin it.
- **Moves** shows the game in chess-like notation ([`docs/NOTATION.md`](docs/NOTATION.md)). **Copy** puts the whole game on the clipboard; **Paste…** loads a game from notation.
- **Undo** (Ctrl/⌘+Z) takes back any input, including tile choices. The game **autosaves** in the browser. **Save** / **Load** export and import a JSON game record; **Load** also accepts a text file of notation.
- **◂** in the board's top-right corner opens the creation-order (ID) menu; stone IDs are optional.
- **Roster** shows every unit and tile from the data file, one tab per resource type (plus Royals), with that type's tiles at the bottom. "Built by" / "Made by" name the units that build each unit, or build, pave or lay each tile.
- **Settings:** **Pixel style** switches to the original look: 32×32 single-colour pixel sprites with at least one line of symmetry (two for royals and gates), and tiles as plain colour fields. **Unit names** prints every unit's full name in small text on the board.
- **Flip board** / **Auto-flip** change orientation for hotseat play.
- Some choices belong to the other player, e.g. where their unit is displaced. The prompt always names the side that must decide.

### Sample game

[`games/every-unit.txt`](games/every-unit.txt) is a generated game in which every unit and tile is built, and most units then act. To watch it: open the game, **Moves → Paste…**, paste the file's text, **Load and replay from the start**, then press **Play** or step with the arrow keys. A test checks that it loads and replays to the identical game. Regenerate it with `VITE_REGEN=1 npx vitest run tests/tools/regenerate.test.ts`.

## Development

```sh
npm test           # engine, notation and match tests, including random-game fuzzing
npm run typecheck
```

### Layout

```
src/data/age1200bc.ts   All units, tiles and numbers for 1200 BC (the data file)
src/engine/             Pure rules engine — no DOM, no I/O, deterministic
  types.ts              State, inputs, data schema (all plain JSON)
  geometry.ts           Squares, directions, range parsing (rangeN, queensmove, triforwardjumpN, …)
  targeting.ts          Movement/targeting against a board, shots, push planning
  rules.ts              Registry, economy templates, gifts, damage, mutations
  options.ts            Enumerates every legal fully-specified choice
  engine.ts             Task interpreter: turn phases, passives, tile cascades, game end, notation parser
  notation.ts           Game notation: recorded as the game is played, formatted, option texts
src/net/match.ts        MatchClient interface + LocalMatch (hotseat, undo, save files)
src/ui/main.ts          Vanilla TypeScript DOM client
src/ui/pixels.ts        Procedural 32×32 sprites for the pixel style
games/                  Sample games in notation (every-unit.txt)
tests/tools/            The sample-game generator
archive/                Dated copy of every successful build
tests/                  Vitest suites
```

### Engine model

- The state is plain JSON. `applyInput(state, input)` returns the next state, and `legalOptions(state)` lists every legal answer to the current decision (`state.pending`).
- A decision is always one **Command**: `{ unit, a, picks }`, where `a` is the action slot and `picks` are the squares or ids chosen in order. The UI narrows options pick by pick, and the engine validates an input by looking it up in `legalOptions`.
- Turn phases, passives, bonus actions and tile cascades run on a serialisable task stack. The engine therefore pauses cleanly whenever it needs a choice from either player, even mid-cascade.
- Units and tiles are data. Actions, passives, traits and tile effects are named keywords with parameters (`{ kw: 'shoot', dirs: 'forward', dmg: 1 }`), so most new units need no code. A brand-new keyword is implemented once in `options.ts` (legal choices) and `engine.ts` (effect).

### Adding an age

Write an `AgeDef` like `src/data/age1200bc.ts` and register it with `registerAge` (see `src/engine/index.ts`).
