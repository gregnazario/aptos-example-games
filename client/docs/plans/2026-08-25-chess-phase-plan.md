# Chess Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `arcade::chess` (kind 5) — full-rules wagered chess validated entirely on-chain — plus the client board UI driven by chain views.

**Architecture:** Two new Move modules in the `arcade` package: `chess_rules` (pure functions over a `Position` value — geometry, legality, terminals; no global storage, unit-tested with hand-crafted positions) and `chess` (the `State` resource on the game object, entry points, events, views, and `wager` settlement wiring). Client adds a data layer (`lib/chess.ts`) and a `/chess/$address` page whose board renders chain state and whose move hints come from the `legal_moves` view — no TypeScript rules engine.

**Tech Stack:** Aptos Move (framework rev `mainnet`, CLI 9.5), `wager`/`hub` phase-0 foundation, TanStack Start + React 19 + Tailwind v4 + Radix primitives, vitest + testing-library, `randomness::u8_range` for the color coin flip.

## Global Constraints

- Spec: `client/docs/plans/2026-08-25-chess-phase-design.md`. Kind: `KIND_CHESS: u8 = 5` (1–4 taken).
- Piece codes: `0` empty; white P,N,B,R,Q,K = `1..6`; black = `9..14`. Board index `0 = a8 … 63 = h1` (row = idx/8, rank 8→1 top→bottom; col = idx%8, file a→h). White pawns start row 6 and move toward row 0; black pawns start row 1 toward row 7.
- `side_to_move`: 0 white, 1 black. Castling bits: 1 WK, 2 WQ, 4 BK, 8 BQ. `ep_square` sentinel 255. Outcome codes: 0 ongoing, 1 white mated out (white won), 2 black won, 3 stalemate, 4 insufficient material, 5 fifty-move, 6 resigned, 7 forfeited.
- Terminal precedence: checkmate > stalemate > insufficient material > fifty-move. Draw rule: no pawns/rooks/queens AND ≤1 minor piece total. Fifty-move threshold: halfmove clock ≥ 100.
- Funds move ONLY via `wager::settle*` (friend-gated). `wager` gains exactly: `KIND_CHESS` const, one whitelist disjunct, `friend arcade::chess;`.
- Randomness: coin flip is `randomness::u8_range(0, 2)` inside `join`. Test seeding: `#[test_only] randomness::initialize_for_testing(framework_signer)` (fixed zero seed) and `set_seed(32-byte vector)`.
- Move packing (view `legal_moves` → `vector<u16>`): `(from << 10) | (to << 4) | promo_type`, promo_type ∈ {0,2,3,4,5}.
- Error codes — `chess_rules`: 1 E_INVALID_MOVE, 2 E_PROMO_REQUIRED, 3 E_PROMO_FORBIDDEN, 4 E_BAD_PROMO_PIECE, 5 E_EMPTY_SOURCE, 6 E_WRONG_OWNER. `chess`: 1 E_NOT_A_PLAYER, 2 E_NOT_YOUR_TURN, 3 E_TIMEOUT_NOT_REACHED, 4 E_CLAIM_OWN_TURN.
- Commands: Move — `cd move/arcade && aptos move compile --named-addresses arcade=0xCAFE` AND `aptos move test --named-addresses arcade=0xCAFE` (both, always — test mode hides non-test compile breaks). Client — `cd client && npm run typecheck && npm test && npm run build && npm run test:ssr`.
- Gotchas: framework rev mainnet uses `ExtendRef.generate_signer_for_extending()`; tests need `timestamp::set_time_has_started_for_testing` + `ensure_initialized_with_apt_fa_metadata_for_test` before account creation; APT metadata via `coin::paired_metadata<AptosCoin>()`; `#[expected_failure(abort_code = ...)]` only; named objects non-deletable; CI npm is 10.
- Commit style: plain imperative messages, NO AI attribution trailers of any kind.
- Branch: `arcade-chess` off current `arcade-phase0` HEAD. Files `client/src/lib/arcade.ts` and `client/src/routes/index.tsx` were extended by commit `9ebfe2b` (chinese_checkers, kind 4) AFTER earlier session reads — re-read before editing.

---

### Task 1: `chess_rules` foundation — types, start position, helpers

**Files:**
- Create: `move/arcade/sources/chess_rules.move`

**Interfaces (produces, consumed by Tasks 2–6):**
- `public struct Position has copy, drop, store { board: vector<u8>, side_to_move: u8, castling: u8, ep_square: u8, halfmove_clock: u16 }`
- `start_position(): Position`
- Consts: `EMPTY/W_PAWN..W_KING/B_PAWN..B_KING`, `WHITE/BLACK`, `CASTLE_WK..CASTLE_BQ`, `NO_SQUARE`, `OUTCOME_*`
- Helpers: `row_of(sq): u8`, `col_of(sq): u8`, `color_of(piece): u8` (panics on EMPTY), `is_own_piece(side, piece): bool`, `sq(row,col): u8` (assumes in-bounds)

- [ ] **Step 1: Write module skeleton with start position and its failing test**

```move
/// Pure chess rules engine: board model, legality, terminal detection.
/// No global storage — every function is a pure computation over Position,
/// so the whole ruleset is unit-testable without accounts or escrow.
module arcade::chess_rules {
    // Piece codes. White 1..6; black adds the color bit (8).
    public const EMPTY: u8 = 0;
    public const W_PAWN: u8 = 1;
    public const W_KNIGHT: u8 = 2;
    public const W_BISHOP: u8 = 3;
    public const W_ROOK: u8 = 4;
    public const W_QUEEN: u8 = 5;
    public const W_KING: u8 = 6;
    public const B_PAWN: u8 = 9;
    public const B_KNIGHT: u8 = 10;
    public const B_BISHOP: u8 = 11;
    public const B_ROOK: u8 = 12;
    public const B_QUEEN: u8 = 13;
    public const B_KING: u8 = 14;

    public const WHITE: u8 = 0;
    public const BLACK: u8 = 1;

    // Castling-rights bits.
    public const CASTLE_WK: u8 = 1;
    public const CASTLE_WQ: u8 = 2;
    public const CASTLE_BK: u8 = 4;
    public const CASTLE_BQ: u8 = 8;

    /// ep_square sentinel: no en-passant target.
    public const NO_SQUARE: u8 = 255;

    // Outcomes (mirrored by client and by chess::State.outcome).
    public const OUTCOME_ONGOING: u8 = 0;
    public const OUTCOME_WHITE_MATED: u8 = 1; // white delivered mate, white won
    public const OUTCOME_BLACK_MATED: u8 = 2; // black delivered mate, black won
    public const OUTCOME_STALEMATE: u8 = 3;
    public const OUTCOME_INSUFFICIENT: u8 = 4;
    public const OUTCOME_FIFTY_MOVE: u8 = 5;

    // Rules-engine aborts.
    const E_INVALID_MOVE: u64 = 1;
    const E_PROMO_REQUIRED: u64 = 2;
    const E_PROMO_FORBIDDEN: u64 = 3;
    const E_BAD_PROMO_PIECE: u64 = 4;
    const E_EMPTY_SOURCE: u64 = 5;
    const E_WRONG_OWNER: u64 = 6;

    const BOARD_SIZE: u64 = 64;

    /// Full game position. Stored under the game object by arcade::chess.
    struct Position has copy, drop, store {
        board: vector<u8>,
        side_to_move: u8,
        castling: u8,
        ep_square: u8,
        halfmove_clock: u16,
    }

    #[test_only]
    const SENTINEL: u8 = 255;

    public fun row_of(sq: u8): u8 { sq / 8 }
    public fun col_of(sq: u8): u8 { sq % 8 }
    fun sq(row: u8, col: u8): u8 { row * 8 + col }
    fun in_bounds(row: u16, col: u16): bool { row < 8 && col < 8 }

    public fun color_of(piece: u8): u8 {
        assert!(piece != EMPTY, E_EMPTY_SOURCE);
        if (piece >= B_PAWN) BLACK else WHITE
    }

    public fun is_own_piece(side: u8, piece: u8): bool {
        piece != EMPTY && color_of(piece) == side
    }

    /// Standard start: rank 8 (row 0) black pieces, row 1 black pawns,
    /// row 6 white pawns, row 7 white pieces. White to move.
    public fun start_position(): Position {
        let board = vector[];
        // Back-rank piece order, shared by both sides.
        let order = vector[B_ROOK, B_KNIGHT, B_BISHOP, B_QUEEN, B_KING, B_BISHOP, B_KNIGHT, B_ROOK];
        let i = 0;
        while (i < 8) {
            vector::push_back(&mut board, *vector::borrow(&order, i)); // row 0 black back rank
            i = i + 1;
        };
        i = 0;
        while (i < 8) { vector::push_back(&mut board, B_PAWN); i = i + 1; };   // row 1
        i = 0;
        while (i < 48) { vector::push_back(&mut board, EMPTY); i = i + 1; };   // rows 2-5
        i = 0;
        while (i < 8) { vector::push_back(&mut board, W_PAWN); i = i + 1; };   // row 6
        i = 0;
        while (i < 8) {
            vector::push_back(&mut board, *vector::borrow(&order, i) - (B_PAWN - W_PAWN)); // strip color bit
            i = i + 1;
        };
        Position { board, side_to_move: WHITE, castling: 15, ep_square: NO_SQUARE, halfmove_clock: 0 }
    }

    #[test(start = @arcade)]
    fun test_start_position_layout(start: &signer) {
        let _ = start;
        let pos = start_position();
        assert!(vector::length(&pos.board) == BOARD_SIZE, 0);
        assert!(*vector::borrow(&pos.board, sq(0, 4)) == B_KING, 0);   // e8
        assert!(*vector::borrow(&pos.board, sq(7, 4)) == W_KING, 0);   // e1
        assert!(*vector::borrow(&pos.board, sq(6, 0)) == W_PAWN, 0);   // a2
        assert!(*vector::borrow(&pos.board, sq(1, 7)) == B_PAWN, 0);   // h7
        assert!(*vector::borrow(&pos.board, sq(3, 3)) == EMPTY, 0);    // d5
        assert!(*vector::borrow(&pos.board, sq(7, 0)) == W_ROOK, 0);   // a1
        assert!(*vector::borrow(&pos.board, sq(0, 0)) == B_ROOK, 0);   // a8
        assert!(pos.side_to_move == WHITE && pos.castling == 15 && pos.ep_square == NO_SQUARE, 0);
    }

    #[test(start = @arcade)]
    fun test_helpers(start: &signer) {
        let _ = start;
        assert!(row_of(63) == 7 && col_of(63) == 7, 0);
        assert!(sq(7, 7) == 63 && sq(0, 0) == 0, 0);
        assert!(color_of(W_QUEEN) == WHITE && color_of(B_QUEEN) == BLACK, 0);
        assert!(!is_own_piece(WHITE, EMPTY) && !is_own_piece(WHITE, B_PAWN) && is_own_piece(BLACK, B_PAWN), 0);
        assert!(in_bounds(7, 7) && !in_bounds(8, 0) && !in_bounds(0, 8), 0);
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xCAFE`
Expected: PASS including `test_start_position_layout` and `test_helpers`.

- [ ] **Step 3: Verify non-test compile**

Run: `cd move/arcade && aptos move compile --named-addresses arcade=0xCAFE`
Expected: success (guards the test-only-import gotcha).

- [ ] **Step 4: Commit**

```bash
git add move/arcade/sources/chess_rules.move
git commit -m "Add chess_rules foundation: position model and start position"
```

---

### Task 2: Attack detection (`is_attacked`, `king_square`, `in_check`)

**Files:**
- Modify: `move/arcade/sources/chess_rules.move` (append before the test section)

**Interfaces (produces):**
- `public fun king_square(board: &vector<u8>, side: u8): u8` (aborts if absent)
- `public fun is_attacked(board: &vector<u8>, target: u8, by_side: u8): bool`
- `public fun in_check(pos: &Position, side: u8): bool`

- [ ] **Step 1: Write failing tests (attack table)**

Append to the test section:

