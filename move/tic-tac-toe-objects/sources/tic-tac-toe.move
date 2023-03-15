module deploy_account::tic_tac_toe_objects {

    use std::string::String;
    use std::vector;
    use aptos_std::simple_map::{Self, SimpleMap};
    use std::signer::address_of;
    use aptos_framework::timestamp;
    use aptos_framework::system_addresses::is_framework_reserved_address;
    use aptos_framework::object::{Self, Object, ObjectGroup, DeleteRef};

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
    /// Board not found
    const EBOARD_NOT_FOUND: u64 = 15;
    /// Players not found
    const EPLAYERS_NOT_FOUND: u64 = 16;
    /// Metadata not found, please verify that the game address is correct.
    const EMETADATA_NOT_FOUND: u64 = 17;
    /// Game object not found
    const EGAME_OBJECT_NOT_FOUND: u64 = 18;

    /// Space is empty
    const NONE: u8 = 0;
    /// Player 1 occupies the space
    const X: u8 = 1;
    /// Player 2 occupies the space
    const O: u8 = 2;
    /// Neither player wins
    const DRAW: u8 = 3;

    /// Metadata to hold keeping track of all games associated
    ///
    /// This allows us to delete games later to recover storage from running the games.
    struct TicTacToeMetadata has key, drop {
        /// We store the deletion references so we can delete the games afterwards
        game_objects: SimpleMap<String, DeleteRef>
    }

    #[resource_group_member(group = ObjectGroup)]
    /// The tic-tac-toe game
    ///
    /// This is built to show off object groups.  In this case, two pieces are broken down into sub objects.
    ///
    /// TODO: Make this more optimized
    struct TicTacToe has key {
        /// The board holding all the marks
        board: Object<Board>,
        /// The metadata about the current players
        players: Object<Players>
    }

    /// The board represented as a vector
    ///
    /// TODO: Possibly refactor to two u16s
    struct Board has key, drop {
        spaces: vector<u8>
    }

    /// Generates an initial board
    fun generate_board(): Board {
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
        Board {
            spaces
        }
    }

    /// Player metadata
    struct Players has key, drop {
        /// The next to play
        current_player: u8,
        /// Address of the X player
        x_player: address,
        /// Address of the O player
        o_player: address,
    }

    /// Generates an initial players object
    fun generate_players(
        x_player: address,
        o_player: address
    ): Players {
        // Let's at least vary the starting player from X and O
        // TODO: Add better randomness, though it's a simple game
        let current_player = if (0 == timestamp::now_microseconds() % 2) {
            X
        } else {
            O
        };

        Players {
            current_player,
            x_player,
            o_player
        }
    }

    /// Set up a Tic-tac-toe board which is an 3x3 square with 3 rows of each player
    public entry fun start_game(
        game_signer: &signer,
        game_name: String,
        x_player: address,
        o_player: address
    ) acquires TicTacToeMetadata {
        assert!(x_player != o_player, ESAME_PLAYER_FOR_BOTH);
        assert!(!is_framework_reserved_address(x_player), EINVALID_ADDRESS);
        assert!(!is_framework_reserved_address(o_player), EINVALID_ADDRESS);
        let game_address = address_of(game_signer);

        // Create the metadata holder if it doesn't already exist
        if (!exists<TicTacToeMetadata>(game_address)) {
            move_to(game_signer, TicTacToeMetadata {
                game_objects: simple_map::create()
            });
        };

        // If the address already exists, the game already exists
        let metadata = borrow_global_mut<TicTacToeMetadata>(game_address);
        assert!(!simple_map::contains_key(&metadata.game_objects, &game_name), EGAME_ALREADY_EXISTS);

        // Create the game object
        let tic_tac_toe_constructor_ref = object::create_object_from_account(game_signer);
        let tic_tac_toe_signer = object::generate_signer(&tic_tac_toe_constructor_ref);
        object::generate_delete_ref(&tic_tac_toe_constructor_ref);

        // Make the players object
        let players = generate_players(x_player, o_player);
        let players_object = create_object_from_object(players, &tic_tac_toe_signer);

        // Make the board object
        let board = generate_board();
        let board_object = create_object_from_object(board, &tic_tac_toe_signer);

        let tic_tac_toe = TicTacToe {
            players: players_object,
            board: board_object,
        };
        move_to(&tic_tac_toe_signer, tic_tac_toe);
        // Put the game in the object
        let delete_ref = object::generate_delete_ref(&tic_tac_toe_constructor_ref);

        simple_map::add(&mut metadata.game_objects, game_name, delete_ref)
    }

    /// Resets the game with the same players, loser goes first
    public entry fun reset_game(
        signer: &signer,
        game_address: address,
        game_name: String
    ) acquires TicTacToe, Board, Players, TicTacToeMetadata {
        let game = get_game_mut(game_address, game_name);

        // If the game address, or one of the players want to reset they can
        let signer_address = address_of(signer);
        let players = borrow_players_mut(&game.players);

        assert!(
            signer_address == game_address || signer_address == players.x_player || signer_address == players.o_player,
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
            players.current_player = O;
        } else if (winner == O) {
            players.current_player = X;
        };
    }

    /// Deletes a game
    public entry fun delete_game(signer: &signer, game_name: String) acquires TicTacToeMetadata {
        let signer_address = address_of(signer);
        assert!(exists<TicTacToeMetadata>(signer_address), EMETADATA_NOT_FOUND);
        let metadata = borrow_global_mut<TicTacToeMetadata>(signer_address);
        assert!(simple_map::contains_key(&metadata.game_objects, &game_name), EGAME_NOT_FOUND);
        let (_, delete_ref) = simple_map::remove(&mut metadata.game_objects, &game_name);
        object::delete(delete_ref);
    }

    /// Deletes the Game metadata
    public entry fun delete_game_metadata(signer: &signer) acquires TicTacToeMetadata {
        let signer_address = address_of(signer);
        assert!(exists<TicTacToeMetadata>(signer_address), EMETADATA_NOT_FOUND);
        let _ = move_from<TicTacToeMetadata>(signer_address);
    }

    /// Plays a space in tic-tac-toe, setting the winner at the end
    ///
    public entry fun play_space(
        player: &signer,
        game_address: address,
        game_name: String,
        location: u64
    ) acquires TicTacToe, Board, Players, TicTacToeMetadata {
        // Retrieve game info, and check that it's actually the player's turn
        let player_address = address_of(player);
        let game = get_game_mut(game_address, game_name);
        let players = borrow_players_mut(&game.players);

        // Don't let this move happen if there's a winner
        let winner = evaluate_winner(game);
        assert!(winner == NONE, EGAME_OVER);
        let current_player = players.current_player;

        // Ensure it's the player's turn to go
        let next_player = if (player_address == players.x_player) {
            assert!(current_player == X, ENOT_X_PLAYER_TURN);
            O
        } else if (player_address == players.o_player) {
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
        players.current_player = next_player;
    }

    #[view]
    /// Retrieves the whole board for display purposes
    public fun get_board(
        game_address: address,
        game_name: String
    ): vector<u8> acquires TicTacToe, Board, TicTacToeMetadata {
        let game = get_game(game_address, game_name);
        let board = borrow_board(&game.board);
        board.spaces
    }

    #[view]
    /// Retrieves the current player.  Returns @0x0 if the game is over
    public fun current_player(
        game_address: address,
        game_name: String
    ): (u8, address) acquires TicTacToe, Board, Players, TicTacToeMetadata {
        let game = get_game(game_address, game_name);
        let winner = evaluate_winner(game);
        let players = borrow_players(&game.players);
        if (winner != NONE) {
            (NONE, @0)
        } else if (players.current_player == X) {
            (X, players.x_player)
        } else {
            (O, players.o_player)
        }
    }

    #[view]
    /// Retrieves the players, x then o.
    public fun players(
        game_address: address,
        game_name: String
    ): (address, address) acquires TicTacToe, Players, TicTacToeMetadata {
        let game = get_game(game_address, game_name);
        let players = borrow_players(&game.players);
        (players.x_player, players.o_player)
    }

    #[view]
    /// Views the winner (if any)
    public fun winner(
        game_address: address,
        game_name: String
    ): (u8, address) acquires TicTacToe, Players, Board, TicTacToeMetadata {
        let game = get_game(game_address, game_name);
        let winner = evaluate_winner(game);
        let players = borrow_players(&game.players);

        if (winner == NONE) {
            (NONE, @0)
        } else if (winner == X) {
            (X, players.x_player)
        } else if (winner == O) {
            (O, players.o_player)
        } else {
            (DRAW, @0)
        }
    }

    /// Creates a new object
    inline fun create_object_from_object<T: key>(type: T, seed_signer: &signer): Object<T> {
        let construction_ref = object::create_object_from_object(seed_signer);
        let object_signer = object::generate_signer(&construction_ref);
        move_to(&object_signer, type);

        let address = address_of(&object_signer);
        object::address_to_object<T>(address)
    }

    /// Gets the game's object's address
    inline fun get_game_object(
        game_address: &address,
        game_name: &String
    ): Object<TicTacToe> acquires TicTacToeMetadata {
        assert!(exists<TicTacToeMetadata>(*game_address), EMETADATA_NOT_FOUND);
        let metadata = borrow_global_mut<TicTacToeMetadata>(*game_address);
        assert!(simple_map::contains_key(&metadata.game_objects, game_name), EGAME_NOT_FOUND);
        let delete_ref = simple_map::borrow(&mut metadata.game_objects, game_name);
        object::object_from_delete_ref<TicTacToe>(delete_ref)
    }

    /// Gets the game in a read only capacity, handling errors if not found
    inline fun get_game(game_address: address, game_name: String): &TicTacToe acquires TicTacToe, TicTacToeMetadata {
        let game = get_game_object(&game_address, &game_name);
        let object_address = object::object_address(&game);
        assert!(exists<TicTacToe>(object_address), EGAME_OBJECT_NOT_FOUND);
        borrow_global<TicTacToe>(object_address)
    }

    /// Gets the game in a mutating capacity, handling errors if not found
    inline fun get_game_mut(
        game_address: address,
        game_name: String
    ): &mut TicTacToe acquires TicTacToe, TicTacToeMetadata {
        let game = get_game_object(&game_address, &game_name);
        let object_address = object::object_address(&game);
        assert!(exists<TicTacToe>(object_address), EGAME_OBJECT_NOT_FOUND);
        borrow_global_mut<TicTacToe>(object_address)
    }

    inline fun borrow_players(source_object: &Object<Players>): &Players acquires Players {
        let address = object::object_address(source_object);
        assert!(exists<Players>(address), EPLAYERS_NOT_FOUND);
        borrow_global<Players>(address)
    }

    inline fun borrow_players_mut(source_object: &Object<Players>): &mut Players acquires Players {
        let address = object::object_address(source_object);
        assert!(exists<Players>(address), EPLAYERS_NOT_FOUND);
        borrow_global_mut<Players>(address)
    }

    inline fun borrow_board(source_object: &Object<Board>): &Board acquires Board {
        let address = object::object_address(source_object);
        assert!(exists<Board>(address), EBOARD_NOT_FOUND);
        borrow_global<Board>(address)
    }

    inline fun borrow_board_mut(source_object: &Object<Board>): &mut Board acquires Board {
        borrow_global_mut<Board>(object::object_address(source_object))
    }

    // Generics don't work with acquires (this must be a bug)
    //    inline fun borrow_object<T: key>(source_object: &Object<T>): &T acquires T {
    //        borrow_global<T>(object::object_address(source_object))
    //    }

    //    inline fun borrow_mut_object<T: key>(source_object: &Object<T>): &mut T acquires T {
    //        borrow_global_mut<T>(object::object_address(source_object))
    //    }

    /// Determine the winner (if any)
    inline fun evaluate_winner(game: &TicTacToe): u8 acquires Board {
        let address = object::object_address(&game.board);
        assert!(exists<Board>(address), EBOARD_NOT_FOUND);
        let board = borrow_global<Board>(address);
        // Collect all spaces
        let upper_left = vector::borrow(&board.spaces, 0);
        let upper_mid = vector::borrow(&board.spaces, 1);
        let upper_right = vector::borrow(&board.spaces, 2);
        let mid_left = vector::borrow(&board.spaces, 3);
        let mid_mid = vector::borrow(&board.spaces, 4);
        let mid_right = vector::borrow(&board.spaces, 5);
        let lower_left = vector::borrow(&board.spaces, 6);
        let lower_mid = vector::borrow(&board.spaces, 7);
        let lower_right = vector::borrow(&board.spaces, 8);

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
    inline fun get_space(game: &TicTacToe, index: u64): u8 acquires Board {
        let board = borrow_board(&game.board);
        assert!(index < vector::length(&board.spaces), EOUT_OF_BOUNDS);
        *vector::borrow(&board.spaces, index)
    }

    /// Sets a specific space given by an index to the new value.
    inline fun set_space(game: &mut TicTacToe, index: u64, new_value: u8) acquires Board {
        // Must be within bounds of the fixed size board
        let board = borrow_board_mut(&game.board);
        assert!(index < vector::length(&board.spaces), EOUT_OF_BOUNDS);
        let square = vector::borrow_mut(&mut board.spaces, index);
        *square = new_value;
    }
}
