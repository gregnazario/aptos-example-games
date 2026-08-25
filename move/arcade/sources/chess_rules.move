/// Pure chess rules engine: board model, move legality, terminal detection.
/// No global storage — every function is a pure computation over `Position`,
/// so the entire ruleset is unit-testable without accounts or escrow.
module arcade::chess_rules {
    use std::vector;

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

    // Outcomes (mirrored by client and chess::State.outcome).
    public const OUTCOME_ONGOING: u8 = 0;
    /// White delivered mate; white won.
    public const OUTCOME_WHITE_MATED: u8 = 1;
    /// Black delivered mate; black won.
    public const OUTCOME_BLACK_MATED: u8 = 2;
    public const OUTCOME_STALEMATE: u8 = 3;
    public const OUTCOME_INSUFFICIENT: u8 = 4;
    public const OUTCOME_FIFTY_MOVE: u8 = 5;
    public const OUTCOME_RESIGNED: u8 = 6;
    public const OUTCOME_FORFEITED: u8 = 7;

    // Rules-engine aborts.
    const E_INVALID_MOVE: u64 = 1;
    const E_PROMO_REQUIRED: u64 = 2;
    const E_PROMO_FORBIDDEN: u64 = 3;
    const E_BAD_PROMO_PIECE: u64 = 4;
    const E_EMPTY_SOURCE: u64 = 5;

    const BOARD_SIZE: u64 = 64;

    /// Full game position. Stored on the game object by arcade::chess.
    struct Position has copy, drop, store {
        board: vector<u8>,
        side_to_move: u8,
        castling: u8,
        ep_square: u8,
        halfmove_clock: u16,
    }

    // ------------------------------------------------------------------
    // Coordinates and pieces
    // ------------------------------------------------------------------

    public fun row_of(sq: u8): u8 { sq / 8 }
    public fun col_of(sq: u8): u8 { sq % 8 }
    fun sq(row: u16, col: u16): u8 { ((row * 8) + col) as u8 }

    fun in_bounds(row: u16, col: u16): bool { row < 8 && col < 8 }

    /// Board lookup by (row, col); caller guarantees bounds.
    fun at(board: &vector<u8>, row: u16, col: u16): u8 {
        *vector::borrow(board, (((row as u64) * 8) + (col as u64)))
    }

    fun set_at(board: &mut vector<u8>, row: u16, col: u16, piece: u8) {
        let i = ((row as u64) * 8) + (col as u64);
        *vector::borrow_mut(board, i) = piece;
    }

    /// Board lookup by square index.
    fun piece_at(board: &vector<u8>, sqi: u8): u8 {
        *vector::borrow(board, (sqi as u64))
    }

    public fun color_of(piece: u8): u8 {
        assert!(piece != EMPTY, E_EMPTY_SOURCE);
        if (piece >= B_PAWN) BLACK else WHITE
    }

    public fun is_own_piece(side: u8, piece: u8): bool {
        piece != EMPTY && color_of(piece) == side
    }

    /// Absolute distance between two rows/cols.
    fun delta(a: u16, b: u16): u16 { if (a >= b) a - b else b - a }

    // ------------------------------------------------------------------
    // Start position
    // ------------------------------------------------------------------

    /// Standard start: row 0 black back rank, row 1 black pawns, row 6 white
    /// pawns, row 7 white back rank. White to move, all rights, no ep target.
    public fun start_position(): Position {
        let board = vector[];
        // Back-rank order shared by both sides (black codes; white = minus 8).
        let order = vector[B_ROOK, B_KNIGHT, B_BISHOP, B_QUEEN, B_KING, B_BISHOP, B_KNIGHT, B_ROOK];
        let i: u64 = 0;
        while (i < 8) {
            vector::push_back(&mut board, *vector::borrow(&order, i));
            i = i + 1;
        };
        let i: u64 = 0;
        while (i < 8) { vector::push_back(&mut board, B_PAWN); i = i + 1; };
        let i: u64 = 0;
        while (i < 32) { vector::push_back(&mut board, EMPTY); i = i + 1; };
        let i: u64 = 0;
        while (i < 8) { vector::push_back(&mut board, W_PAWN); i = i + 1; };
        let i: u64 = 0;
        while (i < 8) {
            vector::push_back(&mut board, *vector::borrow(&order, i) - (B_PAWN - W_PAWN));
            i = i + 1;
        };
        Position {
            board,
            side_to_move: WHITE,
            castling: CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ,
            ep_square: NO_SQUARE,
            halfmove_clock: 0,
        }
    }