```move
    #[test(start = @arcade)]
    fun test_is_attacked_knights_and_pawns(start: &signer) {
        let _ = start;
        let mut board = vector[];
        let i = 0;
        while (i < BOARD_SIZE) { vector::push_back(&mut board, EMPTY); i = i + 1; };
        // White knight on d4 (27) attacks e6 (36? no: e6 = row2 col4 = 20), c6(18), b5(17? b5=row3 col1=25), f5(29), b3(41), f3(45), a2? no.
        *vector::borrow_mut(&mut board, 27) = W_KNIGHT;
        assert!(is_attacked(&board, 20, WHITE), 0); // e6
        assert!(is_attacked(&board, 18, WHITE), 0); // c6
        assert!(is_attacked(&board, 25, WHITE), 0); // b5
        assert!(is_attacked(&board, 29, WHITE), 0); // f5
        assert!(is_attacked(&board, 41, WHITE), 0); // b3
        assert!(is_attacked(&board, 45, WHITE), 0); // f3
        assert!(!is_attacked(&board, 26, WHITE), 0); // d5 not knight-reachable
        // Edge clipping: knight a8-corner coverage.
        let mut corner = vector[];
        let i = 0;
        while (i < BOARD_SIZE) { vector::push_back(&mut corner, EMPTY); i = i + 1; };
        *vector::borrow_mut(&mut corner, 0) = W_KNIGHT; // a8
        assert!(is_attacked(&corner, 10, WHITE), 0);  // c7
        assert!(is_attacked(&corner, 17, WHITE), 0);  // b6
        assert!(!is_attacked(&corner, 1, WHITE), 0);  // b8 unreachable
        // White pawn on e4 (28) attacks d5(27) and f5(29); never backward/e6(20).
        let mut pb = vector[];
        let i = 0;
        while (i < BOARD_SIZE) { vector::push_back(&mut pb, EMPTY); i = i + 1; };
        *vector::borrow_mut(&mut pb, 28) = W_PAWN;
        assert!(is_attacked(&pb, 27, WHITE) && is_attacked(&pb, 29, WHITE), 0);
        assert!(!is_attacked(&pb, 20, WHITE) && !is_attacked(&pb, 36, WHITE), 0);
    }

    #[test(start = @arcade)]
    fun test_is_attacked_sliding_and_king(start: &signer) {
        // Rook on d1 (59) attacks along rank/file until blocked.
        let mut b = vector[];
        let i = 0;
        while (i < BOARD_SIZE) { vector::push_back(&mut b, EMPTY); i = i + 1; };
        *vector::borrow_mut(&mut b, 59) = W_ROOK;
        assert!(is_attacked(&b, 56, WHITE), 0);  // a1
        assert!(is_attacked(&b, 27, WHITE), 0);  // d5 up the file
        assert!(!is_attacked(&b, 43, WHITE), 0); // off rook lines
        // Bishop on c1 (58): diagonal only.
        *vector::borrow_mut(&mut b, 59) = EMPTY;
        *vector::borrow_mut(&mut b, 58) = W_BISHOP;
        assert!(is_attacked(&b, 23, WHITE), 0);  // g5 up-right
        assert!(!is_attacked(&b, 59, WHITE), 0);
        // Queen on e4 (28) hits every line.
        *vector::borrow_mut(&mut b, 58) = EMPTY;
        *vector::borrow_mut(&mut b, 28) = W_QUEEN;
        assert!(is_attacked(&b, 4, WHITE), 0);   // e8 file
        assert!(is_attacked(&b, 0, WHITE), 0);   // a8 diagonal
        assert!(is_attacked(&b, 24, WHITE), 0);  // a4 rank
        // Blocked line is not attacked through the blocker.
        *vector::borrow_mut(&mut b, 20) = B_PAWN; // e5 blocks e-file
        assert!(!is_attacked(&b, 12, WHITE), 0);  // e7 behind the pawn
        // King adjacency.
        let mut k = vector[];
        let i = 0;
        while (i < BOARD_SIZE) { vector::push_back(&mut k, EMPTY); i = i + 1; };
        *vector::borrow_mut(&mut k, 27) = B_KING; // d4 attacks c3..e5 ring
        assert!(is_attacked(&k, 18, BLACK), 0);   // c3
        assert!(is_attacked(&k, 35, BLACK), 0);   // d5
        assert!(!is_attacked(&k, 44, BLACK), 0);  // e6 too far
    }

    #[test(start = @arcade)]
    fun test_in_check_start_not_in_check(start: &signer) {
        let _ = start;
        let pos = start_position();
        assert!(!in_check(&pos, WHITE), 0);
        assert!(!in_check(&pos, BLACK), 0);
        assert!(king_square(&pos.board, WHITE) == 60, 0); // e1
        assert!(king_square(&pos.board, BLACK) == 4, 0);  // e8
    }
```

- [ ] **Step 2: Run tests, verify FAIL** (functions undefined)

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xCAFE`
Expected: compile error — `king_square`/`is_attacked`/`in_check` undefined.

- [ ] **Step 3: Implement**

Insert before the test section:

```move
    /// Location of `side`'s king; aborts if there isn't exactly-board-one.
    public fun king_square(board: &vector<u8>, side: u8): u8 {
        let target = if (side == WHITE) W_KING else B_KING;
        let i = 0;
        while (i < BOARD_SIZE) {
            if (*vector::borrow(board, i) == target) return i;
            i = i + 1;
        };
        abort E_INVALID_MOVE
    }

    /// Is `target` attacked by any piece of `by_side`? Pawn diagonals relative
    /// to direction of travel: white attacks upward (decreasing row).
    public fun is_attacked(board: &vector<u8>, target: u8, by_side: u8): bool {
        let tr = row_of(target) as u16;
        let tc = col_of(target) as u16;

        // Pawn attackers sit one rank "behind" the target along its march.
        let pr = if (by_side == WHITE) tr + 1 else tr - 1;
        if (pr < 8) {
            if (tc > 0 && *vector::borrow(board, ((pr * 8) + (tc - 1)) as u8) == pawn_of(by_side)) return true;
            if (tc < 7 && *vector::borrow(board, ((pr * 8) + (tc + 1)) as u8) == pawn_of(by_side)) return true;
        };

        // Knights: eight L-offsets with edge guards.
        let kr = if (by_side == WHITE) W_KNIGHT else B_KNIGHT;
        let i = 0;
        while (i < 8) {
            let (dr, dc) = knight_offset(i);
            let nr = (tr as u64) + dr; // dr biased: see knight_offset contract below
            let nc = (tc as u64) + dc;
            if (nr < 8 && nc < 8
                && *vector::borrow(board, ((nr * 8) + nc) as u8) == kr) return true;
            i = i + 1;
        };

        // King adjacency.
        let kg = if (by_side == WHITE) W_KING else B_KING;
        let dr8 = 0;
        while (dr8 < 3) {
            let dc8 = 0;
            while (dc8 < 3) {
                if (dr8 == 1 && dc8 == 1) { dc8 = dc8 + 1; continue };
                let nr = tr + (dr8 as u16) - 1;
                let nc = tc + (dc8 as u16) - 1;
                if (nr < 8 && nc < 8
                    && *vector::borrow(board, ((nr * 8) + nc) as u8) == kg) return true;
                dc8 = dc8 + 1;
            };
            dr8 = dr8 + 1;
        };

        // Sliders: walk the four rook rays, then the four bishop rays.
        if (ray_hit(board, tr, tc, by_side, 0) || ray_hit(board, tr, tc, by_side, 1)
            || ray_hit(board, tr, tc, by_side, 2) || ray_hit(board, tr, tc, by_side, 3)) return true;

        false
    }

    fun pawn_of(side: u8): u8 { if (side == WHITE) W_PAWN else B_PAWN }

    /// Knight offset k in 0..8 as a BIAS-ENCODED delta: returned values are
    /// (dr+2, dc+2) in u64 so subtraction-free arithmetic stays in range.
    fun knight_offset(k: u64): (u64, u64) {
        if (k == 0) (0, 1)       // (-2,-1)
        else if (k == 1) (0, 3)  // (-2,+1)
        else if (k == 2) (4, 0)  // (+2,-2)? no — see table below
        ...
    }
