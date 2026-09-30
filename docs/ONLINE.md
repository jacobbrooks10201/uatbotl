# Path to online play

The codebase is built so online play is an addition, not a rewrite.

## What already holds

- **Deterministic engine.** `applyInput(state, input) → state` has no randomness, no clock, no I/O. The same inputs always produce the same state (the fuzz test replays logs to check this).
- **Serialisable everything.** `GameState`, `Input` and `Command` are plain JSON. Pending decisions are data (`state.pending`), not closures, so a state can be stored in a database or sent over a socket in the middle of a tile cascade.
- **Input log = game.** A game is `{ age, inputs[] }` (the save-file format). Any state can be rebuilt by replaying.
- **Decisions name their player.** `state.pending.player` says who must answer. This can be the non-turn player (e.g. a Displace of their unit). A server can route prompts without extra logic.
- **The UI talks only to `MatchClient`** (`src/net/match.ts`). Hotseat uses `LocalMatch`. An online client implements the same interface.

## Suggested design

**Server-authoritative relay** (small, cheat-proof):

1. The server keeps `{ age, inputs[], state }` per match. It runs the same `src/engine` code (it is dependency-free TypeScript and runs on Node, Deno, Bun or Workers).
2. A client sends `{ matchId, seq, input }`. The server checks the seat, then calls `applyInput`. If that throws `IllegalInput`, the server rejects the input. Otherwise it appends the input and broadcasts `{ seq, input }` to both clients.
3. Clients apply broadcast inputs in `seq` order. On reconnect they fetch `inputs[]` and replay.
4. `RemoteMatch implements MatchClient` with `seats = [mySeat]`. `canUndo()` returns false, or becomes a takeback request both players accept.

Wire messages need nothing beyond `Input`. Validation is the same `legalOptions` lookup the local UI uses.

## Time controls

Clocks belong in the match layer, not the engine, so the engine stays pure:

- The server stamps each accepted input with a server time. It charges the elapsed time to `pending.player` — the player who was deciding, which is not always the turn player.
- When a player's time runs out, the server appends a synthetic timeout (a new `Input` variant, e.g. `{ type: 'timeout', player }`). The engine turns it into a result the same way it handles `resign`.
- Increment and delay settings are per-match data.

## Hidden information

None: Uatbotl is perfect-information, so the whole state can be sent to both players.
