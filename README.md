# Uatbotl

A two-player, perfect-information, zero-luck strategy game on a 16×16 board. It is decided spatially: by where pieces are, what they can see, and what they block. This repository implements the canonical age, **1200 BC**, as a web game for local (hotseat) playtesting. The code is structured for online play later.

- Design spec: [`docs/init-spec_v0_7.md`](docs/init-spec_v0_7.md)
- 1200 BC roster: [`docs/1200_BC_unit_spec.md`](docs/1200_BC_unit_spec.md)
- How the engine resolves cases the spec leaves open: [`docs/RULES_NOTES.md`](docs/RULES_NOTES.md)
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

You can send `dist/index.html` to playtesters as-is.

### Controls

- **Click one of your units** to select it. Its first available action is pre-selected, and the panel lists every action with how many legal options it has.
- **Gold dots** are empty target squares. **Orange rings** are target pieces. Click them to complete the action. Multi-step actions (Undertaking: move, then place the stone; Build: what, then where; Push: stone, then direction) walk you through each step. **Esc** or **Back** steps back.
- **Hover** a square to see the piece and tile there: HP, actions, passives (including gifts), traits.
- **Undo** (Ctrl/⌘+Z) takes back any input, including tile choices. The game **autosaves** in the browser. **Save** / **Load** export and import a JSON game record.
- **◂** in the board's top-right corner opens the creation-order (ID) menu; stone IDs are optional.
- **Roster** shows every unit and tile from the data file. **Flip board** / **Auto-flip** change orientation for hotseat play.
- Some choices belong to the other player, e.g. where their unit is displaced. The prompt always names the side that must decide.

## Development

```sh
npm test           # engine + match tests, including random-game fuzzing
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
  engine.ts             Task interpreter: turn phases, passives, tile cascades, game end
src/net/match.ts        MatchClient interface + LocalMatch (hotseat, undo, save files)
src/ui/                 Vanilla TypeScript DOM client
tests/                  Vitest suites
```

### Engine model

- The state is plain JSON. `applyInput(state, input)` returns the next state, and `legalOptions(state)` lists every legal answer to the current decision (`state.pending`).
- A decision is always one **Command**: `{ unit, a, picks }`, where `a` is the action slot and `picks` are the squares or ids chosen in order. The UI narrows options pick by pick, and the engine validates an input by looking it up in `legalOptions`.
- Turn phases, passives, bonus actions and tile cascades run on a serialisable task stack. The engine therefore pauses cleanly whenever it needs a choice from either player, even mid-cascade.
- Units and tiles are data. Actions, passives, traits and tile effects are named keywords with parameters (`{ kw: 'shoot', dirs: 'forward', dmg: 1 }`), so most new units need no code. A brand-new keyword is implemented once in `options.ts` (legal choices) and `engine.ts` (effect).

### Adding an age

Write an `AgeDef` like `src/data/age1200bc.ts` and register it with `registerAge` (see `src/engine/index.ts`).
