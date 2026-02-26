#[test_only]
module deploy_account::tic_tac_toe_tests {
    use deploy_account::tic_tac_toe;
    use std::string;
    use aptos_framework::timestamp;

    // Mirror constants from the main module
    const NONE: u8 = 0;
    const X: u8 = 1;
    const O: u8 = 2;

    fun setup(aptos_framework: &signer) {
        timestamp::set_time_has_started_for_testing(aptos_framework);
        // After this, now_microseconds() == 0, so 0 % 2 == 0, meaning X goes first
    }

    fun game_name(): string::String {
        string::utf8(b"test_game")
    }

    // ============ Happy Path Tests ============

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_start_game(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_x;
        let _ = player_o;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        let board = tic_tac_toe::get_board(@0xCAFE, game_name());
        for (i in 0..9) {
            assert!(board[i] == NONE, i);
        };
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_play_and_get_board(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_o;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X goes first (timestamp is 0, 0 % 2 == 0 -> X)
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        let board = tic_tac_toe::get_board(@0xCAFE, game_name());
        assert!(board[0] == X, 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_x_wins_top_row(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X goes first. X: 0, O: 3, X: 1, O: 4, X: 2 (top row win)
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 2);

        let (winner, addr) = tic_tac_toe::winner(@0xCAFE, game_name());
        assert!(winner == X, 0);
        assert!(addr == @0x100, 1);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_o_wins_mid_row(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X: 0, O: 3, X: 1, O: 4, X: 6, O: 5 (O wins mid row 3-4-5)
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 6);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 5);

        let (winner, addr) = tic_tac_toe::winner(@0xCAFE, game_name());
        assert!(winner == O, 0);
        assert!(addr == @0x200, 1);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_diagonal_win(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X: 0, O: 1, X: 4, O: 2, X: 8 (diagonal 0-4-8)
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 2);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 8);

        let (winner, _) = tic_tac_toe::winner(@0xCAFE, game_name());
        assert!(winner == X, 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_column_win(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X: 0, O: 1, X: 3, O: 4, X: 6 (left column 0-3-6)
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 6);

        let (winner, _) = tic_tac_toe::winner(@0xCAFE, game_name());
        assert!(winner == X, 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_players_view(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_x;
        let _ = player_o;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        let (x_addr, o_addr) = tic_tac_toe::players(@0xCAFE, game_name());
        assert!(x_addr == @0x100, 0);
        assert!(o_addr == @0x200, 1);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_current_player_view(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_o;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X goes first (timestamp 0 % 2 == 0)
        let (current, addr) = tic_tac_toe::current_player(@0xCAFE, game_name());
        assert!(current == X, 0);
        assert!(addr == @0x100, 1);

        // After X plays, O is current
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        let (current2, addr2) = tic_tac_toe::current_player(@0xCAFE, game_name());
        assert!(current2 == O, 2);
        assert!(addr2 == @0x200, 3);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_winner_none_at_start(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_x;
        let _ = player_o;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        let (winner, _) = tic_tac_toe::winner(@0xCAFE, game_name());
        assert!(winner == NONE, 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_current_player_none_after_win(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X wins top row
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 2);

        let (current, addr) = tic_tac_toe::current_player(@0xCAFE, game_name());
        assert!(current == NONE, 0);
        assert!(addr == @0, 1);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_reset_game_after_win(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X wins top row
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 2);

        // Admin resets the game
        tic_tac_toe::reset_game(game_admin, @0xCAFE, game_name());

        // Board should be empty
        let board = tic_tac_toe::get_board(@0xCAFE, game_name());
        for (i in 0..9) {
            assert!(board[i] == NONE, i);
        };

        // Winner should be NONE
        let (winner, _) = tic_tac_toe::winner(@0xCAFE, game_name());
        assert!(winner == NONE, 100);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    fun test_player_resets_after_win(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = game_admin;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X wins top row
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 2);

        // O player resets (loser can reset)
        tic_tac_toe::reset_game(player_o, @0xCAFE, game_name());

        let (winner, _) = tic_tac_toe::winner(@0xCAFE, game_name());
        assert!(winner == NONE, 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    fun test_delete_game(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);
        tic_tac_toe::delete_game(game_admin, game_name());
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    fun test_delete_store(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);
        tic_tac_toe::delete_store(game_admin);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    fun test_multiple_games(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, string::utf8(b"game1"), @0x100, @0x200);
        tic_tac_toe::start_game(game_admin, string::utf8(b"game2"), @0x300, @0x400);

        let (x1, o1) = tic_tac_toe::players(@0xCAFE, string::utf8(b"game1"));
        let (x2, o2) = tic_tac_toe::players(@0xCAFE, string::utf8(b"game2"));
        assert!(x1 == @0x100 && o1 == @0x200, 0);
        assert!(x2 == @0x300 && o2 == @0x400, 1);
    }

    // ============ Error Path Tests ============

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    #[expected_failure(abort_code = 11, location = deploy_account::tic_tac_toe)]
    fun test_same_player_both_sides(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x100);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    #[expected_failure(abort_code = 9, location = deploy_account::tic_tac_toe)]
    fun test_duplicate_game(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);
        tic_tac_toe::start_game(game_admin, game_name(), @0x300, @0x400);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    #[expected_failure(abort_code = 7, location = deploy_account::tic_tac_toe)]
    fun test_space_already_played(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X plays at 0
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        // O tries to play at 0 (already occupied)
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    #[expected_failure(abort_code = 1, location = deploy_account::tic_tac_toe)]
    fun test_reset_game_not_over(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_x;
        let _ = player_o;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);
        tic_tac_toe::reset_game(game_admin, @0xCAFE, game_name());
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, attacker = @0xEE)]
    #[expected_failure(abort_code = 13, location = deploy_account::tic_tac_toe)]
    fun test_play_nonexistent_store(
        aptos_framework: &signer,
        game_admin: &signer,
        attacker: &signer,
    ) {
        setup(aptos_framework);
        let _ = game_admin;
        tic_tac_toe::play_space(attacker, @0xCAFE, game_name(), 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    #[expected_failure(abort_code = 8, location = deploy_account::tic_tac_toe)]
    fun test_delete_nonexistent_game(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, string::utf8(b"other"), @0x100, @0x200);
        tic_tac_toe::delete_game(game_admin, game_name());
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    #[expected_failure(abort_code = 13, location = deploy_account::tic_tac_toe)]
    fun test_delete_store_not_found(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        let _ = game_admin;
        tic_tac_toe::delete_store(game_admin);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200, stranger = @0xEE)]
    #[expected_failure(abort_code = 3, location = deploy_account::tic_tac_toe)]
    fun test_invalid_player(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
        stranger: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_x;
        let _ = player_o;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);
        tic_tac_toe::play_space(stranger, @0xCAFE, game_name(), 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    #[expected_failure(abort_code = 5, location = deploy_account::tic_tac_toe)]
    fun test_wrong_turn_o_plays_on_x_turn(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        let _ = player_x;
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);
        // X goes first, so O playing first should fail
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 0);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200, stranger = @0xEE)]
    #[expected_failure(abort_code = 10, location = deploy_account::tic_tac_toe)]
    fun test_invalid_resetter(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
        stranger: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X wins top row
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 2);

        // Stranger tries to reset
        tic_tac_toe::reset_game(stranger, @0xCAFE, game_name());
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE, player_x = @0x100, player_o = @0x200)]
    #[expected_failure(abort_code = 6, location = deploy_account::tic_tac_toe)]
    fun test_play_after_game_over(
        aptos_framework: &signer,
        game_admin: &signer,
        player_x: &signer,
        player_o: &signer,
    ) {
        setup(aptos_framework);
        tic_tac_toe::start_game(game_admin, game_name(), @0x100, @0x200);

        // X wins top row
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 0);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 3);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 1);
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 4);
        tic_tac_toe::play_space(player_x, @0xCAFE, game_name(), 2);

        // Try to play after game over
        tic_tac_toe::play_space(player_o, @0xCAFE, game_name(), 5);
    }

    #[test(aptos_framework = @0x1, game_admin = @0xCAFE)]
    #[expected_failure(abort_code = 14, location = deploy_account::tic_tac_toe)]
    fun test_framework_address_player(
        aptos_framework: &signer,
        game_admin: &signer,
    ) {
        setup(aptos_framework);
        // @0xA is a framework reserved address
        tic_tac_toe::start_game(game_admin, game_name(), @0xA, @0x200);
    }
}