    // ------------------------------------------------------------------
    // Attack detection
    // ------------------------------------------------------------------

    /// Square of `side`'s king; aborts if absent.
    public fun king_square(board: &vector<u8>, side: u8): u8 {
        let target = if (side == WHITE) W_KING else B_KING;
        let i: u64 = 0;
        while (i < BOARD_SIZE) {
            if (*vector::borrow(board, i) == target) return (i as u8);
            i = i + 1;
        };
        abort E_EMPTY_SOURCE
    }

    /// Is `target` attacked by any piece of `by_side`? Pawn attackers sit one
    /// rank behind the target along its direction of travel (white attacks
    /// toward decreasing rows).
    public fun is_attacked(board: &vector<u8>, target: u8, by_side: u8): bool {
        let tr = row_of(target) as u16;
        let tc = col_of(target) as u16;

        // Pawns attack one rank ahead of their march; guard both edges first.
        let pawn = pawn_of(by_side);
        if (by_side == WHITE) {
            if (tr < 7 && (pawn_probe(board, tr + 1, tc, pawn))) return true;
        } else {
            if (tr > 0 && (pawn_probe(board, tr - 1, tc, pawn))) return true;
        };

        // Knights.
        let knight = if (by_side == WHITE) W_KNIGHT else B_KNIGHT;
        if (knight_attacks_from(board, tr, tc, knight)) return true;

        // King adjacency.
        let king = if (by_side == WHITE) W_KING else B_KING;
        if (king_adjacent(board, tr, tc, king)) return true;

        // Sliders: rook lines 0-3, bishop diagonals 4-7.
        let dir: u64 = 0;
        while (dir < 8) {
            if (ray_hit(board, tr, tc, by_side, dir)) return true;
            dir = dir + 1;
        };

        false
    }

    fun pawn_of(side: u8): u8 { if (side == WHITE) W_PAWN else B_PAWN }

    /// Either diagonal square beside column tc on row pr holds `pawn`?
    fun pawn_probe(board: &vector<u8>, pr: u16, tc: u16, pawn: u8): bool {
        if (tc > 0 && at(board, pr, tc - 1) == pawn) return true;
        if (tc < 7 && at(board, pr, tc + 1) == pawn) return true;
        false
    }

    fun king_adjacent(board: &vector<u8>, tr: u16, tc: u16, king: u8): bool {
        if (tr >= 1 && tc >= 1 && at(board, tr - 1, tc - 1) == king) return true;
        if (tr >= 1 && at(board, tr - 1, tc) == king) return true;
        if (tr >= 1 && tc <= 6 && at(board, tr - 1, tc + 1) == king) return true;
        if (tc >= 1 && at(board, tr, tc - 1) == king) return true;
        if (tc <= 6 && at(board, tr, tc + 1) == king) return true;
        if (tr <= 6 && tc >= 1 && at(board, tr + 1, tc - 1) == king) return true;
        if (tr <= 6 && at(board, tr + 1, tc) == king) return true;
        if (tr <= 6 && tc <= 6 && at(board, tr + 1, tc + 1) == king) return true;
        false
    }

    fun knight_attacks_from(board: &vector<u8>, tr: u16, tc: u16, knight: u8): bool {
        // Each branch guards the source-side margin before probing.
        if (tr >= 2 && tc >= 1 && at(board, tr - 2, tc - 1) == knight) return true;
        if (tr >= 2 && tc <= 6 && at(board, tr - 2, tc + 1) == knight) return true;
        if (tr <= 5 && tc >= 1 && at(board, tr + 2, tc - 1) == knight) return true;
        if (tr <= 5 && tc <= 6 && at(board, tr + 2, tc + 1) == knight) return true;
        if (tr >= 1 && tc >= 2 && at(board, tr - 1, tc - 2) == knight) return true;
        if (tr >= 1 && tc <= 5 && at(board, tr - 1, tc + 2) == knight) return true;
        if (tr <= 6 && tc >= 2 && at(board, tr + 1, tc - 2) == knight) return true;
        if (tr <= 6 && tc <= 5 && at(board, tr + 1, tc + 2) == knight) return true;
        false
    }

