module deploy_account::tic_tac_toe {

    use std::string::String;
    use std::vector;
    use std::signer::address_of;
    use aptos_framework::timestamp;
    use aptos_std::simple_map::SimpleMap;
    use aptos_std::simple_map;
    use aptos_framework::system_addresses::is_framework_reserved_address;

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
    /// Index is out of bounds of the board
    const EOUT_OF_BOUNDS: u64 = 12;
    /// Store doesn't exist, please start a game first
    const ESTORE_NOT_FOUND: u64 = 13;
    /// Cannot use framework address as a player
    const EINVALID_ADDRESS: u64 = 14;

    /// Space is empty
    const NONE: u8 = 0;
    /// Player 1 occupies the space
    const X: u8 = 1;
    /// Player 2 occupies the space
    const O: u8 = 2;
    /// Neither player wins
    const DRAW: u8 = 3;

    /// A store for multiple tic-tac-toe boards
    struct TicTacToeStore has key, store, drop {
        games: SimpleMap<String, TicTacToe>,
    }

    /// Holder for tic tac toe information
    struct TicTacToe has store, drop {
        /// The board holding all the marks
        board: vector<u8>,
        /// The next to play
        current_player: u8,
        /// Address of the X player
        x_player: address,
        /// Address of the O player
        o_player: address,
    }

    /// Set up a Tic-tac-toe board which is an 3x3 square with 3 rows of each player
    public entry fun start_game(
        game_signer: &signer,
        game_name: String,
        x_player: address,
        o_player: address
    ) acquires TicTacToeStore {
        assert!(x_player != o_player, ESAME_PLAYER_FOR_BOTH);
        assert!(!is_framework_reserved_address(x_player), EINVALID_ADDRESS);
        assert!(!is_framework_reserved_address(o_player), EINVALID_ADDRESS);
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

        let game_address = address_of(game_signer);

        // Initialize store if it doesn't exist
        if (!exists<TicTacToeStore>(game_address)) {
            move_to(game_signer, TicTacToeStore {
                games: simple_map::create<String, TicTacToe>()
            });
        } else {
            // Check if game already exists
            let store = borrow_global<TicTacToeStore>(game_address);
            assert!(!simple_map::contains_key<String, TicTacToe>(&store.games, &game_name), EGAME_ALREADY_EXISTS);
        };

        let store = borrow_global_mut<TicTacToeStore>(game_address);
        let game = TicTacToe {
            board: spaces,
            current_player,
            x_player,
            o_player
        };

        simple_map::add(&mut store.games, game_name, game);
    }

    /// Removes the game from the account
    public entry fun delete_game(game_signer: &signer, game_name: String) acquires TicTacToeStore {
        let game_address = address_of(game_signer);
        let store = get_store_mut(game_address);
        assert!(simple_map::contains_key(&store.games, &game_name), EGAME_NOT_FOUND);
        simple_map::remove(&mut store.games, &game_name);
    }

    /// Removes the tic-tac-toe store from the account and all associated games
    public entry fun delete_store(game_signer: &signer) acquires TicTacToeStore {
        let game_address = address_of(game_signer);
        assert!(exists<TicTacToeStore>(game_address), ESTORE_NOT_FOUND);
        move_from<TicTacToeStore>(game_address);
    }

    /// Resets the game with the same players, loser goes first
    public entry fun reset_game(signer: &signer, game_address: address, game_name: String) acquires TicTacToeStore {
        let game = get_game_mut(game_address, game_name);

        // If the game address, or one of the players want to reset they can
        let signer_address = address_of(signer);
        assert!(
            signer_address == game_address || signer_address == game.x_player || signer_address == game.o_player,
            EINVALID_RESETTER
        );

        // Can't reset game until game is over
        let winner = evaluate_winner(game);
        assert!(winner != NONE, EGAME_NOT_OVER);

        // Reset all spaces to NONE
        let i = 0;
        while (i < 9) {
            set_space(game, i, NONE);
            i = i + 1;
        };

        // Next player is the loser, unless it's a draw, then whoever would be next
        if (winner == X) {
            game.current_player = O;
        } else if (winner == O) {
            game.current_player = X;
        };
    }

    /// Plays a space in tic-tac-toe, setting the winner at the end
    ///
    public entry fun play_space(
        player: &signer,
        game_address: address,
        game_name: String,
        location: u64
    ) acquires TicTacToeStore {
        // Retrieve game info, and check that it's actually the player's turn
        let game = get_game_mut(game_address, game_name);
        let player_address = address_of(player);

        // Don't let this move happen if there's a winner
        let winner = evaluate_winner(game);
        assert!(winner == NONE, EGAME_OVER);
        let current_player = game.current_player;

        // Ensure it's the player's turn to go
        let next_player = if (player_address == game.x_player) {
            assert!(current_player == X, ENOT_X_PLAYER_TURN);
            O
        } else if (player_address == game.o_player) {
            assert!(current_player == O, ENOT_O_PLAYER_TURN);
            X
        } else {
            abort EINVALID_PLAYER
        };

        // Check someone hasn't already played there
        let space = get_space(game, location);
        assert!(space == NONE, ESPACE_ALREADY_PLAYED);
        // Place the new space
        set_space(game, location, current_player);
        game.current_player = next_player;
    }

    #[view]
    /// Retrieves the whole board for display purposes
    public fun get_board(game_address: address, game_name: String): vector<u8> acquires TicTacToeStore {
        let game = get_game(game_address, game_name);
        game.board
    }