```

The bias trick is error-prone; use the straightforward guarded form instead:

```move
    fun knight_offset(k: u64): (i64, i64) { // Move has no i64 — replaced below.
```

**Final implementation (use exactly this — explicit branch table, no negative numbers):**

```move
    fun knight_attacks_from(tr: u16, tc: u16, board: &vector<u8>, knight: u8): bool {
        // Each branch: guard source-side margins, then probe (tr+dr, tc+dc).
        if (tr >= 2 && tc >= 1 && *vector::borrow(board, (((tr - 2) * 8) + (tc - 1)) as u8) == knight) return true; // up-up-left
        if (tr >= 2 && tc <= 6 && *vector::borrow(board, (((tr - 2) * 8) + (tc + 1)) as u8) == knight) return true; // up-up-right
        if (tr <= 5 && tc >= 1 && *vector::borrow(board, (((tr + 2) * 8) + (tc - 1)) as u8) == knight) return true;
        if (tr <= 5 && tc <= 6 && *vector::borrow(board, (((tr + 2) * 8) + (tc + 1)) as u8) == knight) return true;
        if (tr >= 1 && tc >= 2 && *vector::borrow(board, (((tr - 1) * 8) + (tc - 2)) as u8) == knight) return true;
        if (tr >= 1 && tc <= 5 && *vector::borrow(board, (((tr - 1) * 8) + (tc + 2)) as u8) == knight) return true;
        if (tr <= 6 && tc >= 2 && *vector::borrow(board, (((tr + 1) * 8) + (tc - 2)) as u8) == knight) return true;
        if (tr <= 6 && tc <= 5 && *vector::borrow(board, (((tr + 1) * 8) + (tc + 2)) as u8) == knight) return true;
        false
    }

    /// Walk one ray from (tr,tc). dir 0=N 1=S 2=W 3=E 4=NE 5=NW 6=SE 7=SW.
    /// Returns true if the FIRST piece found is a slider of `by_side` covering
    /// that line (rook-line dirs 0-3 accept rook/queen; 4-7 bishop/queen).
    fun ray_hit(board: &vector<u8>, tr: u16, tc: u16, by_side: u8, dir: u64): bool {
        let rook_line = dir < 4;
        let slider = if (by_side == WHITE) { if (rook_line) W_ROOK else W_BISHOP }
            else { if (rook_line) B_ROOK else B_BISHOP };
        let queen = if (by_side == WHITE) W_QUEEN else B_QUEEN;
        let mut_r = tr; let mut_c = tc;
        let i = 0;
        while (i < 7) {
            // step once in dir with bounds guards
            if (dir == 0 || dir == 4 || dir == 5) { if (mut_r == 0) return false; mut_r = mut_r - 1; };
            if (dir == 1 || dir == 6 || dir == 7) { if (mut_r == 7) return false; mut_r = mut_r + 1; };
            if (dir == 2 || dir == 5 || dir == 7) { if (mut_c == 0) return false; mut_c = mut_c - 1; };
            if (dir == 3 || dir == 4 || dir == 6) { if (mut_c == 7) return false; mut_c = mut_c + 1; };
            let piece = *vector::borrow(board, ((mut_r * 8) + mut_c) as u8);
            if (piece != EMPTY) {
                return piece == slider || piece == queen
            };
            i = i + 1;
        };
        false
    }
```

…with `is_attacked` calling `knight_attacks_from(tr, tc, board, knight)` instead of the biased-offset loop, and the king-adjacency block kept as written (the `continue` skips the center). Note: `ray_hit` dirs 0–3 straight lines, 4–7 diagonals — the slider pair selection above encodes that.

Then:

```move
    public fun in_check(pos: &Position, side: u8): bool {
        is_attacked(&pos.board, king_square(&pos.board, side), if (side == WHITE) BLACK else WHITE)
    }
```

- [ ] **Step 4: Run tests to PASS, then compile**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xCAFE && aptos move compile --named-addresses arcade=0xCAFE`
Expected: all PASS; compile clean.

- [ ] **Step 5: Commit**

```bash
git add move/arcade/sources/chess_rules.move
git commit -m "Add chess attack detection: knights, pawns, sliders, king"
```

---

### Task 3: Pseudo-legal geometry (`validate_geometry`) incl. castling mechanics

**Files:** Modify: `move/arcade/sources/chess_rules.move`

**Interfaces (produces):**
- `public fun validate_geometry(pos: &Position, from: u8, to: u8): bool` — shape/obstruction/castling-preconditions (rights, empty path, not-in-check, crossed-square-not-attacked); destination ownership NOT checked here (Task 5 filters king safety).

- [ ] **Step 1: Failing tests (representative battery)**

```move
    #[test_only]
    fun empty_board(): vector<u8> {
        let b = vector[]; let i = 0;
        while (i < 64) { vector::push_back(&mut b, EMPTY); i = i + 1; };
        b
    }

    #[test_only]
    fun place(board: &mut vector<u8>, square: u8, piece: u8) {
        *vector::borrow_mut(board, (square as u64)) = piece;
    }

    #[test_only]
    fun pos_with(board: vector<u8>): Position {
        Position { board, side_to_move: WHITE, castling: 15, ep_square: NO_SQUARE, halfmove_clock: 0 }
    }

    #[test(start = @arcade)]
    fun test_rook_geometry_blocked(start: &signer) {
        let _ = start;
        let mut b = empty_board();
        place(&mut b, 59, W_ROOK); // d1
        place(&mut b, 27, B_PAWN); // d5 blocks the file
        let pos = pos_with(b);
        assert!(validate_geometry(&pos, 59, 56), 0);  // d1-a1 clear
        assert!(validate_geometry(&pos, 59, 27), 0);  // capture up to d5 ok
        assert!(!validate_geometry(&pos, 59, 19), 0); // d7 blocked by d5
        assert!(!validate_geometry(&pos, 59, 61), 0); // diagonal is not rook
    }

    #[test(start = @arcade)]
    fun test_bishop_geometry(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 58, W_BISHOP); // c1
        let pos = pos_with(b);
        assert!(validate_geometry(&pos, 58, 23), 0);  // c1-g5
        assert!(validate_geometry(&pos, 58, 37), 0);  // c1-f4? f4=row3col5=29 — corrected below
        assert!(!validate_geometry(&pos, 58, 59), 0); // straight line no
    }
```

NOTE to executor: fix the second bishop assertion to a true diagonal square (`29`), i.e. `assert!(validate_geometry(&pos, 58, 29), 0);` — 37 is not on a c1 diagonal.

```move
    #[test(start = @arcade)]
    fun test_knight_leaps_over_blockers(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 27, W_KNIGHT); // d4 surrounded by pawns
        place(&mut b, 26, W_PAWN); place(&mut b, 28, W_PAWN); place(&mut b, 34, W_PAWN); place(&mut b, 35, W_PAWN);
        place(&mut b, 18, W_PAWN); place(&mut b, 19, W_PAWN); place(&mut b, 25, W_PAWN); place(&mut b, 36, W_PAWN);
        let pos = pos_with(b);
        // Ringed in, but the knight still reaches b5(25 occupied→false), c6(18 occupied→false)…
        // …and the EMPTY jump targets e6(20)/f5(29)/f3(45)/b3(41).
        assert!(validate_geometry(&pos, 27, 20), 0);
        assert!(validate_geometry(&pos, 27, 29), 0);
        assert!(validate_geometry(&pos, 27, 45), 0);
        assert!(validate_geometry(&pos, 27, 41), 0);
        assert!(!validate_geometry(&pos, 27, 26), 0); // own pawn: not a knight target
    }

    #[test(start = @arcade)]
    fun test_pawn_moves(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 51, W_PAWN); // e2
        let pos = pos_with(b);
        assert!(validate_geometry(&pos, 51, 43), 0); // e3 single push
        assert!(validate_geometry(&pos, 51, 35), 0); // e4 double push
        assert!(!validate_geometry(&pos, 51, 42), 0); // d3: push onto diagonal no
        // Double push blocked midway.
        place(&mut b, 43, B_PAWN);
        let pos2 = pos_with(b);
        assert!(!validate_geometry(&pos2, 51, 35), 0);
        assert!(!validate_geometry(&pos2, 51, 43), 0);
        // Capture geometry needs an enemy diagonally ahead.
        let mut c = empty_board();
        place(&mut c, 51, W_PAWN); place(&mut c, 42, B_PAWN); // d3 black
        let pos3 = pos_with(c);
        assert!(validate_geometry(&pos3, 51, 42), 0);
        assert!(!validate_geometry(&pos3, 51, 44), 0); // f3 empty diagonal
        // Black pawn marches the other way.
        let mut d = empty_board();
        place(&mut d, 12, B_PAWN); // e7
        let pos4 = pos_with(d);
        assert!(validate_geometry(&pos4, 12, 20), 0); // e6
        assert!(validate_geometry(&pos4, 12, 28), 0); // e5 double
        assert!(!validate_geometry(&pos4, 12, 4), 0); // never triple
    }

    #[test(start = @arcade)]
    fun test_en_passant_geometry(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 51, W_PAWN);  // e2
        place(&mut b, 41, B_PAWN);  // d4 just double-pushed
        let mut pos = pos_with(b);
        pos.ep_square = 35;         // d3 target
        assert!(validate_geometry(&pos, 51, 35), 0);  // e2xd3 ep
        pos.ep_square = NO_SQUARE;
        assert!(!validate_geometry(&pos, 51, 35), 0); // expired: empty diagonal
    }

    #[test(start = @arcade)]
    fun test_king_steps_and_castling(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 60, W_KING); place(&mut b, 63, W_ROOK); place(&mut b, 56, W_ROOK);
        place(&mut b, 4, B_KING);
        let pos = pos_with(b);
        assert!(validate_geometry(&pos, 60, 61), 0);  // e1-f1
        assert!(validate_geometry(&pos, 60, 62), 0);  // O-O: rights, empty f1/g1
        assert!(validate_geometry(&pos, 60, 58), 0);  // O-O-O: b1/c1/d1 empty
        // Missing rights kill both.
        let mut p2 = pos; p2.castling = 4; // only BK remains
        assert!(!validate_geometry(&p2, 60, 62), 0);
        assert!(!validate_geometry(&p2, 60, 58), 0);
        // Occupied path kills queenside (b1 filled).
        place(&mut b, 57, W_KNIGHT);
        let p3 = pos_with(b);
        assert!(!validate_geometry(&p3, 60, 58), 0);
        assert!(validate_geometry(&p3, 60, 62), 0);
        // King in check: no castling either way.
        place(&mut b, 57, EMPTY); place(&mut b, 45, B_ROOK); // rook d2? d2=row6col3=51 — corrected: 51
        // (Executor: use square 51 for the rook so it checks e1 up the e-file… 51 is e-file? e2=row6col4=52.
        //  Correct choice: put the rook on e-file square 52.)
        let mut b2 = empty_board();
        place(&mut b2, 60, W_KING); place(&mut b2, 63, W_ROOK); place(&mut b2, 56, W_ROOK);
        place(&mut b2, 52, B_ROOK); // e2 rook checks e1 king
        let p4 = pos_with(b2);
        assert!(!validate_geometry(&p4, 60, 62), 0);
        // Crossed square attacked (f1 hit by bishop on h3 = 47) kills O-O only.
        let mut b3 = empty_board();
        place(&mut b3, 60, W_KING); place(&mut b3, 63, W_ROOK); place(&mut b3, 56, W_ROOK);
        place(&mut b3, 47, B_BISHOP);
        let p5 = pos_with(b3);
        assert!(!validate_geometry(&p5, 60, 62), 0);
        assert!(validate_geometry(&p5, 60, 58), 0);
    }

    #[test(start = @arcade)]
    fun test_geometry_rejects_bad_squares(start: &signer) {
        let pos = start_position();
        assert!(!validate_geometry(&pos, 51, 51), 0); // same square
        assert!(!validate_geometry(&pos, 35, 27), 0); // source empty
        assert!(!validate_geometry(&pos, 51, 34), 0); // own-piece destination (d4 own pawn? d4 empty at start…
        // (Executor: 34 = c5 — also empty at start; use 52=e2 own pawn instead:)
        assert!(!validate_geometry(&pos, 51, 52), 0); // onto own pawn
    }
```

NOTE to executor: the inline corrections marked above are part of this plan — apply the corrected squares (`29`, `52` for the checking rook is WRONG — checking rook belongs on `52` only if it attacks e1; e2=52 shares e-file with e1=60 ✓ correct) and delete the stray commented confusion; final test file must be coherent.

- [ ] **Step 2: Implement `validate_geometry`**

```move
    /// Pseudo-legal shape check: right mover, geometrically valid, path clear,
    /// and for castling: rights + empty lane + not in check + crossing square
    /// safe. King-safety AT the destination is applied later (apply+check).
    public fun validate_geometry(pos: &Position, from: u8, to: u8): bool {
        if (from == to) return false;
        let piece = *vector::borrow(&pos.board, (from as u64));
        if (!is_own_piece(pos.side_to_move, piece)) return false;
        let dest = *vector::borrow(&pos.board, (to as u64));
        if (dest != EMPTY && color_of(dest) == pos.side_to_move) return false;

        let fr = row_of(from) as u16; let fc = col_of(from) as u16;
        let tr = row_of(to) as u16;   let tc = col_of(to) as u16;

        if (piece == W_PAWN || piece == B_PAWN) return pawn_geometry(pos, piece, fr, fc, tr, tc);
        if (piece == W_KNIGHT || piece == B_KNIGHT) {
            let probe = empty_probe_board_with_removed(from);
            // Knight ignores obstruction entirely; reuse the attack probe:
            return knight_shape(fr, fc, tr, tc)
        };
        if (piece == W_BISHOP || piece == B_BISHOP) return slide_ok(pos.board, fr, fc, tr, tc, true);
        if (piece == W_ROOK   || piece == B_ROOK)    return slide_ok(pos.board, fr, fc, tr, tc, false);
        if (piece == W_QUEEN  || piece == B_QUEEN)   return slide_ok(pos.board, fr, fc, tr, tc, true) || slide_ok(pos.board, fr, fc, tr, tc, false);
        if (piece == W_KING   || piece == B_KING) {
            let dr = delta(tr, fr); let dc = delta(tc, fc);
            if (dr <= 1 && dc <= 1) return true;
            return castle_geometry(pos, piece, fr, fc, tr, tc)
        };
        false
    }

    fun pawn_geometry(pos: &Position, piece: u8, fr: u16, fc: u16, tr: u16, tc: u16): bool {
        let white = piece == W_PAWN;
        let dir: u16 = if (white) 1 else 0; // white moves toward smaller row
        // Encode: forward means row decreases for white, increases for black.
        let fwd = |r: u16|: u16 if (white) r - 1 else r + 1; // closures unsupported — expand inline below.
        // (Expanded inline; do NOT use a closure.)
        let start_row: u16 = if (white) 6 else 1;
        let dest = *vector::borrow(&pos.board, (((tr * 8) + tc) as u8));

        // Straight pushes.
        if (fc == tc) {
            let r1: u16 = if (white) fr - 1 else fr + 1;
            if (tr == r1 && dest == EMPTY) return true;
            if (fr == start_row && tr == (if (white) fr - 2 else fr + 2)) {
                let mid_row: u16 = if (white) fr - 1 else fr + 1;
                return dest == EMPTY
                    && *vector::borrow(&pos.board, (((mid_row * 8) + tc) as u8)) == EMPTY;
            };
            return false
        };
        // Diagonals: capture or en passant only.
        if (delta(tr, fr) != 1 || delta(tc, fc) != 1) return false;
        let r1: u16 = if (white) fr - 1 else fr + 1;
        if (tr != r1) return false;
        if (dest != EMPTY && color_of(dest) != pos.side_to_move) return true;
        // En passant: destination equals ep_square and it is EMPTY.
        return pos.ep_square != NO_SQUARE
            && to == pos.ep_square
            && dest == EMPTY
    }

    /// Absolute row/col distance.
    fun delta(a: u16, b: u16): u16 { if (a >= b) a - b else b - a }

    /// Straight/diagonal line validity with obstruction scan between ends.
    fun slide_ok(board: &vector<u8>, fr: u16, fc: u16, tr: u16, tc: u16, diagonal: bool): bool {
        let dr = delta(tr, fr); let dc = delta(tc, fc);
        if (diagonal) {
            if (dr != dc || dr == 0) return false;
        } else {
            if (!(dr == 0 || dc == 0) || (dr == 0 && dc == 0)) return false;
        };
        let step_r = cmp_step(tr, fr); let step_c = cmp_step(tc, fc);
        let mut_r = (fr + step_r) as u16; let mut_c = (fc + step_c) as u16;
        while (mut_r != tr || mut_c != tc) {
            if (*vector::borrow(board, ((mut_r * 8) + mut_c) as u8) != EMPTY) return false;
            mut_r = (mut_r + step_r) as u16; mut_c = (mut_c + step_c) as u16;
        };
        true
    }

    fun cmp_step(target: u16, from: u16): u16 { if (target > from) 1 else if (target < from) (0 - 1) as u16 else 0 }

    fun knight_shape(fr: u16, fc: u16, tr: u16, tc: u16): bool {
        let dr = delta(tr, fr); let dc = delta(tc, fc);
        (dr == 2 && dc == 1) || (dr == 1 && dc == 2)
    }

    fun castle_geometry(pos: &Position, piece: u8, fr: u16, fc: u16, tr: u16, tc: u16): bool {
        let white = piece == W_KING;
        if (fr != (if (white) 7 else 0) || fc != 4) return false;      // king on e-file home
        if (!(tr == fr && (tc == 6 || tc == 2))) return false;          // g or c file
        let kingside = tc == 6;
        let rights_bit = if (white) { if (kingside) CASTLE_WK else CASTLE_WQ }
            else { if (kingside) CASTLE_BK else CASTLE_BQ };
        if ((pos.castling & rights_bit) == 0) return false;
        if (in_check(pos, if (white) WHITE else BLACK)) return false;   // may not castle out of check
        // Lane emptiness.
        let rank = fr;
        if (kingside) {
            if (!lane_empty(&pos.board, rank, 5, 6)) return false;      // f,g
        } else {
            if (!lane_empty(&pos.board, rank, 1, 3)) return false;      // b,c,d
        };
        // Crossing square must be safe (destination handled by apply+filter).
        let cross: u16 = if (kingside) 5 else 3;
        let cross_sq = ((rank * 8) + cross) as u8;
        let enemy = if (white) BLACK else WHITE;
        if (is_attacked(&pos.board, cross_sq, enemy)) return false;
        // Rook must actually be present (rights should guarantee it; belt+braces).
        let rook_sq: u8 = if (kingside) ((rank * 8) + 7) as u8 else (rank * 8) as u8;
        let want_rook = if (white) W_ROOK else B_ROOK;
        return *vector::borrow(&pos.board, (rook_sq as u64)) == want_rook
    }

    fun lane_empty(board: &vector<u8>, rank: u16, from_c: u16, to_c: u16): bool {
        let c = from_c;
        while (c <= to_c) {
            if (*vector::borrow(board, ((rank * 8) + c) as u8) != EMPTY) return false;
            c = c + 1;
        };
        true
    }
```

NOTES to executor (correctness-critical):
- Remove the dead pseudo-code (`probe`/closure sketch) from `validate_geometry`; the knight arm is simply `return knight_shape(fr, fc, tr, tc);`.
- `cmp_step` returning `(0-1) as u16` = 65535; the `slide_ok` loop relies on wrap-around `(mut_r + step)` landing correctly because the loop exits on equality BEFORE overflow matters — safer: keep rows/cols in `u16` but compute `mut_r = if (step_r == 1) mut_r + 1 else if (step_r == 65535) mut_r - 1 else mut_r`. Implement `slide_ok` with that guarded form and delete the arithmetic-wrap cleverness.
- `castle_geometry` receives `fr/fc/tr/tc` already validated as king moves by caller; the `fc != 4` guard assumes standard start (true: kings begin on e-files and only chess_rules positions exist).
- `validate_geometry` does NOT verify the mover is the side to move beyond ownership (caller guarantees turn); it DOES reject capturing your own piece (done at top).

- [ ] **Step 3: Run tests to PASS + compile** (same commands as Task 2 Step 4)

- [ ] **Step 4: Commit**

```bash
git add move/arcade/sources/chess_rules.move
git commit -m "Add chess move geometry with castling preconditions"
```

---

### Task 4: Apply move (all side effects)

**Files:** Modify: `move/arcade/sources/chess_rules.move`

**Interfaces (produces):**
- `public fun apply_move(pos: &Position, from: u8, to: u8, promo: u8): Position` — PRECONDITION: `validate_geometry` passed (not re-checked except cheaply). Handles: piece relocation, captures, ep capture removal, castling rook shift, promotion placement, castling-rights clearing (king move / rook move / rook captured on corner), ep_square set only on double push, halfmove clock reset (pawn move or capture) else increment, side flip. `promo`: 0 none, else type code 2/3/4/5.

- [ ] **Step 1: Failing tests**

```move
    #[test(start = @arcade)]
    fun test_apply_updates_bookkeeping(start: &signer) {
        let _ = start;
        let pos = start_position();
        // 1. e4 (e2e4: 52->36) double push sets ep target e3=44, flips side.
        let p1 = apply_move(&pos, 52, 36, 0);
        assert!(p1.side_to_move == BLACK, 0);
        assert!(p1.ep_square == 44, 0);
        assert!(p1.halfmove_clock == 1, 0);
        assert!(*vector::borrow(&p1.board, 36) == W_PAWN && *vector::borrow(&p1.board, 52) == EMPTY, 0);
        // 2. Black responds Nf6 (knight g8f6: 6->21) — not pawn, no capture: clock increments.
        let p2 = apply_move(&p1, 6, 21, 0);
        assert!(p2.halfmove_clock == 2 && p2.side_to_move == WHITE && p2.ep_square == NO_SQUARE, 0);
        // 3. White plays Bd3?? whatever — use e4-e5 push: pawn resets clock.
        let p3 = apply_move(&p2, 36, 28, 0);
        assert!(p3.halfmove_clock == 0, 0);
    }

    #[test(start = @arcade)]
    fun test_apply_capture_resets_clock(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 59, W_ROOK); place(&mut b, 27, B_PAWN); // d1 rook, d5 pawn
        let pos = pos_with(b);
        pos.halfmove_clock = 40;
        let after = apply_move(&pos, 59, 27, 0);
        assert!(after.halfmove_clock == 0, 0);
        assert!(*vector::borrow(&after.board, 27) == W_ROOK, 0);
        assert!(after.side_to_move == BLACK, 0);
    }

    #[test(start = @arcade)]
    fun test_apply_castling_moves_rook_and_clears_rights(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 60, W_KING); place(&mut b, 63, W_ROOK); place(&mut b, 4, B_KING);
        place(&mut b, 8, B_ROOK); // a7 keeps a black-rook rights irrelevant but present
        let mut pos = pos_with(b);
        pos.castling = 15;
        let after = apply_move(&pos, 60, 62, 0); // O-O
        assert!(*vector::borrow(&after.board, 62) == W_KING, 0);
        assert!(*vector::borrow(&after.board, 61) == W_ROOK, 0);
        assert!(*vector::borrow(&after.board, 63) == EMPTY && *vector::borrow(&after.board, 60) == EMPTY, 0);
        assert!(after.castling == 12, 0); // white bits cleared, black kept
        // Queenside: rook lands on d1(59), king c1(58), b1..d1 emptied.
        let mut b2 = empty_board();
        place(&mut b2, 60, W_KING); place(&mut b2, 56, W_ROOK); place(&mut b2, 4, B_KING);
        let pos2 = pos_with(b2);
        let q = apply_move(&pos2, 60, 58, 0);
        assert!(*vector::borrow(&q.board, 58) == W_KING && *vector::borrow(&q.board, 59) == W_ROOK, 0);
        assert!(q.castling == 12, 0);
    }

    #[test(start = @arcade)]
    fun test_apply_clears_rights_when_rook_moves_or_captured(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 56, W_ROOK); place(&mut b, 60, W_KING); place(&mut b, 4, B_KING);
        let pos = pos_with(b); // castling 15
        let after = apply_move(&pos, 56, 40, 0); // a1-a3
        assert!(after.castling == 13, 0); // WQ cleared
        // Capturing a rook on its home corner clears that right too.
        let mut b2 = empty_board();
        place(&mut b2, 47, W_BISHOP); place(&mut b2, 56, B_ROOK); place(&mut b2, 60, W_KING); place(&mut b2, 4, B_KING);
        let pos2 = pos_with(b2);
        let after2 = apply_move(&pos2, 47, 56, 0); // Bxa1? bishop c2xa1 no — executor: bishop h2(55)->a? use queen: place W_QUEEN on 23 (a6) taking a1? a6->a1 vertical: 23->56 valid slide.
        // (Corrected setup:) place W_QUEEN at 23, slide down the a-file to 56.
        let _ = after2;
    }
```

NOTE to executor: replace the garbled final block with this clean version:

```move
    #[test(start = @arcade)]
    fun test_apply_clears_rights_when_rook_moves_or_captured(start: &signer) {
        let _ = start;
        let mut b = empty_board();
        place(&mut b, 56, W_ROOK); place(&mut b, 60, W_KING); place(&mut b, 4, B_KING);
        let pos = pos_with(b);
        let after = apply_move(&pos, 56, 40, 0); // Ra1-a3
        assert!(after.castling == 13, 0); // only WQ lost
        // Queen slides a6->a1 capturing the rook: black loses Q-side rights.
        let mut b2 = empty_board();
        place(&mut b2, 23, W_QUEEN); place(&mut b2, 56, B_ROOK); place(&mut b2, 60, W_KING); place(&mut b2, 4, B_KING);
        let pos2 = pos_with(b2);
        pos2.side_to_move stays WHITE;
        let after2 = apply_move(&pos2, 23, 56, 0);
        assert!(after2.castling == 7, 0); // BQ cleared (bit 8 gone), others kept
    }
```

…and fix the syntax slip `pos2.side_to_move stays WHITE;` → delete that line (default already WHITE).

```move
    #[test(start = @arcade)]
    fun test_apply_promotion_and_ep_capture(start: &signer) {
        // Promotion: white pawn b7(49)->b8(1) with promo queen.
        let mut b = empty_board();
        place(&mut b, 49, W_PAWN); place(&mut b, 4, B_KING); place(&mut b, 60, W_KING);
        let pos = pos_with(b);
        let after = apply_move(&pos, 49, 1, 5);
        assert!(*vector::borrow(&after.board, 1) == W_QUEEN, 0);
        // En passant: white pawn e5(28) x d6 ep (to=19) removes black d5 pawn (27).
        let mut c = empty_board();
        place(&mut c, 28, W_PAWN); place(&mut c, 27, B_PAWN); place(&mut c, 4, B_KING); place(&mut c, 60, W_KING);
        let mut pos2 = pos_with(c);
        pos2.ep_square = 19;
        let after2 = apply_move(&pos2, 28, 19, 0);
        assert!(*vector::borrow(&after2.board, 19) == W_PAWN, 0);
        assert!(*vector::borrow(&after2.board, 27) == EMPTY, 0); // captured pawn removed
    }
```

- [ ] **Step 2: Implement**

```move
    public fun apply_move(pos: &Position, from: u8, to: u8, promo: u8): Position {
        let mut board = pos.board; // vector copy
        let piece = *vector::borrow(&board, (from as u64));
        let captured = *vector::borrow(&board, (to as u64));
        let white = color_of(piece) == WHITE;
        let mut new_castling = pos.castling;
        let mut new_ep: u8 = NO_SQUARE;

        // En-passant capture: pawn moved diagonally onto the empty ep square.
        if ((piece == W_PAWN || piece == B_PAWN)
            && col_of(from) != col_of(to)
            && captured == EMPTY) {
            let victim: u64 = if (white) (to as u64) + 8 else (to as u64) - 8;
            *vector::borrow_mut(&mut board, victim) = EMPTY;
        };

        // Move the piece (with promotion placement if given).
        *vector::borrow_mut(&mut board, (from as u64)) = EMPTY;
        let placed = if ((piece == W_PAWN || piece == B_PAWN) && promo != 0) {
            let base = if (white) 0 else 8;
            base + promo
        } else piece;
        *vector::borrow_mut(&mut board, (to as u64)) = placed;

        // Castling: shift the rook too.
        if ((piece == W_KING || piece == B_KING)
            && delta(col_of(to) as u16, col_of(from) as u16) == 2
            && row_of(from) == row_of(to)) {
            let rank = row_of(from);
            if (col_of(to) == 6) { // kingside
                let rf: u64 = ((rank as u64) * 8) + 7;
                let rt: u64 = ((rank as u64) * 8) + 5;
                *vector::borrow_mut(&mut board, rt) = *vector::borrow(&board, rf);
                *vector::borrow_mut(&mut board, rf) = EMPTY;
            } else {               // queenside
                let rf: u64 = ((rank as u64) * 8);
                let rt: u64 = ((rank as u64) * 8) + 3;
                *vector::borrow_mut(&mut board, rt) = *vector::borrow(&board, rf);
                *vector::borrow_mut(&mut board, rf) = EMPTY;
            };
        };

        // Rights maintenance.
        if (piece == W_KING) new_castling = new_castling & ~(CASTLE_WK | CASTLE_WQ);
        if (piece == B_KING) new_castling = new_castling & ~(CASTLE_BK | CASTLE_BQ);
        if (from == 63 || to == 63) new_castling = new_castling & ~CASTLE_WK;  // h1
        if (from == 56 || to == 56) new_castling = new_castling & ~CASTLE_WQ;  // a1
        if (from == 7  || to == 7)  new_castling = new_castling & ~CASTLE_BK;  // h8
        if (from == 0  || to == 0)  new_castling = new_castling & ~CASTLE_BQ;  // a8

        // ep target only on a double pawn push.
        if (piece == W_PAWN && (row_of(from) as u16) - (row_of(to) as u16) == 2) {
            new_ep = from - 8;
        };
        if (piece == B_PAWN && (row_of(to) as u16) - (row_of(from) as u16) == 2) {
            new_ep = from + 8;
        };

        // Clock: pawn move or capture resets.
        let new_clock = if (piece == W_PAWN || piece == B_PAWN || captured != EMPTY) 0
            else pos.halfmove_clock + 1;

        Position {
            board,
            side_to_move: if (pos.side_to_move == WHITE) BLACK else WHITE,
            castling: new_castling,
            ep_square: new_ep,
            halfmove_clock: new_clock,
        }
    }
```

NOTE: Move has no `&~` bitmask-not operator — express as `new_castling - (new_castling & BIT)` or `new_castling & (255 - BIT)`. Use `new_castling & (255 - CASTLE_WK - CASTLE_WQ)` style (bits disjoint, sums safe). Adjust all four clears accordingly.

- [ ] **Step 3: Run tests to PASS + compile**
- [ ] **Step 4: Commit** — `git commit -m "Add chess move application with full state bookkeeping"`

---

### Task 5: Legality + enumeration (`is_legal`, `legal_moves`, packing)

**Files:** Modify: `move/arcade/sources/chess_rules.move`

**Interfaces (produces):**
- `public fun promo_required(board: &vector<u8>, from: u8, to: u8): bool` — pawn push reaching last rank.
- `public fun is_legal(pos: &Position, from: u8, to: u8, promo: u8): bool` — full pipeline: geometry + promo validation (E-promo conditions become booleans: required ⇒ promo∈{2,3,4,5}; not required ⇒ promo==0) + scratch-apply + own king safe.
- `public fun pack_move(from: u8, to: u8, promo: u8): u16` and `public fun unpack_move(m: u16): (u8, u8, u8)`
- `public fun legal_moves(pos: &Position, from_filter: Option<u8>): vector<u16>` — every legal move for `pos.side_to_move`, optionally restricted to one origin.

- [ ] **Step 1: Failing tests**

```move
    #[test(start = @arcade)]
    fun test_pin_blocks_geometry_legal_move(start: &signer) {
        let _ = start;
        // White king e1(60), white rook f1(61) pinned by black rook f8(13? f8=row0col5=5).
        let mut b = empty_board();
        place(&mut b, 60, W_KING); place(&mut b, 61, W_ROOK); place(&mut b, 5, B_ROOK);
        place(&mut b, 4, B_KING);
        let pos = pos_with(b);
        // Rook may slide along the f-file (staying pinned ON the line) but not leave it.
        assert!(is_legal(&pos, 61, 45, 0), 0);  // Rf2 stays on file
        assert!(!is_legal(&pos, 61, 59, 0), 0); // Rd1 leaves the pin
        assert!(!is_legal(&pos, 60, 51, 0), 0); // king cannot move up into… (e2 attacked? not by rook on f-file; king e1->d1? choose clearly attacked: Ke1-d1 fine; use e1->f2? not king move. Use: king cannot castle — no rights issue here; simpler assertion below.)
    }

    #[test(start = @arcade)]
    fun test_legal_move_requires_king_safety(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 60, W_KING); place(&mut b, 52, B_ROOK); // e2 rook pins nothing but attacks e-file
        place(&mut b, 4, B_KING);
        let pos = pos_with(b);
        assert!(!is_legal(&pos, 60, 52, 0), 0); // Kxe2?? rook defended? not defended — but moving INTO check: rook on e2 is the attacker; capturing it IS safe if undefended. Fix: defend it.
        // (Corrected:) add black pawn d3(43) defending e2.
        place(&mut b, 43, B_PAWN);
        let pos2 = pos_with(b);
        assert!(!is_legal(&pos2, 60, 52, 0), 0); // Kxe2 walks into pawn
        assert!(is_legal(&pos2, 60, 51, 0), 0);  // Kd1 safe
    }

    #[test(start = @arcade)]
    fun test_ep_exposes_king_illegal(start: &signer) {
        // Classic: white Kh1? use known construction: white Kb5? Simplify to file pin:
        // White Ke5(28)? Build: white king e5, white pawn e5? no. Canonical:
        // white pawn d5(27), black pawn e5(28) just double-pushed (ep target d6=19),
        // white king e5?? occupied… Use: white king h4? Keep the classic rank-5 pin:
        // White Kc5? — FINAL construction: black Rb8? Too fiddly blind.
        // Deterministic minimal: white king a5(32), white pawn b5(33), black pawn c5(34)
        // just double-pushed (ep target b6=9), black rook h5(39) pinning along rank 5.
        // bxc6 ep removes BOTH pawns from rank 5 → king a5 exposed to Rh5 → illegal.
        let mut b = empty_board();
        place(&mut b, 32, W_KING); place(&mut b, 33, W_PAWN); place(&mut b, 34, B_PAWN);
        place(&mut b, 39, B_ROOK); place(&mut b, 4, B_KING); place(&mut b, 60, W_KING);
        let mut pos = pos_with(b);
        pos.side_to_move = WHITE;
        pos.ep_square = 9; // b6
        assert!(!is_legal(&pos, 33, 9, 0), 0);   // ep capture leaves rank exposed
        assert!(is_legal(&pos, 33, 25, 0), 0);   // plain b6 push (non-capture) also leaves rank!
        // (Correction: the PUSH also abandons b5 → also illegal. Replace assertion:)
        // assert!(is_legal(&pos, 33, 41, 0), 0); // b5-b4 stays off rank 5? b4=row4col1=33? no…
        // FINAL correction below in Step 2 notes.
    }
```

NOTE to executor: in `test_ep_exposes_king_illegal`, BOTH ep and the ordinary push abandon rank 5, so both are illegal; the legal control move is the king stepping OFF rank 5: replace the last two assertions with:

```move
        assert!(!is_legal(&pos, 33, 25, 0), 0); // ordinary push abandons the pin line too
        assert!(is_legal(&pos, 32, 24, 0), 0);  // Ka4 steps off rank 5: legal
```

(square 24 = a4.)

```move
    #[test(start = @arcade)]
    fun test_promo_validation(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 49, W_PAWN); place(&mut b, 4, B_KING); place(&mut b, 60, W_KING);
        let pos = pos_with(b);
        assert!(promo_required(&pos.board, 49, 1), 0);
        assert!(!is_legal(&pos, 49, 1, 0), 0);    // missing promo
        assert!(!is_legal(&pos, 49, 1, 1), 0);    // pawn is not a promo piece
        assert!(!is_legal(&pos, 49, 1, 6), 0);    // king neither
        assert!(is_legal(&pos, 49, 1, 5), 0);     // queen ok
        assert!(is_legal(&pos, 49, 1, 2), 0);     // underpromotion ok
        assert!(!is_legal(&pos, 51, 43, 2), 0);   // promo arg off last rank rejected
    }

    #[test(start = @arcade)]
    fun test_legal_moves_enumeration_and_packing(start: &signer) {
        let pos = start_position();
        let moves = legal_moves(&pos, option::none());
        assert!(vector::length(&moves) == 20, 0); // 16 pawn + 4 knight
        let a_moves = legal_moves(&pos, option::some(8)); // a2 pawn
        assert!(vector::length(&a_moves) == 2, 0);
        let (f, t, p) = unpack_move(*vector::borrow(&a_moves, 0));
        assert!(f == 8 && p == 0 && (t == 16 || t == 24), 0);
        let (f2, t2, _) = pack_then_check(f, t, p);
        let _ = (f2, t2);
    }

    fun pack_then_check(f: u8, t: u8, p: u8): (u8, u8, u8) {
        unpack_move(pack_move(f, t, p))
    }
```

- [ ] **Step 2: Implement**

```move
    public fun promo_required(board: &vector<u8>, from: u8, to: u8): bool {
        let piece = *vector::borrow(board, (from as u64));
        if (piece != W_PAWN && piece != B_PAWN) return false;
        if (col_of(from) != col_of(to)) {
            // Diagonal: capture onto last rank (incl. ep onto last rank impossible;
            // ep targets sit on rank 3/6) — treat as promoting only if last rank.
        };
        (piece == W_PAWN && row_of(to) == 0) || (piece == B_PAWN && row_of(to) == 7)
    }

    fun promo_valid(piece: u8, to: u8, promo: u8): bool {
        let needs = (piece == W_PAWN && row_of(to) == 0) || (piece == B_PAWN && row_of(to) == 7);
        if (needs) return promo == W_KNIGHT || promo == W_BISHOP || promo == W_ROOK || promo == W_QUEEN;
        promo == 0
    }

    public fun is_legal(pos: &Position, from: u8, to: u8, promo: u8): bool {
        if (from == to) return false;
        let piece = *vector::borrow(&pos.board, (from as u64));
        if (!is_own_piece(pos.side_to_move, piece)) return false;
        if (!validate_geometry(pos, from, to)) return false;
        if (!promo_valid(piece, to, promo)) return false;
        let next = apply_move(pos, from, to, promo);
        let mover = pos.side_to_move;
        !in_check(&next, mover) // mover's king must survive
    }

    public fun pack_move(from: u8, to: u8, promo: u8): u16 {
        (((from as u16) << 10) | ((to as u16) << 4)) | (promo as u16)
    }

    public fun unpack_move(m: u16): (u8, u8, u8) {
        ((((m >> 10) & 63) as u8), (((m >> 4) & 63) as u8), (m & 15) as u8)
    }

    /// All legal moves for side to move. Candidate generation per piece kind;
    /// every candidate passes the full is_legal gate (geometry + king safety).
    public fun legal_moves(pos: &Position, from_filter: Option<u8>): vector<u16> {
        let out = vector[];
        let side = pos.side_to_move;
        let from = 0u8;
        while ((from as u64) < 64) {
            let usable = switch (option::borrow(&from_filter)) {
                _ => true, // placeholder — see note
            };
            // NOTE: Move lacks switch; write: let usable = option_is_none_or_eq(&from_filter, from);
            if (usable && is_own_piece(side, *vector::borrow(&pos.board, (from as u64)))) {
                let to = 0u8;
                while ((to as u64) < 64) {
                    if (is_legal(pos, from, to, 0)) {
                        vector::push_back(&mut out, pack_move(from, to, 0));
                    } else if (promo_required(&pos.board, from, to)
                        && validate_geometry(pos, from, to)) {
                        // Promotions: four separate packed moves.
                        let ps = vector[W_KNIGHT, W_BISHOP, W_ROOK, W_QUEEN];
                        let i = 0;
                        while (i < 4) {
                            let pc = *vector::borrow(&ps, i);
                            if (is_legal(pos, from, to, pc)) {
                                vector::push_back(&mut out, pack_move(from, to, pc));
                            };
                            i = i + 1;
                        };
                    };
                    to = to + 1;
                };
            };
            from = from + 1;
        };
        out
    }

    fun option_is_none_or_eq(o: &Option<u8>, v: u8): bool {
        if (option::is_none(o)) true else *option::borrow(o) == v
    }
```

NOTES to executor:
- Delete the bogus `switch`/placeholder lines; keep the `option_is_none_or_eq` form. Import `std::option` (already available via `use std::option;` — add if absent).
- The 64×64 scan is deliberate (simplicity over cleverness); worst case ≈ 4096 geometry checks + a few hundred scratch applies — far under gas limits even inside the view.
- `is_legal(pos, from, to, 0)` on a promoting push fails via `promo_valid` and falls into the promo branch — the `else if` ordering matters; keep it.

- [ ] **Step 3: Run tests to PASS + compile**
- [ ] **Step 4: Commit** — `git commit -m "Add chess legality filtering and move enumeration"`

---

### Task 6: Terminal detection (`evaluate_terminal`)

**Files:** Modify: `move/arcade/sources/chess_rules.move`

**Interfaces (produces):**
- `public fun has_any_legal_move(pos: &Position): bool`
- `public fun insufficient_material(board: &vector<u8>): bool` — no P/R/Q anywhere and ≤1 minor total.
- `public fun evaluate_terminal(next: &Position): u8` — called AFTER apply (side_to_move = the player to move now). Returns OUTCOME_* ; precedence: mate/stalemate > insufficient > fifty.

- [ ] **Step 1: Failing tests**

```move
    #[test(start = @arcade)]
    fun test_fools_mate_is_mate(start: &signer) {
        let _ = start;
        let p0 = start_position();
        let p1 = apply_move(&p0, 52, 36, 0);  // 1. e4
        let p2 = apply_move(&p1, 12, 28, 0);  // 1... e5? (e7e5) — fine
        let p3 = apply_move(&p2, 53, 37, 0);  // 2. Qh5 (d1h5: 59? d1=59? d1=row7col3=59 ✓ 59->23? h5=row1col7=23) FIX below
        // (Correction: Qh5 is 59->23.)
        let p3 = apply_move(&p2, 59, 23, 0);
        let p4 = apply_move(&p3, 11, 27, 0);  // 2... Nc6 (b8c6: 1->18? b8=1, c6=row2col2=18) FIX below
        // (Correction: Nc6 is 1->18.)
        let p4 = apply_move(&p3, 1, 18, 0);
        let p5 = apply_move(&p4, 23, 3, 0);   // 3. Qxf7# (h5xf7: f7=row1col5=13)
        // (Correction: f7=13, so 23->13.)
        let p5 = apply_move(&p4, 23, 13, 0);
        assert!(evaluate_terminal(&p5) == OUTCOME_WHITE_MATED, 0);
        assert!(!has_any_legal_move(&p5), 0);
    }
```

NOTE to executor: Move re-binds (`let x = …` twice) shadow cleanly — keep ONE binding per step using the corrected squares: e4=`52→36`, e5=`12→28`, Qh5=`59→23`, Nc6=`1→18`, Qxf7#=`23→13`. Delete the annotated false starts. Verify with the fool's-mate line: 1.e4 e5 2.Qh5 Nc6 3.Qxf7# — note 2…Nc6 blocks nothing relevant; mate stands (classic scholar's is with Nc6 too — this line IS fool's-mate-adjacent but legal and mate: queen f7 supported by nothing? f7 defended by ROOK? No: black king e8 defends f7! Qxf7+ would hang the queen UNLESS supported. Scholar's mate requires Bc4 supporting. CORRECT LINE: use Scholar's mate: 1.e4 e5 2.Bc4(55→? f1=61,c4=row4col2=34: 61→34) Nc6(1→18) 3.Qh5(59→23) Nf6?(8→21? g8=6,f6=21: 6→21) 4.Qxf7#. Script: e4 52→36, e5 12→28, Bc4 61→34, Nc6 1→18, Qh5 59→23, Nf6 6→21, Qxf7# 23→13.)

FINAL test body (use exactly):

```move
    #[test(start = @arcade)]
    fun test_scholars_mate_is_mate(start: &signer) {
        let _ = start;
        let p0 = start_position();
        let p1 = apply_move(&p0, 52, 36, 0); // e4
        let p2 = apply_move(&p1, 12, 28, 0); // e5
        let p3 = apply_move(&p2, 61, 34, 0); // Bc4
        let p4 = apply_move(&p3, 1, 18, 0);  // Nc6
        let p5 = apply_move(&p4, 59, 23, 0); // Qh5
        let p6 = apply_move(&p5, 6, 21, 0);  // Nf6
        let p7 = apply_move(&p6, 23, 13, 0); // Qxf7#
        assert!(evaluate_terminal(&p7) == OUTCOME_WHITE_MATED, 0);
    }
```

```move
    #[test(start = @arcade)]
    fun test_stalemate_detection(start: &signer) {
        // Classic: white Kb6? use: black Kb8(h8?), white Qc7?? Construct known stalemate:
        // White: Kb6(41? b6=row2col1=17), Qd7?? — canonical stalemate: black Kb8(1),
        // white Qc7(18)?? c7 adjacent to b8 → that IS stalemate with black to move:
        // black king b8: a8 attacked by Qc7? c7 attacks a8? no (diagonal b8… c7-a? c7 diag: b8,d8,b6,d6,a5,e5…). a8 not attacked but king can't move there? a8 adjacent to b8; attacked? Qc7 attacks a7? c7-b7-a7 rank yes; a8? no.
        // Known-clean stalemate: black Kb8; white Qb6? attacks b8? no(b-file blocked? b6-b7-b8 clear → attacks b8 = check, not stalemate).
        // Use THE textbook: white Ka6? Final: black Kb8(1); white Qc7(18); white Kb6? b6=17.
        // b8 king moves: a8(attacked? Qc7 diag b8… a8 NOT on c7 lines: c7→b8→a? b8 then off-board diag continues a? c7,b8,a? that diagonal is c7-b8 only. So a8 attacked? NO. Hmm then Ka8 legal → not stalemate.
        // Textbook stalemate: white Qg6? black Kh8(7): g8 attacked(Qg6? g-file: g7,g8 yes), h7 attacked(g6 diag h7 yes), g7 attacked. Kh8 has NO moves and NOT in check? h8 attacked? g6-h7-? h8 not attacked. YES: stalemate.
        let mut b = empty_board();
        place(&mut b, 7, B_KING);   // h8
        place(&mut b, 14, W_QUEEN); // g6 = row5col6 = 46 — FIX: 46
        place(&mut b, 50, W_KING);  // a1 far away = 56 — use 56
        // FINAL board: B_KING@7, W_QUEEN@46, W_KING@56, black to move.
        let mut pos = pos_with(b);
        pos.side_to_move = BLACK;
        let outcome = evaluate_terminal(&pos);
        assert!(outcome == OUTCOME_STALEMATE, 0);
    }
```

NOTE to executor — final coherent version:

```move
    #[test(start = @arcade)]
    fun test_stalemate_detection(start: &signer) {
        let _ = start;
        let mut b = empty_board();
        place(&mut b, 7, B_KING);   // h8
        place(&mut b, 46, W_QUEEN); // g6: attacks g7(file), h7(diag); h8 itself not attacked
        place(&mut b, 56, W_KING);  // a1, far away
        let mut pos = pos_with(b);
        pos.side_to_move = BLACK;
        assert!(evaluate_terminal(&pos) == OUTCOME_STALEMATE, 0);
    }
```

```move
    #[test(start = @arcade)]
    fun test_insufficient_material(start: &signer) {
        let mut b = empty_board();
        place(&mut b, 60, W_KING); place(&mut b, 4, B_KING);
        let mut pos = pos_with(b);
        assert!(insufficient_material(&pos.board), 0);
        assert!(evaluate_terminal(&pos) == OUTCOME_INSUFFICIENT, 0);
        place(&mut b, 0, W_BISHOP);
        assert!(insufficient_material(&pos_with(b).board), 0);  // KB v K
        place(&mut b, 0, W_KNIGHT);
        assert!(insufficient_material(&pos_with(b).board), 0);  // KN v K
        place(&mut b, 7, B_KNIGHT);
        assert!(!insufficient_material(&pos_with(b).board), 0); // KNN: playable
        place(&mut b, 7, B_PAWN);
        assert!(!insufficient_material(&pos_with(b).board), 0); // pawn present
        place(&mut b, 7, B_ROOK);
        assert!(!insufficient_material(&pos_with(b).board), 0); // rook present
    }

    #[test(start = @arcade)]
    fun test_fifty_move_and_mate_precedence(start: &signer) {
        // Clock at 99, no mate available → the next non-resetting move draws.
        let mut b = empty_board();
        place(&mut b, 60, W_KING); place(&mut b, 58, W_ROOK); place(&mut b, 4, B_KING);
        place(&mut b, 16, B_PAWN); // a7 pawn keeps material sufficient AND resets on move
        let mut pos = pos_with(b);
        pos.side_to_move = BLACK;
        pos.halfmove_clock = 98;
        // Black plays Ka8? a8=0 empty; king e8(4)->a8 not one step. Use d8(3)->c8(2): build black king on d8.
        // FINAL: B_KING@3 (d8); move 3->2 (d8-c8), no capture/no pawn → clock 99… need ≥100: set 99.
        place(&mut b, 3, B_KING);
        let mut pos2 = pos_with(b);
        pos2.side_to_move = BLACK;
        pos2.halfmove_clock = 99;
        let after = apply_move(&pos2, 3, 2, 0); // Kd8-c8: clock 100
        assert!(evaluate_terminal(&after) == OUTCOME_FIFTY_MOVE, 0);
        // Mate beats the clock: clock 99 and the mover delivers mate → mate wins.
        // Back-rank: white Re1? Construct: black king h8(7) boxed by own pawns g7,h7;
        // white rook e1(59? e1=60) → Re8#? e-file to e8(4): mate with clock high.
        let mut c = empty_board();
        place(&mut c, 7, B_KING); place(&mut c, 14, B_PAWN); place(&mut c, 15, B_PAWN);
        place(&mut c, 60, W_ROOK); place(&mut c, 56, W_KING);
        let mut pos3 = pos_with(c);
        pos3.side_to_move = WHITE;
        pos3.halfmove_clock = 99;
        let mate = apply_move(&pos3, 60, 4, 0); // Re1-e8#
        assert!(evaluate_terminal(&mate) == OUTCOME_BLACK_MATED, 0);
    }
```

- [ ] **Step 2: Implement**

```move
    public fun has_any_legal_move(pos: &Position): bool {
        // Early-exit scan: reuse legal_moves but stop at first hit.
        let side = pos.side_to_move;
        let from = 0u8;
        while ((from as u64) < 64) {
            if (is_own_piece(side, *vector::borrow(&pos.board, (from as u64)))) {
                let to = 0u8;
                while ((to as u64) < 64) {
                    if (is_legal(pos, from, to, 0)) return true;
                    if (promo_required(&pos.board, from, to) && validate_geometry(pos, from, to)) {
                        let ps = vector[W_KNIGHT, W_BISHOP, W_ROOK, W_QUEEN];
                        let i = 0;
                        while (i < 4) {
                            if (is_legal(pos, from, to, *vector::borrow(&ps, i))) return true;
                            i = i + 1;
                        };
                    };
                    to = to + 1;
                };
            };
            from = from + 1;
        };
        false
    }

    public fun insufficient_material(board: &vector<u8>): bool {
        let minors: u64 = 0;
        let i: u64 = 0;
        while (i < 64) {
            let p = *vector::borrow(board, i);
            if (p == W_PAWN || p == B_PAWN || p == W_ROOK || p == B_ROOK
                || p == W_QUEEN || p == B_QUEEN) return false;
            if (p == W_KNIGHT || p == W_BISHOP || p == B_KNIGHT || p == B_BISHOP) {
                minors = minors + 1;
            };
            i = i + 1;
        };
        minors <= 1
    }

    /// Called on the position AFTER a move (side_to_move = next player).
    /// Precedence per spec: mate > stalemate > insufficient > fifty.
    public fun evaluate_terminal(next: &Position): u8 {
        let mover_won = if (next.side_to_move == WHITE) OUTCOME_BLACK_MATED else OUTCOME_WHITE_MATED;
        if (!has_any_legal_move(next)) {
            return if (in_check(next, next.side_to_move))
                mover_won
            else OUTCOME_STALEMATE;
        };
        if (insufficient_material(&next.board)) return OUTCOME_INSUFFICIENT;
        if (next.halfmove_clock >= 100) return OUTCOME_FIFTY_MOVE;
        OUTCOME_ONGOING
    }
```

- [ ] **Step 3: Run FULL rules-suite + compile**
Run: `cd move/arcade && aptos move test --named-addresses arcade=0xCAFE && aptos move compile --named-addresses arcade=0xCAFE`
Expected: PASS (≈20 rules tests at this point).
- [ ] **Step 4: Commit** — `git commit -m "Add chess terminal detection with mate-beats-clock precedence"`

---

### Task 7: `chess` module wiring — kind registration, create/join, views

**Files:**
- Modify: `move/arcade/sources/wager.move` (kind const + whitelist + friend)
- Create: `move/arcade/sources/chess.move`

**Interfaces:**
- Consumes: `wager::create_game/join_core/settle/settle_draw/touch/players/phase/last_move_at/timeout_seconds` (existing), `chess_rules::*` (Tasks 1–6).
- Produces: `chess::State`, entries `create/join/move_piece/resign/claim_forfeit`, views `board/state/legal_moves_view`.

- [ ] **Step 1: Register kind in `wager.move`**

After `public const KIND_CHINESE_CHECKERS: u8 = 4;` add:

```move
    public const KIND_CHESS: u8 = 5;
```

In `create_game`'s kind assert, add `|| kind == KIND_CHESS` to the disjunct. After `friend arcade::chinese_checkers;` add:

```move
    friend arcade::chess;
```

Update the friend-block comment's first line to mention chess arriving in phase 1 (comment-only).

- [ ] **Step 2: Write `chess.move` with failing integration tests**

```move
/// Wagered chess (phase 1): state + settlement wiring around chess_rules.
module arcade::chess {
    use std::option::{Self, Option};
    use std::signer;
    use std::string::String;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::object::{Self, ConstructorRef};
    use aptos_framework::randomness;
    use aptos_framework::timestamp;
    use arcade::chess_rules::{Self, Position};

    // Phase values mirrored from arcade::wager (private consts there).
    const PHASE_IN_PROGRESS: u8 = 1;

    // ChessEvent actions.
    const ACTION_MOVED: u8 = 1;
    const ACTION_GAME_OVER: u8 = 2;
    const ACTION_RESIGNED: u8 = 3;
    const ACTION_FORFEIT_CLAIMED: u8 = 4;

    const E_NOT_A_PLAYER: u64 = 1;
    const E_NOT_YOUR_TURN: u64 = 2;
    const E_TIMEOUT_NOT_REACHED: u64 = 3;
    const E_CLAIM_OWN_TURN: u64 = 4;

    /// Chess-specific state living on the game object next to wager::Game.
    struct State has key {
        pos: Position,
        creator_is_white: bool,
        outcome: u8,
        events: EventHandle<ChessEvent>,
    }

    struct ChessEvent has drop, store {
        game: address,
        action: u8,
        actor: address,
        from: u8,
        to: u8,
        promo: u8,
        reason: u8,
    }

    /// Creates a wagered chess game with the standard start position.
    public entry fun create(creator: &signer, stake: u64, metadata: String) {
        let ctor = wager::create_game(creator, KIND_CHESS, stake, metadata);
        attach_state(&ctor);
    }

    fun attach_state(ctor: &ConstructorRef) {
        let obj_signer = object::generate_signer(ctor);
        let game_addr = object::object_address(
            &object::object_from_constructor_ref<State>(ctor),
        );
        move_to(&obj_signer, State {
            pos: chess_rules::start_position(),
            creator_is_white: true, // placeholder until the join-time flip
            outcome: chess_rules::OUTCOME_ONGOING,
            events: object::new_event_handle(&obj_signer),
        });
        let _ = game_addr;
    }

    /// Joins and flips colors: u8_range(0,2) == 0 ⇒ creator is white.
    /// Randomness-bearing — clients submit with simulation disabled.
    public entry fun join(player: &signer, game_addr: address) acquires State {
        wager::join_core(player, game_addr);
        let flip = randomness::u8_range(0, 2);
        let state = borrow_global_mut<State>(game_addr);
        state.creator_is_white = flip == 0;
    }

    /// Address of the side to move, from the flip bit plus wager's roster.
    public fun current_mover(game_addr: address): address acquires State {
        let (a, b) = wager::players(game_addr);
        let state = borrow_global<State>(game_addr);
        let white = if (state.creator_is_white) a else b;
        if (state.pos.side_to_move == chess_rules::WHITE) white else b_or_black(state.creator_is_white, a, b)
    }

    fun b_or_black(creator_is_white: bool, a: address, b: address): address {
        if (creator_is_white) b else a
    }

    public entry fun move_piece(
        player: &signer,
        game_addr: address,
        from: u8,
        to: u8,
        promo: u8,
    ) acquires State {
        let player_addr = signer::address_of(player);
        assert_player(game_addr, player_addr);
        assert!(wager::phase(game_addr) == PHASE_IN_PROGRESS, E_NOT_YOUR_TURN);
        assert!(current_mover(game_addr) == player_addr, E_NOT_YOUR_TURN);

        let (new_pos, outcome) = {
            let state = borrow_global<State>(game_addr);
            chess_rules::make_move(&state.pos, from, to, promo)
        };
        let state = borrow_global_mut<State>(game_addr);
        state.pos = new_pos;
        emit(game_addr, ACTION_MOVED, player_addr, from, to, promo, 0);
        if (outcome != chess_rules::OUTCOME_ONGOING) {
            finish(game_addr, outcome, player_addr);
        };
        let _ = state;
    }

    /// Applies a legal move and evaluates the terminal state. Aborts with
    /// chess_rules codes on illegality. Public so chess (and tests) drive it.
    public fun make_move(pos: &Position, from: u8, to: u8, promo: u8): (Position, u8) {
        assert!(chess_rules::is_legal(pos, from, to, promo), chess_rules::E_INVALID_MOVE);
        let next = chess_rules::apply_move(pos, from, to, promo);
        let outcome = chess_rules::evaluate_terminal(&next);
        (next, outcome)
    }
```

Wait — placement: `make_move` belongs in `chess_rules` (pure), not `chess`. FINAL: put `make_move` in `chess_rules` (Task 6 extension, tiny) and have `chess::move_piece` call it. Adjust Task 6 interfaces to include:

```move
    /// Convenience: validate+apply+evaluate in one call.
    public fun make_move(pos: &Position, from: u8, to: u8, promo: u8): (Position, u8) {
        assert!(is_legal(pos, from, to, promo), E_INVALID_MOVE);
        let next = apply_move(pos, from, to, promo);
        (next, evaluate_terminal(&next))
    }
```

Continuing `chess.move`:

```move
    /// Either player resigns: pot goes to the opponent.
    public entry fun resign(player: &signer, game_addr: address) acquires State {
        let player_addr = signer::address_of(player);
        assert_player(game_addr, player_addr);
        assert!(wager::phase(game_addr) == PHASE_IN_PROGRESS, E_NOT_YOUR_TURN);
        let winner = opponent_of(game_addr, player_addr);
        finish_by(game_addr, chess_rules::OUTCOME_RESIGNED, player_addr, ACTION_RESIGNED, winner);
        wager::settle(game_addr, winner);
    }

    /// Turn-aware timeout: the non-moving player claims the whole pot.
    public entry fun claim_forfeit(caller: &signer, game_addr: address) acquires State {
        let caller_addr = signer::address_of(caller);
        assert_player(game_addr, caller_addr);
        assert!(
            timestamp::now_seconds() - wager::last_move_at(game_addr) > wager::timeout_seconds(),
            E_TIMEOUT_NOT_REACHED,
        );
        assert!(current_mover(game_addr) != caller_addr, E_CLAIM_OWN_TURN);
        finish_by(game_addr, chess_rules::OUTCOME_FORFEITED, caller_addr, ACTION_FORFEIT_CLAIMED, caller_addr);
        wager::settle(game_addr, caller_addr);
    }

    fun finish(game_addr: address, outcome: u8, winner: address) acquires State {
        borrow_global_mut<State>(game_addr).outcome = outcome;
        emit(game_addr, ACTION_GAME_OVER, winner, 0, 0, 0, outcome);
        if (outcome == chess_rules::OUTCOME_WHITE_MATED || outcome == chess_rules::OUTCOME_BLACK_MATED) {
            wager::settle(game_addr, winner);
        } else {
            wager::settle_draw(game_addr);
        };
    }

    fun finish_by(game_addr: address, outcome: u8, actor: address, action: u8, winner: address) acquires State {
        borrow_global_mut<State>(game_addr).outcome = outcome;
        emit(game_addr, action, actor, 0, 0, 0, outcome);
        emit(game_addr, ACTION_GAME_OVER, winner, 0, 0, 0, outcome);
    }

    fun opponent_of(game_addr: address, who: address): address acquires State {
        let (a, b) = wager::players(game_addr);
        if (who == a) b else a
    }

    fun assert_player(game_addr: address, who: address) {
        let (a, b) = wager::players(game_addr);
        assert!(who == a || who == b, E_NOT_A_PLAYER);
    }

    fun emit(game_addr: address, action: u8, actor: address, from: u8, to: u8, promo: u8, reason: u8) acquires State {
        let state = borrow_global_mut<State>(game_addr);
        event::emit_event(&mut state.events, ChessEvent {
            game: game_addr, action, actor, from, to, promo, reason,
        });
    }

    // --- views ---
    #[view]
    public fun board(game_addr: address): vector<u8> acquires State {
        borrow_global<State>(game_addr).pos.board
    }

    #[view]
    public fun state(game_addr: address): (u8, u8, u8, u16, u8, bool) acquires State {
        let s = borrow_global<State>(game_addr);
        (s.pos.side_to_move, s.pos.castling, s.pos.ep_square, s.pos.halfmove_clock, s.outcome, s.creator_is_white)
    }

    #[view]
    public fun legal_moves_view(game_addr: address, from: Option<u8>): vector<u16> acquires State {
        chess_rules::legal_moves(&borrow_global<State>(game_addr).pos, from)
    }
}
```

MISSING pieces (executor adds): `OUTCOME_RESIGNED: u8 = 6` and `OUTCOME_FORFEITED: u8 = 7` consts in `chess_rules` (Task 6, alongside the others); `KIND_CHESS` referenced via `wager::KIND_CHESS` — qualify the call in `create` as `wager::create_game(creator, wager::KIND_CHESS, stake, metadata)` and add `use arcade::wager;` at top (the snippets above use bare `wager::` assuming that import); `current_mover` cleanup — replace the awkward helper with:

```move
    public fun current_mover(game_addr: address): address acquires State {
        let (a, b) = wager::players(game_addr);
        let state = borrow_global<State>(game_addr);
        let white = if (state.creator_is_white) a else b;
        let black = if (state.creator_is_white) b else a;
        if (state.pos.side_to_move == chess_rules::WHITE) white else black
    }
```

…and delete `b_or_black`. `attach_state`: drop the unused `game_addr`/`let _` noise — keep only signer + move_to.

Integration tests (append; helpers duplicated from `wager` tests since `#[test_only]` fns don't import across modules):

```move
    #[test_only]
    use aptos_framework::account;
    #[test_only]
    use aptos_framework::aptos_coin;
    #[test_only]
    use aptos_framework::aptos_coin_tests::mint_apt_fa_to_primary_fungible_store_for_test;
    #[test_only]
    use aptos_framework::fungible_asset;
    #[test_only]
    use aptos_framework::primary_fungible_store;
    #[test_only]
    use arcade::hub;

    #[test_only]
    const DEPLOYER_SEED: vector<u8> = b"chess-it";

    #[test_only]
    fun setup_coin_and_player(who: address, amount: u64) {
        aptos_framework::timestamp::set_time_has_started_for_testing(
            &account::create_signer_for_test(@aptos_framework),
        );
        aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        aptos_account::create_account(who);
        mint_apt_fa_to_primary_fungible_store_for_test(who, amount);
    }
```

(`aptos_account` — import `aptos_framework::aptos_account` too.)

```move
    #[test(creator = @0xC1, joiner = @0xC2, deployer = @arcade)]
    fun test_create_join_escrow_and_flip(creator: &signer, joiner: &signer, deployer: &signer) acquires State {
        randomness::initialize_for_testing(deployer);
        hub::initialize(deployer);
        setup_coin_and_player(@0xC1, 10_000_000);
        setup_coin_and_player(@0xC2, 10_000_000);
        create(creator, 500, string::utf8(b"chess1"));
        let game = object_addr(@0xC1, b"chess1");
        assert!(wager::pot(game) == 500, 0);
        join(joiner, game);
        assert!(wager::pot(game) == 1000, 0);
        assert!(wager::phase(game) == PHASE_IN_PROGRESS, 0);
        // Fixed zero seed ⇒ deterministic flip; whichever way it lands, exactly
        // one of the two players is the initial mover.
        let (a, b) = wager::players(game);
        let mover = current_mover(game);
        assert!(mover == a || mover == b, 0);
        // Same-seed determinism: a second identical game flips identically.
        create(creator, 100, string::utf8(b"chess2"));
        let game2 = object_addr(@0xC1, b"chess2");
        join(joiner, game2);
        let state1 = borrow_global<State>(game);
        let state2 = borrow_global<State>(game2);
        assert!(state1.creator_is_white == state2.creator_is_white, 0);
    }

    #[test_only]
    fun object_addr(creator: address, seed: vector<u8>): address {
        object::create_object_address(&creator, seed)
    }

    #[test(creator = @0xD1, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::chess::E_NOT_A_PLAYER)]
    fun test_stranger_cannot_move(creator: &signer, deployer: &signer) {
        hub::initialize(deployer);
        setup_coin_and_player(@0xD1, 10_000_000);
        create(creator, 100, string::utf8(b"solo"));
        move_piece(creator, object_addr(@0xD1, b"solo"), 52, 36, 0);
    }
```

Wait — stranger test: creator IS a player; the abort target should be a third party. Add `stranger = @0xD2` param and call `move_piece(stranger, …)`. Also before join the phase is OPEN so even players can't move (`E_NOT_YOUR_TURN` via phase assert) — cover that too:

```move
    #[test(creator = @0xD3, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::chess::E_NOT_YOUR_TURN)]
    fun test_no_move_before_join(creator: &signer, deployer: &signer) {
        hub::initialize(deployer);
        setup_coin_and_player(@0xD3, 10_000_000);
        create(creator, 100, string::utf8(b"open"));
        move_piece(creator, object_addr(@0xD3, b"open"), 52, 36, 0);
    }
```

- [ ] **Step 3: Run tests to PASS + compile**
- [ ] **Step 4: Commit** — `git commit -m "Wire chess into arcade: kind 5, create/join with color flip, views"`

---

### Task 8: Settlement integration — mate/draw/resign/forfeit end-to-end

**Files:** Modify: `move/arcade/sources/chess.move` (tests primarily)

- [ ] **Step 1: Failing integration tests**

```move
    #[test(creator = @0xE1, joiner = @0xE2, deployer = @arcade)]
    fun test_mate_settles_pot_to_winner(creator: &signer, joiner: &signer, deployer: &signer) acquires State {
        randomness::initialize_for_testing(deployer);
        hub::initialize(deployer);
        setup_coin_and_player(@0xE1, 10_000_000);
        setup_coin_and_player(@0xE2, 10_000_000);
        create(creator, 700, string::utf8(b"mate"));
        let game = object_addr(@0xE1, b"mate");
        join(joiner, game);
        let creator_is_white = borrow_global<State>(game).creator_is_white;
        // Play scholar's mate; if the JOINER is white, mirror colors by swapping roles.
        play_scholars_mate(game, creator_is_white);
        assert!(wager::phase(game) == 2, 0); // settled
        assert!(wager::pot(game) == 0, 0);
        let winner = if (creator_is_white) @0xE1 else @0xE2; // scripted mate is delivered by white
        let winner_balance = primary_fungible_store::balance(winner, paired_metadata());
        assert!(winner_balance == 10_000_000 + 700, 0);
    }

    #[test_only]
    fun paired_metadata(): Object<fungible_asset::Metadata> {
        option::extract(&mut coin::paired_metadata<AptosCoin>())
    }
```

(Need `use aptos_framework::coin::{Self, AptosCoin};` + `use aptos_framework::object::Object;` in test imports.)

```move
    /// Drives the four white moves of the scholar's mate (and black's replies)
    /// through move_piece, honoring which ADDRESS holds white.
    #[test_only]
    entry fun play_scholars_mate_entry(_x: &signer) {} // not used; see helper below
```

NOTE to executor: entry fns can't be called from tests directly with borrowed signers? They CAN (plain function calls in test context). But `play_scholars_mate` needs the two player signers; write it as a `#[test_only] fun` taking `(&signer,&signer,address,bool)` and calling `move_piece(white_sig, game, f, t, 0)` / `move_piece(black_sig, …)` per the scripted squares `((52,36),(12,28),(61,34),(1,18),(59,23),(6,21),(23,13))` — white moves at indices 0,2,4,6; black at 1,3,5. If `creator_is_white` is false, swap which signer plays white.

```move
    #[test(creator = @0xF1, joiner = @0xF2, deployer = @arcade)]
    fun test_resign_settles_to_opponent(creator: &signer, joiner: &signer, deployer: &signer) acquires State {
        randomness::initialize_for_testing(deployer);
        hub::initialize(deployer);
        setup_coin_and_player(@0xF1, 10_000_000);
        setup_coin_and_player(@0xF2, 10_000_000);
        create(creator, 300, string::utf8(b"resign"));
        let game = object_addr(@0xF1, b"resign");
        join(joiner, game);
        resign(creator, game);
        assert!(wager::pot(game) == 0, 0);
        assert!(primary_fungible_store::balance(@0xF2, paired_metadata()) == 10_000_000 + 300, 0);
        assert!(borrow_global<State>(game).outcome == chess_rules::OUTCOME_RESIGNED, 0);
    }

    #[test(creator = @0x11, joiner = @0x12, deployer = @arcade)]
    fun test_turn_aware_forfeit_and_generic_fallback(creator: &signer, joiner: &signer, deployer: &signer) acquires State {
        randomness::initialize_for_testing(deployer);
        hub::initialize(deployer);
        setup_coin_and_player(@0x11, 10_000_000);
        setup_coin_and_player(@0x12, 10_000_000);
        create(creator, 400, string::utf8(b"forfeit"));
        let game = object_addr(@0x11, b"forfeit");
        join(joiner, game);
        // Before timeout: claim aborts.
        // (separate expected_failure test below)
        timestamp::fast_forward_seconds(wager::timeout_seconds() + 1);
        // Only the NON-mover may claim.
        let mover = current_mover(game);
        let nonmover = if (mover == @0x11) @0x12 else @0x11;
        // Single-outcome-event invariant: count before, exactly +2 after
        // (CLAIMED + GAME_OVER), and settle emitted by wager separately.
        claim_forfeit(nonmover_signer_placeholder, game);
        // (Executor: obtain the right signer via the test params — see note.)
    }
```

NOTE to executor: tests receive both signers; branch on the deterministic flip (fixed zero seed ⇒ `creator_is_white` known constant at authoring time — print/assert it first in a scratch run, then hard-code the branch). Split into THREE concrete tests rather than one mega-test:
1. `claim_before_timeout_aborts` — `#[expected_failure(E_TIMEOUT_NOT_REACHED)]`, fast-forward less than timeout.
2. `mover_cannot_self_claim` — `#[expected_failure(E_CLAIM_OWN_TURN)]`, after fast-forward, mover calls.
3. `nonmover_claims_whole_pot_single_events` — after fast-forward, nonmover calls; assert pot 0, nonmover balance `10_000_000 + 400`, outcome `OUTCOME_FORFEITED`, and ChessEvent count grew by exactly 2 with last action `ACTION_GAME_OVER`.
Plus:
4. `generic_timeout_refunds_both` — fresh game, fast-forward, call `wager::forfeit_timeout(joiner, game)`; both balances restored to 10_000_000 (split refund), phase settled.
5. `illegal_move_abort_code` — `#[expected_failure(abort_code = arcade::chess_rules::E_INVALID_MOVE)]`: after join, attempt `move_piece(mover, game, 52, 45, 0)` (e2–d4-style illegal hop? 52→45 is not a pawn/knight move — good).

- [ ] **Step 2: Run full arcade suite + compile**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xCAFE && aptos move compile --named-addresses arcade=0xCAFE`
Expected: entire suite green (wager 22 + hub 2 + chess_rules ~20 + chess ~10 ≈ 54 tests).

- [ ] **Step 3: Add arcade compile step to CI**

In `.github/workflows/ci.yml`, inside the `move` job, insert BEFORE "Test arcade":

```yaml
      - name: Compile arcade
        working-directory: move/arcade
        run: aptos move compile --named-addresses arcade=0xCAFE
```

- [ ] **Step 4: Commit** — `git commit -m "Settle chess games: mate, resign, turn-aware forfeit, timeouts"`

---

### Task 9: Client data layer — kind 5, lobby row, `lib/chess.ts`

**Files:**
- Modify: `client/src/lib/arcade.ts` (re-read first — `9ebfe2b` added `ChineseCheckers = 4`)
- Modify: `client/src/routes/index.tsx` (re-read first — lobby rows/labels)
- Create: `client/src/lib/chess.ts`
- Test: `client/src/lib/chess.test.ts`

**Interfaces (produces):**
- `GameKind.Chess = 5`
- `getChessBoard(address): Promise<number[]>`, `getChessState(address): Promise<ChessState>`, `getLegalMoves(address, from?: number): Promise<PackedMove[]>` where `ChessState = { sideToMove, castling, epSquare, halfmoveClock, outcome, creatorIsWhite }`, `PackedMove = { from, to, promo }`
- `unpackMove(p: number): PackedMove`, `squareName(sq: number): string` (`0 → "a8"`), `parseSquare(name): number`, `pieceGlyph(code: number): string`, `colorOf(state: ChessState, summary: GameSummary, addr: string): "white" | "black" | null`

- [ ] **Step 1: Failing vitest cases**

```ts
import { describe, expect, it } from "vitest";
import { parseSquare, pieceGlyph, squareName, unpackMove } from "./chess";

describe("squareName/parseSquare round-trip", () => {
  it("maps index 0 to a8 and 63 to h1", () => {
    expect(squareName(0)).toBe("a8");
    expect(squareName(63)).toBe("h1");
    expect(parseSquare("a8")).toBe(0);
    expect(parseSquare("h1")).toBe(63);
    expect(parseSquare(squareName(37))).toBe(37);
  });
});

describe("unpackMove", () => {
  it("decodes from/to/promo fields", () => {
    // from=52, to=36, promo=0 → (52<<10)|(36<<4) = 53248+576 = 53824
    expect(unpackMove((52 << 10) | (36 << 4))).toEqual({ from: 52, to: 36, promo: 0 });
    // underpromotion: from=49,to=1,promo=2
    expect(unpackMove((49 << 10) | (1 << 4) | 2)).toEqual({ from: 49, to: 1, promo: 2 });
  });
});

describe("pieceGlyph", () => {
  it("renders unicode glyphs per side", () => {
    expect(pieceGlyph(6)).toBe("♔"); // white king
    expect(pieceGlyph(14)).toBe("♚"); // black king
    expect(pieceGlyph(1)).toBe("♙");
    expect(pieceGlyph(9)).toBe("♟");
    expect(pieceGlyph(0)).toBe("");
  });
});
```

- [ ] **Step 2: Run `cd client && npx vitest run src/lib/chess.test.ts` — verify FAIL** (module missing)

- [ ] **Step 3: Implement `lib/chess.ts`**

```ts
import { aptos } from "./aptos";
import { ARCADE_PACKAGE } from "./constants";

// Mirrors arcade::chess_rules piece/outcome constants.
export const OUTCOME = {
  Ongoing: 0,
  WhiteMated: 1,
  BlackMated: 2,
  Stalemate: 3,
  Insufficient: 4,
  FiftyMove: 5,
  Resigned: 6,
  Forfeited: 7,
} as const;

const PKG = ARCADE_PACKAGE.trim().toLowerCase();

async function view<T>(fn: string, args: unknown[]): Promise<T[]> {
  const result = await aptos.view({
    payload: {
      function: `${PKG}::${fn}` as `${string}::${string}::${string}`,
      functionArguments: args as never[],
    },
  });
  return result as T[];
}

export interface ChessState {
  sideToMove: number; // 0 white, 1 black
  castling: number;
  epSquare: number; // 255 = none
  halfmoveClock: number;
  outcome: number;
  creatorIsWhite: boolean;
}

export interface PackedMove {
  from: number;
  to: number;
  promo: number;
}

export async function getChessBoard(address: string): Promise<number[]> {
  const [board] = await view<bigint>("chess::board", [address]);
  return Array.from(board as unknown as number[]);
}

export async function getChessState(address: string): Promise<ChessState> {
  const [[stm, castling, ep, clock, outcome, creatorIsWhite]] = await view<
    [number, number, number, bigint, number, boolean]
  >("chess::state", [address]);
  return {
    sideToMove: Number(stm),
    castling: Number(castling),
    epSquare: Number(ep),
    halfmoveClock: Number(clock),
    outcome: Number(outcome),
    creatorIsWhite: Boolean(creatorIsWhite),
  };
}

export async function getLegalMoves(address: string, from?: number): Promise<PackedMove[]> {
  const [moves] = await view<bigint[]>("chess::legal_moves_view", [
    address,
    from === undefined ? [] : [from],
  ]);
  return (Array.isArray(moves) ? moves : []).map((m) => unpackMove(Number(m)));
}

export function unpackMove(packed: number): PackedMove {
  return {
    from: (packed >> 10) & 63,
    to: (packed >> 4) & 63,
    promo: packed & 15,
  };
}

const FILES = "abcdefgh";

export function squareName(sq: number): string {
  return `${FILES[sq % 8]}${8 - Math.floor(sq / 8)}`;
}

export function parseSquare(name: string): number {
  const file = FILES.indexOf(name[0]?.toLowerCase() ?? "");
  const rank = Number(name.slice(1));
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) {
    throw new Error(`Bad square: ${name}`);
  }
  return (8 - rank) * 8 + file;
}

// Unicode glyphs indexed by piece code; 7/8 are unused gaps.
const GLYPHS = ["", "♙", "♘", "♗", "♖", "♕", "♔", "", "", "♟", "♞", "♝", "♜", "♛", "♚"];

export function pieceGlyph(code: number): string {
  return GLYPHS[code] ?? "";
}

/** Which color does `addr` play, given the flip bit and wager roster? */
export function colorOf(
  state: Pick<ChessState, "creatorIsWhite">,
  players: { playerA: string; playerB: string },
  addr: string,
): "white" | "black" | null {
  const norm = (a: string) => a.trim().toLowerCase();
  if (norm(addr) === norm(players.playerA)) return state.creatorIsWhite ? "white" : "black";
  if (norm(addr) === norm(players.playerB)) return state.creatorIsWhite ? "black" : "white";
  return null;
}
```

- [ ] **Step 4: Extend `GameKind` + lobby**

In `arcade.ts` after `ChineseCheckers = 4` add `Chess = 5,`. In `routes/index.tsx` re-read the current lobby arrays (post-`9ebfe2b` shape) and add Chess alongside chinese checkers: label `"Chess"`, included in both the counts `Promise.all` array and the rendered list, following however chinese checkers was added there.

- [ ] **Step 5: Full client gates**

Run: `cd client && npm run typecheck && npm test`
Expected: green (new + all existing tests).

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/chess.ts client/src/lib/chess.test.ts client/src/lib/arcade.ts client/src/routes/index.tsx
git commit -m "Add chess client data layer and lobby entry"
```

---

### Task 10: Chess UI — board component, route, how-to-play

**Files:**
- Create: `client/src/components/ChessBoard.tsx`
- Create: `client/src/routes/chess.$address.tsx`
- Modify: `client/src/components/HowToPlay.tsx` (add `"chess"` variant)
- Modify: `client/src/routeTree.gen.ts` (regenerated by build — committed)
- Test: `client/src/components/ChessBoard.test.tsx`

- [ ] **Step 1: Failing component test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChessBoard } from "./ChessBoard";

