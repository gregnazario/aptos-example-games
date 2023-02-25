module deploy_account::tic_tac_toe {

    use deploy_account::boardgame;
    use std::vector;
    use deploy_account::boardgame::Board;
    use std::signer::address_of;
    use aptos_framework::timestamp;

    /// No winner has won the game, cannot reset the game yet
    const EGAME_NOT_OVER: u64 = 1;
    /// Game is over, but the player requested isn't the winner
    const EPLAYER_NOT_WINNER: u64 = 2;
    /// Invalid player, must choose either X (1) or O (2)
    const EINVALID_PLAYER: u64 = 3;
    /// Not X player's turn
    const ENOT_X_PLAYER_TURN: u64 = 4;
    /// Not O player's turn
    const ENOT_O_PLAYER_TURN: u64 = 5;
    /// Game is over, there's a winner
    const EGAME_OVER: u64 = 6;
    /// Space has already been played
    const ESPACE_ALREADY_PLAYED: u64 = 7;
    /// Game doesn't exist, please start a game first
    const EGAME_NOT_FOUND: u64 = 8;
    /// Game already exists, please finish and delete the old game or reset it
    const EGAME_ALREADY_EXISTS: u64 = 9;
    /// Invalid resetter.  Only the game admin, or one of the players can reset.
    const EINVALID_RESETTER: u64 = 10;
    /// Player is same for X and O.  Please put different players for each.
    const ESAME_PLAYER_FOR_BOTH: u64 = 11;

    /// Space is empty
    const NONE: u8 = 0;
    /// Player 1 occupies the space
    const X: u8 = 1;
    /// Player 2 occupies the space
    const O: u8 = 2;
    /// Neither player wins
    const DRAW: u8 = 3;

    /// Holder for tic tac toe information
    struct TicTacToe has key, drop {
        /// The board holding all the marks
        board: Board<u8>,
        /// The next to play
        current_player: u8,
        /// Address of the X player
        x_player: address,
        /// Address of the O player
        o_player: address,
    }

    /// Set up a Tic-tac-toe board which is an 3x3 square with 3 rows of each player
    public entry fun start_game(game_signer: &signer, x_player: address, o_player: address) {
        assert!(!exists<TicTacToe>(address_of(game_signer)), EGAME_ALREADY_EXISTS);
        assert!(x_player != o_player, ESAME_PLAYER_FOR_BOTH);
        let spaces = vector::empty<u8>();

        // Row 1
        vector::push_back(&mut spaces, NONE);
        vector::push_back(&mut spaces, NONE);
        vector::push_back(&mut spaces, NONE);

        // Row 2
        vector::push_back(&mut spaces, NONE);
        vector::push_back(&mut spaces, NONE);
        vector::push_back(&mut spaces, NONE);

        // Row 3
        vector::push_back(&mut spaces, NONE);
        vector::push_back(&mut spaces, NONE);
        vector::push_back(&mut spaces, NONE);

        // Let's at least vary the starting player from X and O
        // TODO: Add better randomness, though it's a simple game
        let current_player = if (0 == timestamp::now_microseconds() % 2) {
            X
        } else {
            O
        };

        let board = boardgame::new(spaces);
        move_to(game_signer, TicTacToe {
            board,
            current_player,
            x_player,
            o_player
        })
    }

    /// Removes the game from the account
    public entry fun delete_game(game_signer: &signer) acquires TicTacToe {
        let game_address = address_of(game_signer);
        assert!(exists<TicTacToe>(game_address), EGAME_NOT_FOUND);
        move_from<TicTacToe>(game_address);
    }

    /// Resets the game with the same players, loser goes first
    public entry fun reset_game(signer: &signer, game_address: address) acquires TicTacToe {
        assert!(exists<TicTacToe>(game_address), EGAME_NOT_FOUND);

        let game = borrow_global_mut<TicTacToe>(game_address);

        // If the game address, or one of the players want to reset they can
        let signer_address = address_of(signer);
        assert!(signer_address == game_address || signer_address == game.x_player || signer_address == game.o_player, EINVALID_RESETTER);

        // Can't reset game until game is over
        let winner = evaluate_winner(&game.board);
        assert!(winner != NONE, EGAME_NOT_OVER);

        // Reset all spaces to NONE
        let i = 0;
        while (i < 8) {
            boardgame::set_space(&mut game.board, i, NONE);
            i = i + 1;
        };

        // Next player is the loser, unless it's a draw, then whoever would be next
        if (winner == X) {
            game.current_player = O;
        } else if (winner == O){
            game.current_player = X;
        };
    }

    /// Plays a space in tic-tac-toe, setting the winner at the end
    ///
    public entry fun play_space(player: &signer, game_address: address, location: u64) acquires TicTacToe {
        // Retrieve game info, and check that it's actually the player's turn
        assert!(exists<TicTacToe>(game_address), EGAME_NOT_FOUND);

        let player_address = address_of(player);
        let game = borrow_global_mut<TicTacToe>(game_address);

        // Don't let this move happen if there's a winner
        let winner = evaluate_winner(&game.board);
        assert!(winner == NONE, EGAME_OVER);

        // Ensure it's the player's turn to go
        let next_player = if (player_address == game.x_player) {
            assert!(game.current_player == X, ENOT_X_PLAYER_TURN);
            O
        } else if (player_address == game.o_player) {
            assert!(game.current_player == O, ENOT_O_PLAYER_TURN);
            X
        } else {
            abort EINVALID_PLAYER
        };

        // Check someone hasn't already played there
        let space = boardgame::get_space(&game.board, location);
        assert!(space == NONE, ESPACE_ALREADY_PLAYED);

        // Place the new space
        boardgame::set_space(&mut game.board, location, game.current_player);
        game.current_player = next_player;
    }

    #[view]
    /// Retrieves the whole board for display purposes
    public fun get_board(game_address: address): vector<u8> acquires TicTacToe {
        assert!(exists<TicTacToe>(game_address), EGAME_NOT_FOUND);
        let game = borrow_global<TicTacToe>(game_address);
        boardgame::get_board(&game.board)
    }

    #[view]
    /// Retrieves the current player.  Returns @0x0 if the game is over
    public fun current_player(game_address: address): (u8, address) acquires TicTacToe {
        assert!(exists<TicTacToe>(game_address), EGAME_NOT_FOUND);
        let game = borrow_global<TicTacToe>(game_address);
        let winner = evaluate_winner(&game.board);
        if (winner != NONE) {
            (NONE, @0)
        } else if (game.current_player == X) {
            (X, game.x_player)
        } else {
            (O, game.o_player)
        }
    }

    #[view]
    /// Views the winner (if any)
    public fun winner(game_address: address): (u8, address) acquires TicTacToe {
        assert!(exists<TicTacToe>(game_address), EGAME_NOT_FOUND);
        let game = borrow_global<TicTacToe>(game_address);
        let winner = evaluate_winner(&game.board);

        if (winner == NONE) {
            (NONE, @0)
        } else if (winner == X) {
            (X, game.x_player)
        } else if (winner == O){
            (O, game.o_player)
        } else {
            (DRAW, @0)
        }
    }

    /// Determine the winner (if any)
    fun evaluate_winner(board: &Board<u8>): u8 {
        // Collect all spaces
        let spaces = boardgame::get_board(board);
        let upper_left = vector::borrow(&spaces, 0);
        let upper_mid = vector::borrow(&spaces, 1);
        let upper_right = vector::borrow(&spaces, 2);
        let mid_left = vector::borrow(&spaces, 3);
        let mid_mid = vector::borrow(&spaces, 4);
        let mid_right = vector::borrow(&spaces, 5);
        let lower_left = vector::borrow(&spaces, 6);
        let lower_mid = vector::borrow(&spaces, 7);
        let lower_right = vector::borrow(&spaces, 8);

        // Handle matches
        if (*upper_left != NONE && *upper_left == *upper_mid && *upper_mid == *upper_right) {
            // Upper row
            return *upper_left
        } else if (*mid_left != NONE && *mid_left == *mid_mid && *mid_mid == *mid_right) {
            // Mid row
            return *mid_left
        } else if (*lower_left != NONE && *lower_left == *lower_mid && *lower_mid == *lower_right) {
            // Lower row
            return *lower_left
        } else if (*upper_left != NONE && *upper_left == *mid_left && *mid_left == *lower_left) {
            // Left col
            return *upper_left
        } else if (*upper_mid != NONE && *upper_mid == *mid_mid && *mid_mid == *lower_mid) {
            // Mid col
            return *upper_mid
        } else if (*upper_right != NONE && *upper_right == *mid_right && *mid_right == *lower_right) {
            // Right col
            return *upper_right
        } else if (*upper_left != NONE && *upper_left == *mid_mid && *mid_mid == *lower_right) {
            // Upper left to lower right
            return *upper_left
        } else if (*lower_left != NONE && *lower_left == *mid_mid && *mid_mid == *upper_right) {
            // Lower left to upper right
            return *upper_mid
        };

        // If all spaces are filled, game is over (TODO: We can be smarter than this on the draw condition and end early probably)
        if (*upper_left == NONE || *upper_mid == NONE || *upper_right == NONE ||
            *mid_left == NONE || *mid_mid == NONE || *mid_right == NONE ||
            *lower_left == NONE || *lower_mid == NONE || *lower_right == NONE) {
            NONE
        } else {
            DRAW
        }
    }
}
