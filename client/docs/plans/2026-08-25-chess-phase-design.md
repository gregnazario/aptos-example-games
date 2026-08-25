# Chess phase — Design

Date: 2026-08-25
Status: Approved (brainstorm 2026-08-25; approach A — full on-chain validation)
Scope: fourth wagered game (`arcade::chess`), built as the program's next phase immediately after PR #17 merges

## Goals

1. Full-rules wagered chess playable end-to-end: piece movement, castling, en passant, player-chosen promotion, check/checkmate/stalemate detection, insufficient-material and fifty-move auto-draws.
2. Same fund-safety architecture as phase 0: APT moves only through `wager`'s `public(friend)` settlement paths; chess never touches coins directly.
3. Chain-authoritative legality: clients render boards and move hints from view functions backed by the exact validator the transaction runs. No second rules engine lives in TypeScript.
4. Deployment policy pivots from immutable to the default `compatible` upgrade policy (decision recorded below).

## Non-goals

- Threefold repetition (the classic stalling vector is already punished by the 3-day timeout forfeit — same trade-off as checkers v2's "no draw adjudication").
- Chess clocks / time controls, Elo or profiles, PGN export, spectator chat.
- Changes to `wager` escrow semantics; chess consumes the existing surface.
- Mainnet deployment this round.

## Decisions locked in brainstorm (2026-08-25)

| Question | Decision |
|---|---|
| Where does legality live? | Fully on-chain; client hints come from chain views (approach A) |
| Draw rules | Stalemate + insufficient material + fifty-move, all automatic; repetition excluded |
| Promotion | Player picks Q/R/B/N in the move transaction |
| Colors | Randomness coin flip at join assigns white/black |
| Build order | Chess next (phase 1); tic-tac-toe v2, checkers, backgammon follow in the existing order |

## Deployment-policy pivot (2026-08-24 design superseded)

The 2026-08-24 program design assumed an immutable publish, which forced upfront friend/kind reservations ("chess must be reserved before publish or never"). Per Greg's 2026-08-25 decision the package deploys under Aptos' default **`compatible`** upgrade policy instead:

- New modules can be added to the published package; existing modules can gain friend declarations and new functions, as long as struct layouts and public/entry signatures stay intact. Verified against the Move book's compatibility rules.
- The policy ratchets one way (`compatible` → `immutable`, never back), so the original guarantee can be restored before any mainnet deployment once the code is audited and stable.
- Accepted trust trade-off: between publishes, the deployer key can change money-path code. Mitigations: dedicated deployer account; document the assumption; strengthen to immutable pre-mainnet.
- Consequence for reservations: none needed going forward. The already-committed chinese_checkers reservation (kind 4) stays; its stub and friend line are harmless.
- Doc fallout (landed with PR #17): `wager.move` comment, `move/arcade/README.md` deploy section, amendment note on the 2026-08-24 design doc.

## Kind registration

Chess takes the next free kind: `KIND_CHESS: u8 = 5` (1–4 taken by tic-tac-toe, checkers, backgammon, chinese_checkers). This phase adds to `wager`: the constant, one whitelist disjunct in `create_game`, and `friend arcade::chess;`. Safe under `compatible` even post-publish, but lands together with the module here since nothing is published yet.

## Move module `arcade::chess`

### State resource (on the game object, alongside `wager::Game`)

```
board: vector<u8>        // always 64 cells; index 0 = a8 … 7 = h8 … 56 = a1 … 63 = h1 (FEN order)
                         // 0 empty; white P,N,B,R,Q,K = 1..6; black P,N,B,R,Q,K = 9..14
side_to_move: u8         // 0 white, 1 black
castling: u8             // bits: 0 WK, 1 WQ, 2 BK, 3 BQ
ep_square: u8            // en-passant target square; 255 = none
halfmove_clock: u16      // reset on pawn move or capture; drives the fifty-move rule
creator_is_white: bool   // decided by the join-time coin flip; combined with wager::players()
                         // this maps addresses to colors (player_a is white iff creator_is_white)
outcome: u8              // 0 ongoing, 1 white mated (white won), 2 black mated (black won),
                         // 3 stalemate, 4 insufficient material, 5 fifty-move, 6 resigned,
                         // 7 forfeited
events: EventHandle<ChessEvent>
```

`ChessEvent { game: address, action: u8, actor: address, from: u8, to: u8, promo: u8, reason: u8 }` with actions `MOVED=1, GAME_OVER=2, RESIGNED=3, FORFEIT_CLAIMED=4`; `reason` mirrors the outcome codes on `GAME_OVER`. One event handle, action-tagged, created from the ConstructorRef in `create`.

### Entry points

- `create(creator, stake, metadata)` — wraps `wager::create_game(KIND_CHESS, …)`, attaches the standard start position (white to move, full castling rights, no ep, clock 0, `creator_is_white = true` as a placeholder until join).
- `join(player, game_addr)` — wraps `wager::join_core`, then draws `randomness::u8_range(2)` to set `creator_is_white`. **Join becomes a randomness-bearing transaction** (must be submitted with simulation disabled; same pattern planned for tic-tac-toe v2 and backgammon rolls).
- `move_piece(player, game_addr, from, to, promo)` — the validated move; see pipeline below. `promo` is 0 except on a promoting push, where it is the piece-type code (N=2, B=3, R=4, Q=5).
- `resign(player, game_addr)` — either player, in-progress only; settles the pot to the opponent.
- `claim_forfeit(caller, game_addr)` — turn-aware timeout: requires the wager timeout elapsed, caller is a player, and caller is **not** the side to move (only the non-mover can be stalled against). Pays the whole pot to the claimant via `wager::settle`.

Authorization uses existing truths rather than duplicated state: `wager::players()` for membership, `wager::phase()` for in-progress, `wager::last_move_at()` / `timeout_seconds()` for the forfeit window. `creator_is_white` plus those two addresses is the entire color mapping.

### Validation pipeline (`move_piece`)

1. Asserts: phase in-progress, caller is the side to move, `board[from]` holds the caller's piece.
2. Geometry per piece by row/col coordinates (never raw index arithmetic — the checkers v1 lesson): pawn pushes/doubles/captures/en passant/promotion boundary; knight offsets with edge checks; ray scans with obstruction for bishop/rook/queen; king steps; castling detected as a two-column king move and gated on rights bit, empty path, king not currently in check, and crossed squares not attacked.
3. Scratch-copy apply (including ep capture removal, castling rook shift, promotion placement) and reject unless the mover's own king is unattacked on the copy (`is_attacked` covers pawn diagonals, knight offsets, king adjacency, and sliding rays).
4. Commit: write the board, update castling bits (king moved; rook moved; rook captured on its corner), set `ep_square` only on a double push (else clear), reset `halfmove_clock` on pawn move/capture (else increment), flip `side_to_move`.
5. Terminal evaluation for the new side to move, in strict precedence: no fully legal reply → **checkmate** (mover wins) if in check, else **stalemate**; else insufficient-material census → draw (rule: no pawns/rooks/queens and at most one minor piece total on the board — covers K v K and K+minor v K, correctly leaves K+N+N playable); else `halfmove_clock >= 100` → **fifty-move draw**. Mate beats the clock because it is evaluated first.
6. `wager::touch`, emit `MOVED`, and on termination emit `GAME_OVER` and settle: mate → `wager::settle(game, mover)`; stalemate / insufficient / fifty-move → `wager::settle_draw(game)`.

Settlement paths summary:

| Termination | Settlement | Outcome code |
|---|---|---|
| Checkmate | `settle(mover)` | 1 / 2 |
| Stalemate, insufficient material, fifty-move | `settle_draw` | 3 / 4 / 5 |
| Resignation | `settle(opponent)` | 6 |
| Turn-aware forfeit claim | `settle(claimant)` | 7 |
| Generic 3-day timeout (fallback) | `wager::forfeit_timeout` split refund | — |

The generic split-refund timeout remains reachable after the turn-aware window opens; whoever calls first post-timeout determines the outcome class. That race is deliberate — it gives the innocent party a strictly better path for acting promptly.

### Views

- `board(game_addr) -> vector<u8>` and `state(game_addr) -> (side_to_move, castling, ep_square, halfmove_clock, outcome, creator_is_white)`.
- `legal_moves(game_addr, from: Option<u8>) -> vector<u16>` — runs the identical validator; each move packs as `from(6 bits) << 10 | to(6 bits) << 4 | promo_type(4 bits)`. Worst-case legal-move counts (<~120) make output size a non-issue.

### Error codes

`E_EMPTY_SOURCE, E_WRONG_PIECE_OWNER, E_INVALID_MOVE, E_PROMO_REQUIRED, E_PROMO_FORBIDDEN, E_BAD_PROMO_PIECE, E_NOT_A_PLAYER, E_NOT_YOUR_TURN, E_TIMEOUT_NOT_REACHED, E_CLAIM_OWN_TURN` — numbered sequentially from 1.

## Testing

Audit-grade per the program standard; expect roughly 40–60 tests:

- Geometry tables per piece; pawn battery (push, double from start rank, blocked, diagonal capture, promotion boundary).
- Castling matrix: four rights × empty-path / not-in-check / no-through-check variants; rights lost on king move, rook move, and rook capture on its corner.
- En passant: setup, expiry after one move, and the notorious e.p.-exposes-king pin case.
- Absolute pins (including knights) blocking otherwise-legal geometry.
- Checkmate suites (fool's mate, scholar's mate, back-rank), classic stalemate position.
- Insufficient-material boundaries (K v K, K+B v K, K+N v K draw; K+N+N stays ongoing).
- Fifty-move edges: clock 99 continues, 100 draws, delivering mate on the 100th halfmove still wins.
- Promotion: underpromotion to knight allowed (incl. a mate), promo required exactly on last rank, rejected elsewhere, bad piece rejected.
- Coin-flip determinism via test-only randomness seeding: both flip outcomes, correct color→address mapping, wrong-turn move aborted.
- Wager integration matrix: escrow math on create/join, win pays the whole pot, every draw refunds both, resign pays the opponent, turn-aware forfeit pays the claimant with the single-outcome-event invariant pinned by count delta (same technique as the existing forfeit test), generic timeout fallback still available, illegal-move aborts carry the right codes.
- CI keeps running both `aptos move compile` and `aptos move test` (known gotcha: test-only imports can hide non-test compile breaks).

## Client

- `arcade.ts`: `GameKind.Chess = 5`; lobby row and label alongside the existing four.
- Route `/chess/$address` (`routes/chess.$address.tsx`) with a board component driven entirely by chain views: render `board()`; click a piece → fetch `legal_moves(game, from)` → highlight targets → click destination → promotion-picker dialog when the chosen move carries a promo → sign `move_piece`. Polling refresh via the existing TTL cache.
- Controls mirror the planned arcade game page: join (through the **no-simulation wrapper**, since join is randomness-bearing), cancel while open, resign, contextual timeout button (turn-aware claim when eligible, generic refund otherwise), settlement banner showing the outcome.
- `HowToPlay` chess variant.
- Vitest coverage for the new lib additions and components; SSR smoke stays green.

## Program order

Phase 0 (PR #17) → **Phase 1: chess** → Phase 2: tic-tac-toe v2 → Phase 3: checkers v2 → Phase 4: backgammon → chinese_checkers (reserved slot, scheduling open) → Phase 5: audit + deploy. Each phase still ends deployed-and-playable.

## Risks / open items

- Randomness-bearing join transactions and wallet simulation: mitigated by the no-simulation wrapper; the phase 0 spike pattern applies.
- Gas: worst-case validation is bounded 64-cell scans plus a few hundred scratch-applies for terminal detection — far under limits; no recursion.
- Review bots will flag the large test file; expected and acceptable.
- Exact `randomness` API signature (`u8_range`) verified against the pinned framework rev during planning.
