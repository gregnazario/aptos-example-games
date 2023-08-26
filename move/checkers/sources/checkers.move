module deploy_account::checkers {
    use std::vector;
    use std::signer;
    use std::string;

    const RED_KING: u8 = 4;
    const BLACK_KING: u8 = 3;
    const RED: u8 = 2;
    const BLACK: u8 = 1;
    const NONE: u8 = 0;

    const NONE_ADDRESS: address = @0x0;
    const RED_STRING: vector<u8> = b"Red";
    const BLACK_STRING: vector<u8> = b"Black";
    const NONE_STRING: vector<u8> = b"None";

    /// No piece was found at the location
    const ENO_PIECE_AT_LOCATION: u64 = 1;
    /// Location is out of bounds
    const EOUT_OF_BOUNDS: u64 = 2;
    /// Invalid move
    const EINVALID_MOVE: u64 = 3;
    /// Game over
    const EGAME_OVER: u64 = 4;
    /// Not player turn
    const ENOT_PLAYER_TURN: u64 = 5;
    /// Board state is invalid
    const EINVALID_STATE: u64 = 6;
    /// Invalid piece, either an empty space tried to be moved, or the wrong color
    const EINVALID_PIECE: u64 = 7;

    const BOARD_SIZE: u64 = 32;


    struct Board has key {
        player: u8,
        winner: u8,
        red_player: address,
        black_player: address,
        spaces: vector<u8>
    }

    #[view]
    fun game(game_address: address): Board acquires Board {
        let board = borrow_global<Board>(game_address);
        Board {
            player: board.player,
            winner: board.winner,
            red_player: board.red_player,
            black_player: board.black_player,
            spaces: board.spaces
        }
    }

    #[view]
    fun board(game_address: address): string::String acquires Board {
        // TODO: Maybe make some sort of text output?
        let spaces = borrow_global<Board>(game_address).spaces;
        let pretty = string::utf8(b"");

        let i = 0;
        while (i < BOARD_SIZE) {
            let row_number = i / 4;

            // Put in a whole line when at the beginning of a row
            if (left_side_of_board(i)) {
                //string::append_utf8(&mut pretty, b"-----------------\n");
            };

            // If it's the even rows, it needs a space before
            if (row_number % 2 == 0) {
                string::append_utf8(&mut pretty, b"| ")
            };

            // Put piece in
            let space_value = *vector::borrow(&spaces, i);
            let space = if (space_value == NONE) {
                b"| "
            } else if (space_value == RED) {
                b"|r"
            } else if (space_value == BLACK) {
                b"|b"
            } else if (space_value == RED_KING) {
                b"|R"
            } else if (space_value == BLACK_KING) {
                b"|B"
            } else {
                abort EINVALID_STATE
            };
            string::append_utf8(&mut pretty, space);

            // If it's the odd rows, it needs a space after
            if (row_number % 2 == 1) {
                string::append_utf8(&mut pretty, b"| ")
            };

            if (right_side_of_board(i)) {
                // Put in a new line at the end of the line
                string::append_utf8(&mut pretty, b"|\n")
            };
            i = i + 1;
        };

        // Put in the line at the end for good looks
        //string::append_utf8(&mut pretty, b"-----------------");

        pretty
    }

    #[view]
    fun winner(game_address: address): (string::String, address) acquires Board {
        let board = borrow_global<Board>(game_address);
        if (board.winner == NONE) {
            (string::utf8(NONE_STRING), NONE_ADDRESS)
        } else if (board.winner == RED) {
            (string::utf8(RED_STRING), board.red_player)
        } else {
            (string::utf8(BLACK_STRING), board.black_player)
        }
    }

    #[view]
    fun current_player(game_address: address): (string::String, address) acquires Board {
        let board = borrow_global<Board>(game_address);
        if (board.winner != NONE) {
            (string::utf8(NONE_STRING), NONE_ADDRESS)
        } else if (RED == board.player) {
            (string::utf8(RED_STRING), board.red_player)
        } else {
            (string::utf8(BLACK_STRING), board.black_player)
        }
    }

    entry fun create(creator: &signer, black_player: address, red_player: address) {
        let spaces = vector::empty();
        let i = 0;
        let size = BOARD_SIZE;
        while (i < size) {
            if (i < 12) {
                vector::push_back(&mut spaces, RED);
            } else if (i > 19) {
                vector::push_back(&mut spaces, BLACK);
            } else {
                vector::push_back(&mut spaces, NONE);
            };
            i = i + 1;
        };

        let board = Board {
            player: BLACK,
            red_player,
            black_player,
            spaces,
            winner: NONE,
        };

        move_to(creator, board);
    }

    entry fun make_move(
        player: &signer,
        game_address: address,
        location: u64,
        new_location: u64
    ) acquires Board {
        // Fetch board
        let board = borrow_global_mut<Board>(game_address);

        assert!(board.winner == NONE, EGAME_OVER);
        let player_is_red = if (signer::address_of(player) == board.red_player) {
            assert!(board.player == RED, ENOT_PLAYER_TURN);
            true
        } else {
            assert!(board.player == BLACK, ENOT_PLAYER_TURN);
            false
        };

        assert!(location < BOARD_SIZE, EOUT_OF_BOUNDS);
        let space = *vector::borrow(&board.spaces, location);

        assert!(is_occupied(space), ENO_PIECE_AT_LOCATION);

        if (player_is_red) {
            assert!(is_red(space), EINVALID_PIECE);
        } else {
            assert!(is_black(space), EINVALID_PIECE);
        };

        let is_jump = if (is_king(space)) {
            if (valid_jump_up(board, player_is_red, location, new_location) || valid_jump_down(
                board,
                player_is_red,
                location,
                new_location
            )) {
                true
            } else if (valid_step_down(board, location, new_location) || valid_step_down(
                board,
                location,
                new_location
            )) {
                false
            } else {
                abort EINVALID_MOVE
            }
        } else if (player_is_red) {
            if (valid_jump_down(board, player_is_red, location, new_location)) {
                true
            } else if (valid_step_down(board, location, new_location)) {
                false
            } else {
                abort EINVALID_MOVE
            }
        } else {
            if (valid_jump_up(board, player_is_red, location, new_location)) {
                true
            } else if (valid_step_up(board, location, new_location)) {
                false
            } else {
                abort EINVALID_MOVE
            }
        };

        // Move piece
        vector::insert(&mut board.spaces, new_location, space);
        vector::insert(&mut board.spaces, location, NONE);

        // Remove jumped piece
        if (is_jump) {
            if (new_location == location + 7) {
                *vector::borrow_mut(&mut board.spaces, location + 4) = NONE;
            } else if (new_location == location + 9) {
                *vector::borrow_mut(&mut board.spaces, location + 5) = NONE;
            } else if (location >= 7 && new_location == location - 7) {
                *vector::borrow_mut(&mut board.spaces, location - 4) = NONE;
            } else if (location >= 9 && new_location == location - 9) {
                *vector::borrow_mut(&mut board.spaces, location - 5) = NONE;
            }
        };

        // Validate end condition that the other player has no pieces left
        if (!player_has_pieces_left(board, !player_is_red)) {
            if (player_is_red) {
                board.winner = RED;
                board.player = NONE;
            } else {
                board.winner = BLACK;
                board.player = NONE;
            }
        } else {
            if (player_is_red) {
                board.player = BLACK;
            } else {
                board.player = RED;
            }
        }
    }

    inline fun player_has_pieces_left(board: &Board, player_is_red: bool): bool {
        let ret = false;
        let i = 0;
        while (i < BOARD_SIZE) {
            if (player_is_red) {
                if (is_red(*vector::borrow(&board.spaces, i))) {
                    ret = true;
                    break
                }
            } else {
                if (is_black(*vector::borrow(&board.spaces, i))) {
                    ret = true;
                    break
                }
            };
            i = i + 1;
        };

        ret
    }

    fun valid_step_down(board: &Board, location: u64, new_location: u64): bool {
        if (within_board(new_location)) {
            false
        } else if (left_side_of_board(location) && odd_row(location)) {
            step_down_right(board, location, new_location)
        } else if (right_side_of_board(location) && even_row(location)) {
            step_down_left(board, location, new_location)
        } else {
            step_down_right(board, location, new_location) ||
                step_down_left(board, location, new_location)
        }
    }

    fun valid_jump_down(board: &Board, red_player: bool, location: u64, new_location: u64): bool {
        if (within_board(new_location)) {
            false
        } else if (left_side_of_board(location) && odd_row(location)) {
            jump_down_right(board, red_player, location, new_location)
        } else if (right_side_of_board(location) && even_row(location)) {
            jump_down_left(board, red_player, location, new_location)
        } else {
            jump_down_right(board, red_player, location, new_location) ||
                jump_down_left(board, red_player, location, new_location)
        }
    }

    fun valid_step_up(board: &Board, location: u64, new_location: u64): bool {
        if (within_board(new_location) || top_row_of_board(location)) {
            false
        } else if (left_side_of_board(location) && odd_row(location)) {
            step_up_right(board, location, new_location)
        } else if (right_side_of_board(location) && even_row(location)) {
            step_up_left(board, location, new_location)
        } else {
            step_up_right(board, location, new_location) ||
                step_up_left(board, location, new_location)
        }
    }

    fun valid_jump_up(board: &Board, red_player: bool, location: u64, new_location: u64): bool {
        if (within_board(new_location) || top_two_rows_of_board(location)) {
            false
        } else if (left_side_of_board(location) && odd_row(location)) {
            jump_up_right(board, red_player, location, new_location)
        } else if (right_side_of_board(location) && even_row(location)) {
            jump_up_left(board, red_player, location, new_location)
        } else {
            jump_up_right(board, red_player, location, new_location) ||
                jump_up_left(board, red_player, location, new_location)
        }
    }

    inline fun within_board(location: u64): bool {
        location > BOARD_SIZE
    }

    inline fun row(location: u64): u64 {
        location / 4
    }

    inline fun col(location: u64): u64 {
        location % 4
    }

    inline fun top_row_of_board(location: u64): bool {
        row(location) == 0
    }

    inline fun top_two_rows_of_board(location: u64): bool {
        row(location) < 2
    }

    inline fun even_row(location: u64): bool {
        row(location) % 2 == 0
    }

    inline fun odd_row(location: u64): bool {
        row(location) % 2 == 1
    }

    inline fun left_side_of_board(location: u64): bool {
        col(location) == 0
    }

    inline fun right_side_of_board(location: u64): bool {
        col(location) == 3
    }

    inline fun jump_down_right(board: &Board, red_player: bool, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location + 9) && enemy_at_location(board, red_player, location + 5)
    }

    inline fun jump_down_left(board: &Board, red_player: bool, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location + 7) && enemy_at_location(board, red_player, location + 4)
    }

    inline fun jump_up_left(board: &Board, red_player: bool, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location - 9) && enemy_at_location(board, red_player, location - 5)
    }

    inline fun jump_up_right(board: &Board, red_player: bool, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location - 7) && enemy_at_location(board, red_player, location - 4)
    }

    inline fun valid_new_location(board: &Board, new_location: u64, expected_location: u64): bool {
        (expected_location == new_location) && !is_occupied(*vector::borrow(&board.spaces, new_location))
    }

    inline fun enemy_at_location(board: &Board, red_player: bool, location: u64): bool {
        if (red_player) {
            is_black(*vector::borrow(&board.spaces, location))
        } else {
            is_red(*vector::borrow(&board.spaces, location))
        }
    }

    inline fun step_down_right(board: &Board, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location + 5)
    }

    inline fun step_down_left(board: &Board, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location + 4)
    }

    inline fun step_up_right(board: &Board, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location - 4)
    }

    inline fun step_up_left(board: &Board, location: u64, new_location: u64): bool {
        valid_new_location(board, new_location, location - 5)
    }

    inline fun is_black(space: u8): bool {
        space == BLACK || space == BLACK_KING
    }

    inline fun is_red(space: u8): bool {
        space == RED || space == RED_KING
    }

    inline fun is_king(space: u8): bool {
        space == BLACK_KING || space == RED_KING
    }

    inline fun is_occupied(space: u8): bool {
        space != NONE
    }
}
