# Arcade Productionization — Design

Date: 2026-08-24
Status: Approved direction (approach A: object-per-game arcade package)
Target: three wagered games, audited, deployed and playable on Aptos **testnet**

## Goals

1. Tic-tac-toe, checkers, and backgammon playable end-to-end on testnet with fixed-APT wagers (winner-take-all).
2. Fund-safety by construction: one audited settlement path, no public function moves funds.
3. Full backgammon rules: dice, movement, hitting, bearing off, gammon/backgammon detection, doubling cube.
4. Checkers finished properly (English draughts): mandatory captures, multi-jump chains, kinging, all-terminal detection.
5. Client restructured as a multi-game arcade UI.
6. Audit-grade testing: exhaustive Move unit tests for rules and settlement, client tests, static security scans, testnet e2e.

## Non-goals

- Mainnet deployment (this round). The design must not preclude it: immutable package, no admin keys in the money path, upgrade = new module version.
- Wagers in tokens other than APT, dynamic stake sizing, rake/fees.
- Backgammon match play (multi-game sessions) and Crawford rules.
- On-chain ELO/profiles.

## Audit findings on current code (drives v2 rewrites)

### tic_tac_toe (move/sources/tic-tac-toe.move)
- **Correctness bug**: `evaluate_winner` anti-diagonal branch returns `*upper_mid` instead of the winning mark (`*lower_left`). Anti-diagonal wins are missed or misattributed depending on `upper_mid`.
- **Predictable first player**: `timestamp::now_microseconds() % 2` is validator-influenced and predictable. Replaced by `randomness` API.
- Games keyed by `String` in a `SimpleMap` under each creator account: unbounded name length, no events, no natural escrow location.