    /// Walk one ray from (tr, tc). Dirs: 0=N 1=S 2=W 3=E 4=NE 5=NW 6=SE 7=SW.
    /// True iff the FIRST piece found is a slider of `by_side` covering this
    /// line type (rook/queen for dirs 0-3, bishop/queen for 4-7).
    fun ray_hit(board: &vector<u8>, tr: u16, tc: u16, by_side: u8, dir: u64): bool {
        let rook_line = dir < 4;
        let slider = if (by_side == WHITE) {
            if (rook_line) W_ROOK else W_BISHOP
        } else {
            if (rook_line) B_ROOK else B_BISHOP
        };
        let queen = if (by_side == WHITE) W_QUEEN else B_QUEEN;
        let mut_r = tr;
        let mut_c = tc;
        let step: u64 = 0;
        while (step < 7) {
            if (dir == 0 || dir == 4 || dir == 5) {
                if (mut_r == 0) return false;
                mut_r = mut_r - 1;
            };
            if (dir == 1 || dir == 6 || dir == 7) {
                if (mut_r == 7) return false;
                mut_r = mut_r + 1;
            };
            if (dir == 2 || dir == 5 || dir == 7) {
                if (mut_c == 0) return false;
                mut_c = mut_c - 1;
            };
            if (dir == 3 || dir == 4 || dir == 6) {
                if (mut_c == 7) return false;
                mut_c = mut_c + 1;
            };
            let piece = at(board, mut_r, mut_c);
            if (piece != EMPTY) {
                return piece == slider || piece == queen
            };
            step = step + 1;
        };
        false
    }

    public fun in_check(pos: &Position, side: u8): bool {
        let enemy = if (side == WHITE) BLACK else WHITE;
        is_attacked(&pos.board, king_square(&pos.board, side), enemy)
    }

    // ==================================================================
    // Tests
    // ==================================================================