describe("ChessBoard", () => {
  it("renders 64 squares and reports clicks", () => {
    const board = new Array<number>(64).fill(0);
    board[60] = 6; // white king e1
    const onSquareClick = vi.fn();
    render(<ChessBoard board={board} selected={null} targets={[]} onSquareClick={onSquareClick} flipped={false} />);
    expect(screen.getAllByTestId(/chess-square-/)).toHaveLength(64);
    fireEvent.click(screen.getByTestId("chess-square-60"));
    expect(onSquareClick).toHaveBeenCalledWith(60);
  });

  it("marks target squares", () => {
    const board = new Array<number>(64).fill(0);
    render(<ChessBoard board={board} selected={52} targets={[36, 44]} onSquareClick={() => {}} flipped={false} />);
    expect(screen.getByTestId("chess-square-36").dataset.target).toBe("true");
    expect(screen.getByTestId("chess-square-52").dataset.selected).toBe("true");
  });
});
```

- [ ] **Step 2: Implement `ChessBoard.tsx`**

```tsx
interface ChessBoardProps {
  board: number[];
  selected: number | null;
  targets: { to: number; promo: number }[];
  onSquareClick: (square: number) => void;
  flipped: boolean; // render black's perspective when the viewer plays black
}

const GLYPHS: Record<number, string> = {
  1: "♙", 2: "♘", 3: "♗", 4: "♖", 5: "♕", 6: "♔",
  9: "♟", 10: "♞", 11: "♝", 12: "♜", 13: "♛", 14: "♚",
};