    #[view]
    /// Retrieves the current player.  Returns @0x0 if the game is over
    public fun current_player(game_address: address, game_name: String): (u8, address) acquires TicTacToeStore {
        let game = get_game(game_address, game_name);
        let winner = evaluate_winner(game);
        if (winner != NONE) {
            (NONE, @0)
        } else if (game.current_player == X) {
            (X, game.x_player)
        } else {
            (O, game.o_player)
        }
    }

    #[view]
    /// Retrieves the players, x then o.
    public fun players(game_address: address, game_name: String): (address, address) acquires TicTacToeStore {
        let game = get_game(game_address, game_name);
        (game.x_player, game.o_player)
    }

    #[view]
    /// Views the winner (if any)
    public fun winner(game_address: address, game_name: String): (u8, address) acquires TicTacToeStore {
        let game = get_game(game_address, game_name);
        let winner = evaluate_winner(game);

        if (winner == NONE) {
            (NONE, @0)
        } else if (winner == X) {
            (X, game.x_player)
        } else if (winner == O) {
            (O, game.o_player)
        } else {
            (DRAW, @0)
        }
    }

    inline fun get_store(game_address: address): &TicTacToeStore acquires TicTacToeStore {
        assert!(exists<TicTacToeStore>(game_address), ESTORE_NOT_FOUND);
        borrow_global<TicTacToeStore>(game_address)
    }

    inline fun get_store_mut(game_address: address): &mut TicTacToeStore acquires TicTacToeStore {
        assert!(exists<TicTacToeStore>(game_address), ESTORE_NOT_FOUND);
        borrow_global_mut<TicTacToeStore>(game_address)
    }

    /// Gets the game in a read only capacity, handling errors if not found
    inline fun get_game(game_address: address, game_name: String): &TicTacToe acquires TicTacToeStore {
        let store = get_store(game_address);
        assert!(simple_map::contains_key(&store.games, &game_name), EGAME_NOT_FOUND);
        simple_map::borrow(&store.games, &game_name)
    }

    /// Gets the game in a mutating capacity, handling errors if not found
    inline fun get_game_mut(game_address: address, game_name: String): &mut TicTacToe acquires TicTacToeStore {
        let store = get_store_mut(game_address);
        assert!(simple_map::contains_key(&store.games, &game_name), EGAME_NOT_FOUND);
        simple_map::borrow_mut(&mut store.games, &game_name)
    }

    /// Determine the winner (if any)
    inline fun evaluate_winner(game: &TicTacToe): u8 {
        // Collect all spaces
        let upper_left = vector::borrow(&game.board, 0);
        let upper_mid = vector::borrow(&game.board, 1);
        let upper_right = vector::borrow(&game.board, 2);
        let mid_left = vector::borrow(&game.board, 3);
        let mid_mid = vector::borrow(&game.board, 4);
        let mid_right = vector::borrow(&game.board, 5);
        let lower_left = vector::borrow(&game.board, 6);
        let lower_mid = vector::borrow(&game.board, 7);
        let lower_right = vector::borrow(&game.board, 8);

        // Handle matches
        if (*upper_left != NONE && *upper_left == *upper_mid && *upper_mid == *upper_right) {
            // Upper row
            *upper_left
        } else if (*mid_left != NONE && *mid_left == *mid_mid && *mid_mid == *mid_right) {
            // Mid row
            *mid_left
        } else if (*lower_left != NONE && *lower_left == *lower_mid && *lower_mid == *lower_right) {
            // Lower row
            *lower_left
        } else if (*upper_left != NONE && *upper_left == *mid_left && *mid_left == *lower_left) {
            // Left col
            *upper_left
        } else if (*upper_mid != NONE && *upper_mid == *mid_mid && *mid_mid == *lower_mid) {
            // Mid col
            *upper_mid
        } else if (*upper_right != NONE && *upper_right == *mid_right && *mid_right == *lower_right) {
            // Right col
            *upper_right
        } else if (*upper_left != NONE && *upper_left == *mid_mid && *mid_mid == *lower_right) {
            // Upper left to lower right
            *upper_left
        } else if (*lower_left != NONE && *lower_left == *mid_mid && *mid_mid == *upper_right) {
            // Lower left to upper right
            *upper_mid
        } else if (*upper_left == NONE || *upper_mid == NONE || *upper_right == NONE ||
            *mid_left == NONE || *mid_mid == NONE || *mid_right == NONE ||
            *lower_left == NONE || *lower_mid == NONE || *lower_right == NONE) {
            // If all spaces are filled, game is over (TODO: We can be smarter than this on the draw condition and end early probably)
            NONE
        } else {
            DRAW
        }
    }

    /// Retrieves a space given by an index.
    ///
    /// This allows for varying adjacency schemes of squares on the board.
    inline fun get_space(game: &TicTacToe, index: u64): u8 {
        assert!(index < vector::length(&game.board), EOUT_OF_BOUNDS);
        *vector::borrow(&game.board, index)
    }

    /// Sets a specific space given by an index to the new value.
    inline fun set_space(game: &mut TicTacToe, index: u64, new_value: u8) {
        // Must be within bounds of the fixed size board
        assert!(index < vector::length(&game.board), EOUT_OF_BOUNDS);
        let square = vector::borrow_mut(&mut game.board, index);
        *square = new_value;
    }
}