### checkers (move/checkers/sources/checkers.move)
- **Board corruption every move**: `make_move` uses `vector::insert` (grows the board) instead of overwriting cells; state desyncs after the first move.
- **Incoherent jump geometry**: jumps land ±7/±9 while diagonals are ±4/±5; midpoint removal is wrong for several directions.
- **Kings never promoted** (movement exists, promotion doesn't); king step validation copy-paste bug (`step_down || step_down`).
- **Missing rules**: mandatory captures, multi-jump chains, stalemate/no-legal-move loss, draw adjudication.
- `within_board` off-by-one: index 32 aborts with a runtime bounds error instead of `EOUT_OF_BOUNDS`.

### Client
- Hardcoded devnet network + devnet module address (`src/lib/constants.ts`); single-game UI; no game discovery beyond hand-built game IDs.

## Architecture

### Single `arcade` package

One Move package, dedicated testnet deploy account, published immutably. Modules:

- `wager` — escrow and settlement for all games (see below). Only module that touches coins.
- `tic_tac_toe_v2`, `checkers_v2`, `backgammon` — game rules + state transitions. `friend`s of `wager`.
- `hub` — a singleton registry object listing open games per type (lobby discovery), plus package-wide events.

Framework pinned to `rev = "mainnet"` as today. Address placeholder `arcade = "_"` named at publish.

### Game objects

Each game instance is an object created with `object::create_named_object(creator, seed)`:

```
struct Game has key {
    phase: u8,                 // Open | InProgress | Settled (terminal)
    kind: u8,                  // TicTacToe | Checkers | Backgammon
    creator: address,
    player_a: address,         // X (ttt) / Red (checkers) / White (backgammon)
    player_b: address,         // O (ttt) / Black (checkers) / Black (backgammon)
    stake: u64,                // per player, in octas
    last_move_at: u64,         // timestamp, for forfeits
    escrow_cap: u8,            // number of players funded (0..2)
    metadata: String,          // display name
    // plus per-game state resource stored under the same object address
}
```

- The game object hosts an APT `FungibleStore` (via `fungible_asset::create_store` on its ConstructorRef) — this store is the pot. Players deposit by transferring APT into the store; only `wager` code initiates withdrawals.
- Immediately after creation the game object is made **self-owned** (`generate_linear_transfer_ref().transfer_with_ref(self)`) with ungated transfers disabled. Because the store lives on the object, whoever owns the object could otherwise withdraw the pot with plain `fungible_asset` calls; self-ownership means no account can ever sign as owner — only the object's own extend-signer (held inside `Game`, reachable only via `wager`) passes the withdraw permission check. Pinned by `test_creator_cannot_drain_pot`.
- Named objects are not deletable by framework design (`create_named_object` yields `can_delete: false`), so cancelled/settled games persist with an empty pot rather than being burned; deterministic game addresses were chosen over burnability.
- Every mutation emits an event handle entry: `GameCreated`, `PlayerJoined`, `MovePlayed`, `DiceRolled`, `CubeDoubled`, `CubeAction`, `GameSettled`, `GameForfeited`, `GameCancelled`.

### Wager semantics (the audited core)

Fixed APT stake chosen by the creator. All-or-nothing flows:

1. **create(stake)**: mints game object; creator immediately stakes `stake` (pot = 1×). Game listed in hub lobby.
2. **join**: opponent transfers exactly `stake` into the store (enforced by post-transfer balance check in the same function). Pot = 2×. Game moves to InProgress and unassigned randomness (if any) resolves.
3. **cancel**: creator-only, only while phase == Open; refunds pot to creator and delists the game. Nobody else can be harmed because no one else has funds at risk while Open.
4. **settle(winner)**: `public(friend)` — game modules call it only from a provably terminal state. Pays the entire pot to the winner. Draw variant splits 50/50. Emits `GameSettled`, marks Settled. Repeated settle impossible (phase gate + one-shot flag).
5. **forfeit_timeout**: any player may call after `now > last_move_at + TIMEOUT` while InProgress; the game module supplies whose turn it was (only that module can know) and calls `wager::settle` with the non-mover as loser. TIMEOUT = 3 days.
6. **Backgammon cube**: `double` (offer) requires the doubler to escrow `(cube_new − cube_old) × stake` in the same transaction. `accept` requires the acceptor to escrow their matching increment. Pot always equals `2 × stake × cube` once the cube action resolves. On `decline`, the doubler wins at the **old** cube value; the pot is over-funded at that moment and `settle` refunds the excess (invariant I1).
7. **Backgammon gammon (2×)/backgammon (3×)**: detected and recorded on-chain (full rules) and surfaced in events/score, but **payout is always the escrowed pot** — there is deliberately no post-game settlement path that moves additional funds. This keeps exactly one asset-outflow path (`settle`) regardless of game or outcome.

Invariants (test-enforced):
- I1: pot balance ≥ what settlement owes at every reachable state (over-funding refunded on settle).
- I2: only `wager::settle*` move APT out; all are `public(friend)` to game modules only.
- I3: terminal states are one-shot; no re-entry into moves after settle.
- I4: `create` refunds or games always reach a player-callable terminal path (join-timeout: creator can cancel; move-timeout: forfeit) — funds can never be permanently locked.

### Randomness

- `randomness::u8_range` from `aptos_framework::randomness` for backgammon dice and tic-tac-toe first-player.
- Randomness-bearing entry functions (`backgammon::roll`, `tic_tac_toe_v2` create-path coin flip) must be submitted with simulation disabled — the ts-sdk exposes this; Petra/Pontem handle randomness txns. Client wrapper enforces it.
- Backgammon turn = two transactions: `roll` (randomness) commits dice to state; `move/play` consumes them. Opening: each player's offered `roll` uses one randomness draw for both dice (higher starts, ties re-roll by fresh `roll`).
- Checkers needs no randomness.

### Game rules specs (v2)

**Tic-tac-toe v2**: same 3×3 rules, object + wager wrapped; anti-diagonal bug fixed; first player from randomness; reset flow becomes "settle + create new game" (no in-place reset — keeps one settlement path).

**Checkers v2 (English draughts, 8×8, 32 playable cells)**:
- Men move/capture diagonally forward; kings both directions.
- **Captures mandatory**; multi-jump chains continue with the same piece until no capture remains (turn does not pass mid-chain; state tracks `chain_from: Option<u64>`).
- Promotion on reaching far row ends the move (standard rule — no jump continuation after promoting).
- Loss: no pieces, or no legal move on your turn. Board addressed with a proper coordinate model (cell index → (row, col)); moves validated geometrically, not by index arithmetic tricks.
- No draw adjudication in v2 (English draughts draws arise from repetition; timeout forfeit covers stalling).

**Backgammon (full rules)**:
- 24-point board, 15 checkers each, standard starting position; movement by dice (doubles play 4×); blocked points; hitting blots (bar re-entry); bearing off only after all checkers home; must use both dice if possible, larger if only one playable (standard forced-use rules).
- Doubling cube: offered only by the player on roll... offered before rolling by the player whose turn it is to roll; 64 cap; take/pass/resign semantics as above; beaver/crawford excluded.
- Gammon/backgammon detection at bear-off completion.
- Turn state machine: `AwaitOpening, AwaitRoll(player), AwaitMove(player, dice, remaining), CubeDecision(player), Terminal(...)`.

## Client

- Routes: `/` (lobby: open games by type, create-game dialogs per game), `/tic-tac-toe/{address}`, `/checkers/{address}`, `/backgammon/{address}`. Route params carry the game object address; state read via view functions; live-ish updates by polling with the existing TTL cache + event lookups.
- Shared: wallet provider (existing adapter), stake/join/cancel/settle components, move-submission wrapper enforcing no-simulation for randomness txns, timeout-forfeit button, activity feed from `hub` events.
- Per-game boards as focused components with local rules preview for legal-move hints (UX only — chain is authoritative).
- Network: `NETWORK` env-driven (`VITE_NETWORK`), default testnet; module address from env. Devnet stays usable for local contract tests.
- Keep: TanStack Start structure, existing UI primitives, tests + ssr smoke.

## Testing & audit

- Move: `#[test]` + `#[test_only]` per module; property/exhaustive tests: tic-tac-toe winner over all reachable boards; checkers geometry table + mandatory-capture + multi-jump chains; backgammon: forced-dice-use invariants, bear-off legality, cube state machine transitions; wager: full state-transition matrix incl. every timeout/refund path and I1–I4.
- Client: vitest for libs/components as today; aikido SAST scan on client (and no secrets).
- Phase 4 e2e on testnet: two wallets create/join/play/settle each game incl. a forfeit and a cube cycle; verify pot math on explorer.

## Deployment

- Dedicated testnet account (user-controlled key, funded via faucet). `arcade = "0x…"` named at publish; client env updated with module address.
- CI: build + move tests + client tests + typecheck; publish stays manual (deliberate).
- Client network config (`VITE_NETWORK`) targets testnet once phase 1 ships; local contract development keeps using devnet via CLI.

## Phases

| Phase | Deliverable | Acceptance |
|---|---|---|
| 0 | `arcade` package scaffold: `wager` + `hub` + object model, exhaustive wager tests; client arcade shell on testnet | wager tests green; shell renders lobby from hub on testnet |
| 1 | tic_tac_toe_v2 + client game page migration | full game playable for APT on testnet; old flow removed |
| 2 | checkers_v2 + UI | rules tests green incl. chains; playable |
| 3 | backgammon + UI | dice via randomness on testnet; cube + settle playable |
| 4 | audit pass + hardening + deploy + e2e | findings fixed; e2e checklist green; site live on testnet config |

## Risks / open items

- Randomness txns in wallets: if a wallet simulates and rejects, fallback = allow `roll` results derived from `randomness` only; keep dice-roll txns small so users accept the no-simulate prompt. Verified on testnet in phase 3 spike (moved early into phase 0 as a one-hour spike).
- FA store on object + `friend` settlement is a well-trodden pattern, but phase 0 includes a testnet publish spike to de-risk publish flow before writing game modules.
- 3-day timeout chosen to avoid griefing while allowing vacation pauses; configurable only at package level (constant).