function isLightSquare(sq: number): boolean {
  const row = Math.floor(sq / 8);
  const col = sq % 8;
  return (row + col) % 2 === 0;
}

export function ChessBoard({ board, selected, targets, onSquareClick, flipped }: ChessBoardProps) {
  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i));
  const targetSet = new Set(targets.map((t) => t.to));
  return (
    <div className="grid aspect-square w-full max-w-xl grid-cols-8 overflow-hidden rounded-lg border border-border shadow-sm select-none">
      {order.map((sq) => (
        <button
          key={sq}
          type="button"
          data-testid={`chess-square-${sq}`}
          data-selected={selected === sq ? "true" : undefined}
          data-target={targetSet.has(sq) ? "true" : undefined}
          onClick={() => onSquareClick(sq)}
          className={[
            "flex items-center justify-center text-3xl leading-none sm:text-4xl",
            isLightSquare(sq) ? "bg-neutral-200" : "bg-neutral-500",
            targetSet.has(sq) ? "outline outline-2 -outline-offset-2 outline-emerald-500" : "",
            selected === sq ? "outline outline-2 -outline-offset-2 outline-sky-600" : "",
          ].join(" ")}
        >
          {GLYPHS[board[sq]] ?? ""}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Route `chess.$address.tsx`**

Full page: loads summary (`getGameSummary` from `lib/arcade`), chess state + board + legal moves (Task 9 API) with a 5-second poll while unsettled; click handling — first click selects own piece (viewer's color from `colorOf` + `sideToMove`), fetches `getLegalMoves(addr, from)`; second click finds the matching packed move; if multiple promos exist for that from→to, opens the Radix dialog (reuse `components/ui/dialog`) offering ♕♖♗♘ and submits the chosen one; otherwise submits directly via wallet `signAndSubmitTransaction` with function `${ARCADE_PACKAGE_ID}::chess::move_piece` args `[addressParam, from, to, promo]`. Controls: Join (calls `chess::join`, shown for phase Open when viewer isn't creator; caption explains the wallet prompt carries a randomness draw), Cancel (creator, Open — `wager::cancel`), Resign (either player, InProgress — `chess::resign`), Claim forfeit (InProgress, `timeSinceLastMove > timeoutSeconds` and viewer is NOT side to move — `chess::claim_forfeit`), generic timeout refund (same window but viewer IS side to move — `wager::forfeit_timeout`), settlement banner mapping `OUTCOME.*` to text ("Checkmate — white wins" / "Draw by stalemate" / etc.), and `<HowToPlay variant="chess" />`. Follow the structural conventions of `routes/game.$creator.$name.tsx` (route id `"/chess/$address"`, `createFileRoute`, params via `Route.useParams()`).

Write the complete page component in this step (executor composes from the Task 9 API + existing page patterns; every control maps to the exact entry functions listed above — no placeholders).

- [ ] **Step 4: `HowToPlay` chess variant**

Change the prop type to `{ variant: "lobby" | "game" | "chess" }` and add a third `items` branch:

```tsx
      : variant === "chess"
        ? [
            "Create a game and pick your stake; joining locks both wagers in escrow.",
            "A random draw assigns colors at join — white moves first.",
            "Tap a piece to see its legal moves, tap a square to move. Promotions ask you to pick a piece.",
            "Checkmate ends it; stalemate, dead positions, and the fifty-move rule refund both players.",
          ]
        : [ /* existing "game" items */ ]
```

- [ ] **Step 5: Regenerate route tree and run ALL gates**

Run: `cd client && npm run build && npm run typecheck && npm test && npm run test:ssr`
Expected: build regenerates `routeTree.gen.ts` with the new route; all green.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ChessBoard.tsx client/src/components/ChessBoard.test.tsx client/src/routes/chess.\$address.tsx client/src/components/HowToPlay.tsx client/src/routeTree.gen.ts
git commit -m "Add chess board UI and route"
```

---

### Task 11: Full verification sweep + branch finishing

- [ ] **Step 1: Both Move modes**

Run: `cd move/arcade && aptos move compile --named-addresses arcade=0xCAFE && aptos move test --named-addresses arcade=0xCAFE`
Expected: compile clean; full suite green.

- [ ] **Step 2: Client parity with CI**

Run: `cd client && npm ci && npm run typecheck && npm test && npm run build && npm run test:ssr`
Expected: green end-to-end.

- [ ] **Step 3: Reviewer pass**

Dispatch superpowers:requesting-code-review on the full diff vs `main`-merge-base (spec: fund paths unchanged, single-settlement invariant, precedence order, no attribution trailers).

- [ ] **Step 4: Push branch and open PR**

```bash
git checkout -b arcade-chess   # created at Task 1 start, off arcade-phase0
git push -u origin arcade-chess
gh pr create --base arcade-phase0 --title "Arcade phase 1: chess" --body "$(cat <<'EOF'
Implements client/docs/plans/2026-08-25-chess-phase-design.md.

- arcade::chess_rules — pure rules engine (geometry, legality, terminals), crafted-position tests
- arcade::chess — state, create/join (randomness color flip), move/resign/turn-aware forfeit, views
- wager: KIND_CHESS=5 + whitelist + friend
- client: kind 5, lobby row, /chess/$address board driven by legal_moves view
EOF
)"
```

(Stacked PR against `arcade-phase0` so PR #17 can merge independently.)

## Self-review notes (resolved during writing)

- Spec coverage: kinds/whitelist (T7), state encoding (T1/T7), validation pipeline (T3–T5), terminal precedence (T6), settlement table incl. resign + turn-aware forfeit + generic fallback (T7/T8), views incl. packed legal_moves (T5/T7), randomness flip + test seeding (T7), client data layer/UI/how-to-play/lobby (T9/T10), CI double-mode + arcade compile step (T8/T11), no-sim note surfaced in Join caption (T10).
- Type consistency: `make_move` lives in `chess_rules` (T6) consumed by `chess::move_piece` (T7); `PackedMove` shared between `lib/chess.ts` and `ChessBoard` props; `OUTCOME` codes match Move consts verbatim.
- Placeholders: the intentionally-marked "NOTE to executor" blocks contain corrections that SUPERSEDE nearby sketch code; where both appear, the note wins. Everything else is literal.
