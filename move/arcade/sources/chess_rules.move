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

    // ------------------------------------------------------------------
    // Move geometry (pseudo-legality)
    // ------------------------------------------------------------------

    /// Shape/path check for `from -> to` by the piece at `from` owned by the
    /// side to move: geometric pattern, obstruction, en passant availability,
    /// and castling preconditions (rights, empty lane, not out of check,
    /// crossed square unattacked, rook present). Destination king-safety is
    /// applied later via scratch-apply; destination may hold an enemy piece.
    public fun validate_geometry(pos: &Position, from: u8, to: u8): bool {
        if (from == to) return false;
        let piece = piece_at(&pos.board, from);
        if (!is_own_piece(pos.side_to_move, piece)) return false;
        let dest = piece_at(&pos.board, to);
        if (dest != EMPTY && color_of(dest) == pos.side_to_move) return false;

        let fr = row_of(from) as u16;
        let fc = col_of(from) as u16;
        let tr = row_of(to) as u16;
        let tc = col_of(to) as u16;

        if (piece == W_PAWN || piece == B_PAWN) {
            return pawn_geometry(pos, piece, fr, fc, tr, tc)
        };
        if (piece == W_KNIGHT || piece == B_KNIGHT) {
            return knight_shape(fr, fc, tr, tc)
        };
        if (piece == W_BISHOP || piece == B_BISHOP) {
            return slide_ok(&pos.board, fr, fc, tr, tc, true)
        };
        if (piece == W_ROOK || piece == B_ROOK) {
            return slide_ok(&pos.board, fr, fc, tr, tc, false)
        };
        if (piece == W_QUEEN || piece == B_QUEEN) {
            return slide_ok(&pos.board, fr, fc, tr, tc, true)
                || slide_ok(&pos.board, fr, fc, tr, tc, false)
        };
        if (piece == W_KING || piece == B_KING) {
            if (delta(tr, fr) <= 1 && delta(tc, fc) <= 1) return true;
            return castle_geometry(pos, piece, fr, fc, tr, tc)
        };
        false
    }

    /// White marches toward row 0; black toward row 7.
    fun pawn_geometry(pos: &Position, piece: u8, fr: u16, fc: u16, tr: u16, tc: u16): bool {
        let white = piece == W_PAWN;
        // A pawn standing on its promotion rank is unreachable in legal play;
        // refuse rather than underflow the forward step below.
        if (white && fr == 0) return false;
        if (!white && fr == 7) return false;
        let start_row: u16 = if (white) 6 else 1;
        let dest = piece_at(&pos.board, ((tr * 8) + tc) as u8);

        // Straight pushes (no capture).
        if (fc == tc) {
            let r1: u16 = if (white) fr - 1 else fr + 1;
            if (tr == r1 && dest == EMPTY) return true;
            let r2: u16 = if (white) fr - 2 else fr + 2;
            if (fr == start_row && tr == r2) {
                let mid: u16 = if (white) fr - 1 else fr + 1;
                return dest == EMPTY && piece_at(&pos.board, ((mid * 8) + tc) as u8) == EMPTY
            };
            return false
        };

        // Diagonals: ordinary capture or en passant only.
        if (delta(tr, fr) != 1 || delta(tc, fc) != 1) return false;
        let r1: u16 = if (white) fr - 1 else fr + 1;
        if (tr != r1) return false;
        if (dest != EMPTY && color_of(dest) != pos.side_to_move) return true;
        pos.ep_square != NO_SQUARE && sq(tr, tc) == pos.ep_square && dest == EMPTY
    }

    /// Knight jumps ignore obstruction entirely.
    fun knight_shape(fr: u16, fc: u16, tr: u16, tc: u16): bool {
        let dr = delta(tr, fr);
        let dc = delta(tc, fc);
        (dr == 2 && dc == 1) || (dr == 1 && dc == 2)
    }

    /// Straight/diagonal line with an obstruction scan of the intermediate
    /// squares. Steps are computed with guarded branches (no wrap tricks).
    fun slide_ok(board: &vector<u8>, fr: u16, fc: u16, tr: u16, tc: u16, diagonal: bool): bool {
        let dr = delta(tr, fr);
        let dc = delta(tc, fc);
        if (diagonal) {
            if (dr != dc || dr == 0) return false;
        } else {
            if (!((dr == 0 || dc == 0))) return false;
        };
        let steps: u64 = (if (dr > dc) dr else dc) as u64;
        let mut_r = fr;
        let mut_c = fc;
        let i: u64 = 0;
        while (i < steps) {
            if (tr > mut_r) { mut_r = mut_r + 1 } else { if (tr < mut_r) { mut_r = mut_r - 1 } };
            if (tc > mut_c) { mut_c = mut_c + 1 } else { if (tc < mut_c) { mut_c = mut_c - 1 } };
            if (i + 1 < steps && piece_at(board, sq(mut_r, mut_c)) != EMPTY) return false;
            i = i + 1;
        };
        true
    }

    /// Castling preconditions beyond the one-step king shape.
    fun castle_geometry(pos: &Position, piece: u8, fr: u16, fc: u16, tr: u16, tc: u16): bool {
        let white = piece == W_KING;
        let home_rank: u16 = if (white) 7 else 0;
        if (fr != home_rank || fc != 4) return false;          // king on its e1/e8
        if (!(tr == fr && (tc == 6 || tc == 2))) return false; // two-column king move
        let kingside = tc == 6;
        let rights_bit = if (white) {
            if (kingside) CASTLE_WK else CASTLE_WQ
        } else {
            if (kingside) CASTLE_BK else CASTLE_BQ
        };
        if ((pos.castling & rights_bit) == 0) return false;
        let side = if (white) WHITE else BLACK;
        if (in_check(pos, side)) return false;                 // never out of check
        if (kingside) {
            if (!lane_empty(&pos.board, fr, 5, 6)) return false; // f,g files
        } else {
            if (!lane_empty(&pos.board, fr, 1, 3)) return false; // b,c,d files
        };
        let cross_col: u16 = if (kingside) 5 else 3;           // crossed square must be safe
        let enemy = if (white) BLACK else WHITE;
        if (is_attacked(&pos.board, sq(fr, cross_col), enemy)) return false;
        // The rook must actually be on its home corner.
        let rook_col: u16 = if (kingside) 7 else 0;
        let want_rook = if (white) W_ROOK else B_ROOK;
        piece_at(&pos.board, sq(fr, rook_col)) == want_rook
    }

    fun lane_empty(board: &vector<u8>, rank: u16, from_c: u16, to_c: u16): bool {
        let c = from_c;
        while (c <= to_c) {
            if (piece_at(board, sq(rank, c)) != EMPTY) return false;
            c = c + 1;
        };
        true
    }

    // ------------------------------------------------------------------
    // Move application
    // ------------------------------------------------------------------

    /// Applies a geometry-valid move with every side effect: relocation,
    /// capture, en-passant victim removal, castling rook shift, promotion
    /// placement, castling-rights maintenance, ep-target bookkeeping,
    /// halfmove-clock reset/increment, and side flip.
    public fun apply_move(pos: &Position, from: u8, to_sq: u8, promo: u8): Position {
        let board = pos.board;
        let piece = piece_at(&board, from);
        let captured = piece_at(&board, to_sq);
        let white = color_of(piece) == WHITE;
        let new_castling = pos.castling;
        let fr = row_of(from) as u16;
        let fc = col_of(from) as u16;
        let tr = row_of(to_sq) as u16;
        let tc = col_of(to_sq) as u16;

        // En-passant capture: pawn moved diagonally onto an empty ep square.
        if ((piece == W_PAWN || piece == B_PAWN) && fc != tc && captured == EMPTY) {
            let victim_row: u16 = if (white) tr + 1 else tr - 1;
            set_at(&mut board, victim_row, tc, EMPTY);
        };

        // Relocate (with promotion placement when given).
        set_at(&mut board, fr, fc, EMPTY);
        let placed = if ((piece == W_PAWN || piece == B_PAWN) && promo != 0) {
            let base = if (white) 0 else 8;
            base + promo
        } else {
            piece
        };
        set_at(&mut board, tr, tc, placed);

        // Castling: shift the rook with the two-column king move.
        if ((piece == W_KING || piece == B_KING) && fr == tr && delta(tc, fc) == 2) {
            let rook_from_c: u16 = if (tc == 6) 7 else 0;
            let rook_to_c: u16 = if (tc == 6) 5 else 3;
            let rook = piece_at(&board, sq(fr, rook_from_c));
            set_at(&mut board, fr, rook_from_c, EMPTY);
            set_at(&mut board, fr, rook_to_c, rook);
        };

        // Rights maintenance (bits are disjoint, so subtractive masks are safe).
        let rights = new_castling;
        if (piece == W_KING) { rights = rights & (255 - CASTLE_WK - CASTLE_WQ) };
        if (piece == B_KING) { rights = rights & (255 - CASTLE_BK - CASTLE_BQ) };
        if (from == 63 || to_sq == 63) { rights = rights & (255 - CASTLE_WK) };   // h1
        if (from == 56 || to_sq == 56) { rights = rights & (255 - CASTLE_WQ) };   // a1
        if (from == 7 || to_sq == 7) { rights = rights & (255 - CASTLE_BK) };     // h8
        if (from == 0 || to_sq == 0) { rights = rights & (255 - CASTLE_BQ) };     // a8

        // En-passant target exists only immediately after a double push.
        let new_ep: u8 = if (piece == W_PAWN && fr > tr && delta(fr, tr) == 2) {
            from - 8
        } else {
            if (piece == B_PAWN && tr > fr && delta(fr, tr) == 2) { from + 8 } else { NO_SQUARE }
        };

        // Clock: pawn moves and captures reset it.
        let new_clock: u16 = if (piece == W_PAWN || piece == B_PAWN || captured != EMPTY) {
            0
        } else {
            pos.halfmove_clock + 1
        };

        Position {
            board,
            side_to_move: if (pos.side_to_move == WHITE) BLACK else WHITE,
            castling: rights,
            ep_square: new_ep,
            halfmove_clock: new_clock,
        }
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

    #[test]
    fun test_rook_geometry_blocked() {
        let board = empty_board();
        place(&mut board, 59, W_ROOK); // d1
        place(&mut board, 27, B_PAWN); // d5 blocks the file
        let pos = pos_with(board);
        assert!(validate_geometry(&pos, 59, 56), 0);  // d1-a1 clear rank
        assert!(validate_geometry(&pos, 59, 27), 0);  // capture up to d5
        assert!(!validate_geometry(&pos, 59, 19), 0); // d7 blocked by d5
        assert!(!validate_geometry(&pos, 59, 52), 0); // e2 is diagonal, not rook
    }

    #[test]
    fun test_bishop_geometry() {
        let board = empty_board();
        place(&mut board, 58, W_BISHOP); // c1
        let pos = pos_with(board);
        assert!(validate_geometry(&pos, 58, 30), 0);  // c1-g5
        assert!(validate_geometry(&pos, 58, 23), 0);  // c1-h6 far end
        assert!(validate_geometry(&pos, 58, 40), 0);  // c1-a3 other diagonal
        assert!(!validate_geometry(&pos, 58, 59), 0); // straight line no
        // Obstruction: pawn on d2 blocks both long rays.
        let board2 = empty_board();
        place(&mut board2, 58, W_BISHOP);
        place(&mut board2, 51, B_PAWN); // d2
        let pos2 = pos_with(board2);
        assert!(!validate_geometry(&pos2, 58, 30), 0);
        assert!(validate_geometry(&pos2, 58, 51), 0); // capture the blocker
    }

    #[test]
    fun test_knight_leaps_over_blockers() {
        let board = empty_board();
        place(&mut board, 35, W_KNIGHT); // d4
        // Ring the knight with its own pawns.
        place(&mut board, 26, W_PAWN);
        place(&mut board, 27, W_PAWN);
        place(&mut board, 28, W_PAWN);
        place(&mut board, 34, W_PAWN);
        place(&mut board, 36, W_PAWN);
        place(&mut board, 42, W_PAWN);
        place(&mut board, 43, W_PAWN);
        place(&mut board, 44, W_PAWN);
        let pos = pos_with(board);
        // Knight jumps still work over the wall...
        assert!(validate_geometry(&pos, 35, 20), 0); // e6
        assert!(validate_geometry(&pos, 35, 45), 0); // f3
        // ...but adjacent squares are not knight targets (and hold own pieces).
        assert!(!validate_geometry(&pos, 35, 36), 0);
        assert!(!validate_geometry(&pos, 35, 44), 0);
    }

    #[test]
    fun test_pawn_moves() {
        let board = empty_board();
        place(&mut board, 52, W_PAWN); // e2
        let pos = pos_with(board);
        assert!(validate_geometry(&pos, 52, 44), 0); // e3 single push
        assert!(validate_geometry(&pos, 52, 36), 0); // e4 double push
        assert!(!validate_geometry(&pos, 52, 43), 0); // push onto diagonal no
        // Blocked double push.
        let b2 = empty_board();
        place(&mut b2, 52, W_PAWN);
        place(&mut b2, 44, B_PAWN); // e3 occupied
        let pos2 = pos_with(b2);
        assert!(!validate_geometry(&pos2, 52, 36), 0);
        assert!(!validate_geometry(&pos2, 52, 44), 0); // pushes never capture
        // Capture geometry needs an enemy diagonally ahead.
        let b3 = empty_board();
        place(&mut b3, 52, W_PAWN);
        place(&mut b3, 43, B_PAWN); // d3
        let pos3 = pos_with(b3);
        assert!(validate_geometry(&pos3, 52, 43), 0);
        assert!(!validate_geometry(&pos3, 52, 45), 0); // f3 empty diagonal
        // Black pawn marches the other way.
        let b4 = empty_board();
        place(&mut b4, 12, B_PAWN); // e7
        let pos4 = pos_with(b4);
        pos4.side_to_move = BLACK;
        assert!(validate_geometry(&pos4, 12, 20), 0); // e6
        assert!(validate_geometry(&pos4, 12, 28), 0); // e5 double
        assert!(!validate_geometry(&pos4, 12, 19), 0); // push onto diagonal no
        assert!(!validate_geometry(&pos4, 12, 4), 0);  // never triple
    }

    #[test]
    fun test_en_passant_geometry() {
        let board = empty_board();
        place(&mut board, 28, W_PAWN); // e5
        place(&mut board, 27, B_PAWN); // d5 just double-pushed
        let pos = pos_with(board);
        let with_ep = pos;
        with_ep.ep_square = 19; // d6 target
        assert!(validate_geometry(&with_ep, 28, 19), 0); // e5xd6 ep
        assert!(!validate_geometry(&pos, 28, 19), 0);    // expired: plain empty diag
    }

    #[test]
    fun test_king_steps_and_castling() {
        let board = empty_board();
        place(&mut board, 60, W_KING);
        place(&mut board, 63, W_ROOK);
        place(&mut board, 56, W_ROOK);
        place(&mut board, 4, B_KING);
        let pos = pos_with(board);
        assert!(validate_geometry(&pos, 60, 61), 0); // e1-f1 step
        assert!(validate_geometry(&pos, 60, 62), 0); // O-O: rights + empty f1/g1
        assert!(validate_geometry(&pos, 60, 58), 0); // O-O-O: empty b1/c1/d1
        // Missing rights kill both.
        let p2 = pos_with(board);
        let no_rights = p2;
        no_rights.castling = CASTLE_BK | CASTLE_BQ;
        assert!(!validate_geometry(&no_rights, 60, 62), 0);
        assert!(!validate_geometry(&no_rights, 60, 58), 0);
        // Occupied queenside lane (b1 filled) kills O-O-O only.
        let b2 = empty_board();
        place(&mut b2, 60, W_KING);
        place(&mut b2, 63, W_ROOK);
        place(&mut b2, 56, W_ROOK);
        place(&mut b2, 57, W_KNIGHT);
        place(&mut b2, 4, B_KING);
        let pos3 = pos_with(b2);
        assert!(!validate_geometry(&pos3, 60, 58), 0);
        assert!(validate_geometry(&pos3, 60, 62), 0);
        // In check: no castling either way, but a plain step is fine.
        let b4 = empty_board();
        place(&mut b4, 60, W_KING);
        place(&mut b4, 63, W_ROOK);
        place(&mut b4, 56, W_ROOK);
        place(&mut b4, 52, B_ROOK); // e2 rook checks e1 up the e-file
        place(&mut b4, 4, B_KING);
        let pos4 = pos_with(b4);
        assert!(!validate_geometry(&pos4, 60, 62), 0);
        assert!(!validate_geometry(&pos4, 60, 58), 0);
        assert!(validate_geometry(&pos4, 60, 59), 0); // Kd1 off the file
        // Crossed square attacked kills O-O only (bishop hits f1 via g2).
        let b5 = empty_board();
        place(&mut b5, 60, W_KING);
        place(&mut b5, 63, W_ROOK);
        place(&mut b5, 56, W_ROOK);
        place(&mut b5, 47, B_BISHOP); // h3
        place(&mut b5, 4, B_KING);
        let pos5 = pos_with(b5);
        assert!(!validate_geometry(&pos5, 60, 62), 0);
        assert!(validate_geometry(&pos5, 60, 58), 0);
    }

    #[test]
    fun test_geometry_rejects_bad_squares() {
        let pos = start_position();
        assert!(!validate_geometry(&pos, 52, 52), 0); // same square
        assert!(!validate_geometry(&pos, 36, 27), 0); // empty source (e4)
        assert!(!validate_geometry(&pos, 52, 51), 0); // onto own d2 pawn
        assert!(!validate_geometry(&pos, 12, 44), 0); // black piece while white to move
    }

    #[test]
    fun test_apply_updates_bookkeeping() {
        let pos = start_position();
        // 1. e4: double push sets ep target e3(44), flips side, clock ticks.
        let p1 = apply_move(&pos, 52, 36, 0);
        assert!(p1.side_to_move == BLACK, 0);
        assert!(p1.ep_square == 44, 0);
        assert!(p1.halfmove_clock == 0, 0); // pawn move resets
        assert!(piece_at(&p1.board, 36) == W_PAWN && piece_at(&p1.board, 52) == EMPTY, 0);
        // 1... Nf6: not a pawn, no capture — clock increments again.
        let p2 = apply_move(&p1, 6, 21, 0);
        assert!(p2.halfmove_clock == 1 && p2.side_to_move == WHITE, 0);
        assert!(p2.ep_square == NO_SQUARE, 0);
        // 2. e4-e5 single push: pawn move resets the clock.
        let p3 = apply_move(&p2, 36, 28, 0);
        assert!(p3.halfmove_clock == 0, 0);
        assert!(p3.ep_square == NO_SQUARE, 0); // singles set no ep target
    }

    #[test]
    fun test_apply_capture_resets_clock() {
        let board = empty_board();
        place(&mut board, 59, W_ROOK); // d1
        place(&mut board, 27, B_PAWN); // d5
        place(&mut board, 4, B_KING);
        place(&mut board, 60, W_KING);
        let pos = pos_with(board);
        let clocked = pos;
        clocked.halfmove_clock = 40;
        let after = apply_move(&clocked, 59, 27, 0);
        assert!(after.halfmove_clock == 0, 0);
        assert!(piece_at(&after.board, 27) == W_ROOK, 0);
        assert!(piece_at(&after.board, 59) == EMPTY, 0);
        assert!(after.side_to_move == BLACK, 0);
    }

    #[test]
    fun test_apply_castling_moves_rook_and_clears_rights() {
        let board = empty_board();
        place(&mut board, 60, W_KING);
        place(&mut board, 63, W_ROOK);
        place(&mut board, 4, B_KING);
        let pos = pos_with(board); // castling 15
        let after = apply_move(&pos, 60, 62, 0); // O-O
        assert!(piece_at(&after.board, 62) == W_KING, 0);
        assert!(piece_at(&after.board, 61) == W_ROOK, 0);
        assert!(piece_at(&after.board, 63) == EMPTY && piece_at(&after.board, 60) == EMPTY, 0);
        assert!(after.castling == 12, 0); // white bits cleared, black kept
        // Queenside: king lands c1(58), rook d1(59).
        let b2 = empty_board();
        place(&mut b2, 60, W_KING);
        place(&mut b2, 56, W_ROOK);
        place(&mut b2, 4, B_KING);
        let pos2 = pos_with(b2);
        let qside = apply_move(&pos2, 60, 58, 0);
        assert!(piece_at(&qside.board, 58) == W_KING, 0);
        assert!(piece_at(&qside.board, 59) == W_ROOK, 0);
        assert!(qside.castling == 12, 0);
        // Black kingside mirrors on rank 8.
        let b3 = empty_board();
        place(&mut b3, 4, B_KING);
        place(&mut b3, 7, B_ROOK);
        place(&mut b3, 60, W_KING);
        let pos3 = pos_with(b3);
        let black_turn = pos3;
        black_turn.side_to_move = BLACK;
        let bk = apply_move(&black_turn, 4, 6, 0);
        assert!(piece_at(&bk.board, 6) == B_KING && piece_at(&bk.board, 5) == B_ROOK, 0);
        assert!(bk.castling == 3, 0); // black bits cleared, white kept
    }

    #[test]
    fun test_apply_clears_rights_when_rook_moves_or_captured() {
        // Rook leaving a1 clears only the white queenside bit.
        let board = empty_board();
        place(&mut board, 56, W_ROOK);
        place(&mut board, 60, W_KING);
        place(&mut board, 4, B_KING);
        let pos = pos_with(board);
        let after = apply_move(&pos, 56, 40, 0); // Ra1-a3
        assert!(after.castling == 13, 0);
        // Capturing the white rook ON a1 clears that same bit for black too.
        let b2 = empty_board();
        place(&mut b2, 24, B_QUEEN); // a5
        place(&mut b2, 56, W_ROOK);  // a1
        place(&mut b2, 60, W_KING);
        place(&mut b2, 4, B_KING);
        let pos2 = pos_with(b2);
        let black_turn = pos2;
        black_turn.side_to_move = BLACK;
        let after2 = apply_move(&black_turn, 24, 56, 0);
        assert!(piece_at(&after2.board, 56) == B_QUEEN, 0);
        assert!(after2.castling == 13, 0); // CASTLE_WQ gone
    }

    #[test]
    fun test_apply_promotion_and_ep_capture() {
        // Promotion: white pawn b7(49) -> b8(1) as queen.
        let board = empty_board();
        place(&mut board, 49, W_PAWN);
        place(&mut board, 4, B_KING);
        place(&mut board, 60, W_KING);
        let pos = pos_with(board);
        let after = apply_move(&pos, 49, 1, W_QUEEN - 0);
        assert!(piece_at(&after.board, 1) == W_QUEEN, 0);
        // Black underpromotes to knight (base 8 + 2 = 10).
        let b2 = empty_board();
        place(&mut b2, 9, B_PAWN);  // b2
        place(&mut b2, 60, W_KING);
        place(&mut b2, 4, B_KING);
        let pos2 = pos_with(b2);
        let black_turn = pos2;
        black_turn.side_to_move = BLACK;
        let after2 = apply_move(&black_turn, 9, 1, W_KNIGHT);
        assert!(piece_at(&after2.board, 1) == B_KNIGHT, 0);
        // En passant: white pawn e5(28) x d6 ep removes the d5 pawn (27).
        let b3 = empty_board();
        place(&mut b3, 28, W_PAWN);
        place(&mut b3, 27, B_PAWN);
        place(&mut b3, 4, B_KING);
        place(&mut b3, 60, W_KING);
        let pos3 = pos_with(b3);
        pos3.ep_square = 19;
        let after3 = apply_move(&pos3, 28, 19, 0);
        assert!(piece_at(&after3.board, 19) == W_PAWN, 0);
        assert!(piece_at(&after3.board, 27) == EMPTY, 0);
    }
}