    #[test_only]
    fun empty_board(): vector<u8> {
        let b = vector[];
        let i: u64 = 0;
        while (i < BOARD_SIZE) { vector::push_back(&mut b, EMPTY); i = i + 1; };
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

    #[test]
    fun test_start_position_layout() {
        let pos = start_position();
        assert!(vector::length(&pos.board) == BOARD_SIZE, 0);
        assert!(piece_at(&pos.board, sq(0, 4)) == B_KING, 0);   // e8
        assert!(piece_at(&pos.board, sq(7, 4)) == W_KING, 0);   // e1
        assert!(piece_at(&pos.board, sq(6, 0)) == W_PAWN, 0);   // a2
        assert!(piece_at(&pos.board, sq(1, 7)) == B_PAWN, 0);   // h7
        assert!(piece_at(&pos.board, sq(3, 3)) == EMPTY, 0);    // d5
        assert!(piece_at(&pos.board, sq(7, 0)) == W_ROOK, 0);   // a1
        assert!(piece_at(&pos.board, sq(0, 0)) == B_ROOK, 0);   // a8
        assert!(piece_at(&pos.board, sq(7, 3)) == W_QUEEN, 0);  // d1
        assert!(pos.side_to_move == WHITE, 0);
        assert!(pos.castling == 15 && pos.ep_square == NO_SQUARE && pos.halfmove_clock == 0, 0);
    }

    #[test]
    fun test_helpers() {
        assert!(row_of(63) == 7 && col_of(63) == 7, 0);
        assert!(sq(7, 7) == 63 && sq(0, 0) == 0, 0);
        assert!(color_of(W_QUEEN) == WHITE && color_of(B_QUEEN) == BLACK, 0);
        assert!(!is_own_piece(WHITE, EMPTY), 0);
        assert!(!is_own_piece(WHITE, B_PAWN), 0);
        assert!(is_own_piece(BLACK, B_PAWN), 0);
        assert!(in_bounds(7, 7) && !in_bounds(8, 0) && !in_bounds(0, 8), 0);
        assert!(delta(3, 7) == 4 && delta(7, 3) == 4 && delta(5, 5) == 0, 0);
    }

    #[test]
    fun test_is_attacked_knights_and_pawns() {
        // White knight on d4 (square 35: row 4, col 3).
        let board = empty_board();
        place(&mut board, 35, W_KNIGHT);
        assert!(is_attacked(&board, 20, WHITE), 0); // e6
        assert!(is_attacked(&board, 18, WHITE), 0); // c6
        assert!(is_attacked(&board, 25, WHITE), 0); // b5
        assert!(is_attacked(&board, 29, WHITE), 0); // f5
        assert!(is_attacked(&board, 41, WHITE), 0); // b3
        assert!(is_attacked(&board, 45, WHITE), 0); // f3
        assert!(is_attacked(&board, 50, WHITE), 0); // c2
        assert!(is_attacked(&board, 52, WHITE), 0); // e2
        assert!(!is_attacked(&board, 27, WHITE), 0); // d5 not knight-reachable
        // Edge clipping: knight in the a8 corner covers only c7/b6.
        let corner = empty_board();
        place(&mut corner, 0, W_KNIGHT);
        assert!(is_attacked(&corner, 10, WHITE), 0); // c7
        assert!(is_attacked(&corner, 17, WHITE), 0); // b6
        assert!(!is_attacked(&corner, 1, WHITE), 0); // b8 unreachable
        // White pawn on e4 (square 36) attacks d5/f5 only.
        let pb = empty_board();
        place(&mut pb, 36, W_PAWN);
        assert!(is_attacked(&pb, 27, WHITE), 0);
        assert!(is_attacked(&pb, 29, WHITE), 0);
        assert!(!is_attacked(&pb, 20, WHITE), 0);
        assert!(!is_attacked(&pb, 44, WHITE), 0);
        // Black pawn on e5 (square 28) attacks d4/f4 downward.
        place(&mut pb, 28, B_PAWN);
        assert!(is_attacked(&pb, 35, BLACK), 0); // d4
        assert!(is_attacked(&pb, 37, BLACK), 0); // f4
    }

    #[test]
    fun test_is_attacked_sliding_and_king() {
        let board = empty_board();
        place(&mut board, 59, W_ROOK); // d1
        assert!(is_attacked(&board, 56, WHITE), 0);  // a1 along the rank
        assert!(is_attacked(&board, 27, WHITE), 0);  // d5 up the file
        assert!(!is_attacked(&board, 42, WHITE), 0); // c3 off rook lines
        // Bishop on c1 hits diagonals only.
        set_at(&mut board, 7, 3, EMPTY);
        place(&mut board, 58, W_BISHOP);
        assert!(is_attacked(&board, 23, WHITE), 0);  // g5
        assert!(!is_attacked(&board, 59, WHITE), 0); // d1 not diagonal
        // Queen on e4 (36) hits every line.
        set_at(&mut board, 7, 2, EMPTY);
        place(&mut board, 36, W_QUEEN);
        assert!(is_attacked(&board, 4, WHITE), 0);   // e8 file
        assert!(is_attacked(&board, 0, WHITE), 0);   // a8 diagonal
        assert!(is_attacked(&board, 32, WHITE), 0);  // a4 rank
        // Blockers stop sliders.
        place(&mut board, 20, B_PAWN); // e5 blocks the e-file
        assert!(!is_attacked(&board, 12, WHITE), 0); // e7 behind the pawn
        // King adjacency.
        let k = empty_board();
        place(&mut k, 27, B_KING); // d4
        assert!(is_attacked(&k, 18, BLACK), 0);      // c3
        assert!(is_attacked(&k, 35, BLACK), 0);      // d5
        assert!(!is_attacked(&k, 44, BLACK), 0);     // e6 too far
    }

    #[test]
    fun test_in_check_start_not_in_check() {
        let pos = start_position();
        assert!(!in_check(&pos, WHITE), 0);
        assert!(!in_check(&pos, BLACK), 0);
        assert!(king_square(&pos.board, WHITE) == 60, 0); // e1
        assert!(king_square(&pos.board, BLACK) == 4, 0);  // e8
    }
}
