/// Wagered chess (phase 1): state, entry points, and settlement wiring on
/// top of the pure `chess_rules` engine. Funds move only through `wager`.
module arcade::chess {
    use std::option::{Self, Option};
    use std::signer;
    use std::string::{Self, String};
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::object::{Self, ConstructorRef};
    use aptos_framework::randomness;
    use aptos_framework::timestamp;
    use arcade::chess_rules::{Self, Position};
    use arcade::wager;

    // Mirrors wager's private PHASE_IN_PROGRESS (client enum keeps the same).
    const PHASE_IN_PROGRESS: u8 = 1;

    // ChessEvent actions.
    const ACTION_MOVED: u8 = 1;
    const ACTION_GAME_OVER: u8 = 2;
    const ACTION_RESIGNED: u8 = 3;
    const ACTION_FORFEIT_CLAIMED: u8 = 4;

    /// Caller is neither player of this game
    const E_NOT_A_PLAYER: u64 = 1;
    /// Game not in progress or caller is not the side to move
    const E_NOT_YOUR_TURN: u64 = 2;
    /// The forfeit window (wager::timeout_seconds) has not elapsed
    const E_TIMEOUT_NOT_REACHED: u64 = 3;
    /// The side to move cannot claim a forfeit against itself
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

    /// Creates a wagered chess game in the standard start position. White to
    /// move; colors are only meaningful once an opponent joins.
    public entry fun create(creator: &signer, stake: u64, metadata: String) {
        let ctor = wager::create_game(creator, wager::KIND_CHESS, stake, metadata);
        let obj_signer = object::generate_signer(&ctor);
        move_to(&obj_signer, State {
            pos: chess_rules::start_position(),
            creator_is_white: true, // placeholder until the join-time flip
            outcome: chess_rules::OUTCOME_ONGOING,
            events: object::new_event_handle(&obj_signer),
        });
    }

    /// Joins and flips for colors: u8_range(0, 2) == 0 means the creator gets
    /// white. Randomness-bearing — clients submit with simulation disabled.
    #[lint::allow_unsafe_randomness]
    public entry fun join(player: &signer, game_addr: address) acquires State {
        wager::join_core(player, game_addr);
        let flip = randomness::u8_range(0, 2);
        borrow_global_mut<State>(game_addr).creator_is_white = flip == 0;
    }

    /// Address of the side to move: the flip bit maps wager's roster to colors.
    public fun current_mover(game_addr: address): address acquires State {
        let (a, b) = wager::players(game_addr);
        let state = borrow_global<State>(game_addr);
        let white = if (state.creator_is_white) a else b;
        let black = if (state.creator_is_white) b else a;
        if (chess_rules::side_to_move(&state.pos) == chess_rules::WHITE) white else black
    }

    fun opponent_of(game_addr: address, who: address): address {
        let (a, b) = wager::players(game_addr);
        if (who == a) b else a
    }

    fun assert_player(game_addr: address, who: address) {
        let (a, b) = wager::players(game_addr);
        assert!(who == a || who == b, E_NOT_A_PLAYER);
    }

    /// Plays a move by the side to move. Aborts with chess_rules codes on an
    /// illegal move or bad promotion argument. On termination settles via
    /// wager: mate pays the mover, draws refund both players.
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
        borrow_global_mut<State>(game_addr).pos = new_pos;
        wager::touch(game_addr);
        emit(game_addr, ACTION_MOVED, player_addr, from, to, promo, 0);
        if (outcome != chess_rules::OUTCOME_ONGOING) {
            finish(game_addr, outcome, player_addr);
        };
    }

    /// Resigns: the pot goes to the opponent immediately.
    public entry fun resign(player: &signer, game_addr: address) acquires State {
        let player_addr = signer::address_of(player);
        assert_player(game_addr, player_addr);
        assert!(wager::phase(game_addr) == PHASE_IN_PROGRESS, E_NOT_YOUR_TURN);
        let winner = opponent_of(game_addr, player_addr);
        finish_by(game_addr, chess_rules::OUTCOME_RESIGNED, player_addr, ACTION_RESIGNED, winner);
        wager::settle(game_addr, winner);
    }

    /// Turn-aware timeout claim: after the wager timeout elapses, only the
    /// player NOT on turn may claim — the staller is the side to move. Pays
    /// the whole pot to the claimant (the generic split-refund timeout in
    /// wager remains reachable as the safety net).
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

    /// Terminal reached through play: mate pays the mover, everything else is
    /// a draw refunded both ways. Emits GAME_OVER alongside wager's settle.
    fun finish(game_addr: address, outcome: u8, winner: address) acquires State {
        borrow_global_mut<State>(game_addr).outcome = outcome;
        emit(game_addr, ACTION_GAME_OVER, winner, 0, 0, 0, outcome);
        if (outcome == chess_rules::OUTCOME_WHITE_MATED || outcome == chess_rules::OUTCOME_BLACK_MATED) {
            wager::settle(game_addr, winner);
        } else {
            wager::settle_draw(game_addr);
        };
    }

    /// Terminal reached by declaration (resign / forfeit): emits the action,
    /// then GAME_OVER naming the winner.
    fun finish_by(
        game_addr: address,
        outcome: u8,
        actor: address,
        action: u8,
        winner: address,
    ) acquires State {
        borrow_global_mut<State>(game_addr).outcome = outcome;
        emit(game_addr, action, actor, 0, 0, 0, outcome);
        emit(game_addr, ACTION_GAME_OVER, winner, 0, 0, 0, outcome);
    }

    fun emit(game_addr: address, action: u8, actor: address, from: u8, to: u8, promo: u8, reason: u8) acquires State {
        let state = borrow_global_mut<State>(game_addr);
        event::emit_event(&mut state.events, ChessEvent {
            game: game_addr,
            action,
            actor,
            from,
            to,
            promo,
            reason,
        });
    }

    // --- views ---

    #[view]
    public fun board(game_addr: address): vector<u8> acquires State {
        chess_rules::board_of(&borrow_global<State>(game_addr).pos)
    }

    #[view]
    public fun state(game_addr: address): (u8, u8, u8, u16, u8, bool) acquires State {
        let s = borrow_global<State>(game_addr);
        (
            chess_rules::side_to_move(&s.pos),
            chess_rules::castling_rights(&s.pos),
            chess_rules::ep_target(&s.pos),
            chess_rules::halfmove_clock(&s.pos),
            s.outcome,
            s.creator_is_white,
        )
    }

    #[view]
    public fun legal_moves_view(game_addr: address, from: Option<u8>): vector<u16> acquires State {
        chess_rules::legal_moves(&borrow_global<State>(game_addr).pos, &from)
    }

    // ==================================================================
    // Tests
    // ==================================================================

    #[test_only]
    use aptos_framework::account;
    #[test_only]
    use aptos_framework::aptos_account;
    #[test_only]
    use aptos_framework::aptos_coin::{Self, AptosCoin};
    #[test_only]
    use aptos_framework::aptos_coin_tests::mint_apt_fa_to_primary_fungible_store_for_test;
    #[test_only]
    use aptos_framework::coin;
    #[test_only]
    use aptos_framework::fungible_asset;
    #[test_only]
    use aptos_framework::primary_fungible_store;
    #[test_only]
    use arcade::hub;
    #[test_only]
    use std::vector;

    #[test_only]
    fun setup_coin_and_player(who: address, amount: u64) {
        aptos_framework::timestamp::set_time_has_started_for_testing(
            &account::create_signer_for_test(@aptos_framework),
        );
        aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        aptos_account::create_account(who);
        mint_apt_fa_to_primary_fungible_store_for_test(who, amount);
    }

    #[test_only]
    fun paired_metadata(): object::Object<fungible_asset::Metadata> {
        option::extract(&mut coin::paired_metadata<AptosCoin>())
    }

    #[test_only]
    fun balance(who: address): u64 {
        primary_fungible_store::balance(who, paired_metadata())
    }

    #[test_only]
    fun object_addr(creator: address, seed: vector<u8>): address {
        object::create_object_address(&creator, seed)
    }

    #[test_only]
    // Deterministic framework signer for randomness test seeding.
    fun framework_signer(): signer {
        account::create_signer_for_test(@aptos_framework)
    }

    #[test(creator = @0xC1, joiner = @0xC2, deployer = @arcade)]
    fun test_create_join_escrow_and_flip_deterministic(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0xC1, 10_000_000);
        setup_coin_and_player(@0xC2, 10_000_000);

        create(creator, 500, string::utf8(b"chess1"));
        let game = object_addr(@0xC1, b"chess1");
        assert!(wager::kind(game) == wager::KIND_CHESS, 0);
        assert!(wager::pot(game) == 500, 0);      // creator escrowed at create
        assert!(vector::length(&hub::open_games(wager::KIND_CHESS)) == 1, 0);

        join(joiner, game);
        assert!(wager::pot(game) == 1000, 0);     // pot fully funded
        assert!(wager::phase(game) == PHASE_IN_PROGRESS, 0);
        assert!(vector::length(&hub::open_games(wager::KIND_CHESS)) == 0, 0);

        // Fixed zero seed makes the flip deterministic; whichever way it
        // lands, the initial mover is one of the two players and start-board
        // views agree with the rules engine.
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

    #[test(creator = @0xD1, stranger = @0xD2, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::chess::E_NOT_A_PLAYER)]
    fun test_stranger_cannot_move(creator: &signer, stranger: &signer, deployer: &signer) {
        hub::initialize(deployer);
        setup_coin_and_player(@0xD1, 10_000_000);
        create(creator, 100, string::utf8(b"solo"));
        move_piece(stranger, object_addr(@0xD1, b"solo"), 52, 36, 0);
    }

    #[test(creator = @0xD3, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::chess::E_NOT_YOUR_TURN)]
    fun test_no_move_before_join(creator: &signer, deployer: &signer) {
        hub::initialize(deployer);
        setup_coin_and_player(@0xD3, 10_000_000);
        create(creator, 100, string::utf8(b"open"));
        move_piece(creator, object_addr(@0xD3, b"open"), 52, 36, 0);
    }

    #[test_only]
    // Drives the scholar's mate line honoring which address holds white.
    fun play_scholars_mate(game: address, white: &signer, black: &signer) acquires State {
        // 1. e4 e5  2. Bc4 Nc6  3. Qh5 Nf6  4. Qxf7#
        move_piece(white, game, 52, 36, 0);
        move_piece(black, game, 12, 28, 0);
        move_piece(white, game, 61, 34, 0);
        move_piece(black, game, 1, 18, 0);
        move_piece(white, game, 59, 31, 0);
        move_piece(black, game, 6, 21, 0);
        move_piece(white, game, 31, 13, 0);
    }

    #[test(creator = @0xE1, joiner = @0xE2, deployer = @arcade)]
    fun test_mate_settles_pot_to_white(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0xE1, 10_000_000);
        setup_coin_and_player(@0xE2, 10_000_000);

        create(creator, 700, string::utf8(b"mate"));
        let game = object_addr(@0xE1, b"mate");
        join(joiner, game);

        let creator_is_white = borrow_global<State>(game).creator_is_white;
        let white_sig = if (creator_is_white) creator else joiner;
        let black_sig = if (creator_is_white) joiner else creator;
        play_scholars_mate(game, white_sig, black_sig);

        assert!(wager::phase(game) == 2, 0); // settled
        assert!(wager::pot(game) == 0, 0);
        // White delivered mate, so white wins the whole pot.
        let white_addr = if (creator_is_white) @0xE1 else @0xE2;
        assert!(balance(white_addr) == 10_000_000 + 700, 0);
        let loser = if (creator_is_white) @0xE2 else @0xE1;
        assert!(balance(loser) == 10_000_000 - 700, 0);
        assert!(borrow_global<State>(game).outcome != chess_rules::OUTCOME_ONGOING, 0);
    }

    #[test(creator = @0xF1, joiner = @0xF2, deployer = @arcade)]
    fun test_resign_settles_to_opponent(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0xF1, 10_000_000);
        setup_coin_and_player(@0xF2, 10_000_000);

        create(creator, 300, string::utf8(b"resign"));
        let game = object_addr(@0xF1, b"resign");
        join(joiner, game);

        resign(creator, game);
        assert!(wager::pot(game) == 0, 0);
        assert!(balance(@0xF2) == 10_000_000 + 300, 0);
        assert!(borrow_global<State>(game).outcome == chess_rules::OUTCOME_RESIGNED, 0);
    }

    #[test(creator = @0x11, joiner = @0x12, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::chess::E_TIMEOUT_NOT_REACHED)]
    fun test_forfeit_claim_before_timeout_aborts(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0x11, 10_000_000);
        setup_coin_and_player(@0x12, 10_000_000);
        create(creator, 400, string::utf8(b"early"));
        let game = object_addr(@0x11, b"early");
        join(joiner, game);
        timestamp::fast_forward_seconds(wager::timeout_seconds() - 1);
        // Whoever is not on turn tries to claim too early.
        let mover = current_mover(game);
        let nonmover_sig: &signer = if (mover == @0x11) joiner else creator;
        claim_forfeit(nonmover_sig, game);
    }

    #[test(creator = @0x13, joiner = @0x14, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::chess::E_CLAIM_OWN_TURN)]
    fun test_mover_cannot_self_claim_forfeit(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0x13, 10_000_000);
        setup_coin_and_player(@0x14, 10_000_000);
        create(creator, 400, string::utf8(b"self"));
        let game = object_addr(@0x13, b"self");
        join(joiner, game);
        timestamp::fast_forward_seconds(wager::timeout_seconds() + 1);
        let mover = current_mover(game);
        let mover_sig: &signer = if (mover == @0x13) creator else joiner;
        claim_forfeit(mover_sig, game);
    }

    #[test(creator = @0x15, joiner = @0x16, deployer = @arcade)]
    fun test_nonmover_claims_whole_pot_with_single_outcome_events(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0x15, 10_000_000);
        setup_coin_and_player(@0x16, 10_000_000);
        create(creator, 400, string::utf8(b"claim"));
        let game = object_addr(@0x15, b"claim");
        join(joiner, game);
        timestamp::fast_forward_seconds(wager::timeout_seconds() + 1);

        let mover = current_mover(game);
        let (nonmover_sig, nonmover): (&signer, address) = if (mover == @0x15) {
            (joiner, @0x16)
        } else {
            (creator, @0x15)
        };
        claim_forfeit(nonmover_sig, game);

        assert!(wager::phase(game) == 2, 0);
        assert!(wager::pot(game) == 0, 0);
        assert!(balance(nonmover) == 10_000_000 + 400, 0);
        assert!(borrow_global<State>(game).outcome == chess_rules::OUTCOME_FORFEITED, 0);
        // Exactly two chess events fired (FORFEIT_CLAIMED + GAME_OVER), and
        // wager settled separately — no stray duplicate outcome event.
        let state = borrow_global<State>(game);
        assert!(event::counter(&state.events) == 2, 0);
        let events = event::emitted_events_by_handle(&state.events);
        let last = vector::borrow(&events, vector::length(&events) - 1);
        assert!(last.action == ACTION_GAME_OVER && last.actor == nonmover, 0);
    }

    #[test(creator = @0x17, joiner = @0x18, deployer = @arcade)]
    fun test_generic_timeout_refunds_both_after_stall(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0x17, 10_000_000);
        setup_coin_and_player(@0x18, 10_000_000);
        create(creator, 250, string::utf8(b"generic"));
        let game = object_addr(@0x17, b"generic");
        join(joiner, game);
        timestamp::fast_forward_seconds(wager::timeout_seconds() + 1);
        // The wager-level central path stays available as the safety net.
        wager::forfeit_timeout(joiner, game);
        assert!(wager::pot(game) == 0, 0);
        assert!(balance(@0x17) == 10_000_000, 0);
        assert!(balance(@0x18) == 10_000_000, 0);
    }

    #[test(creator = @0x19, joiner = @0x1A, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::chess_rules::E_INVALID_MOVE)]
    fun test_illegal_move_aborts_with_rules_code(
        creator: &signer,
        joiner: &signer,
        deployer: &signer,
    ) acquires State {
        randomness::initialize_for_testing(&framework_signer());
        hub::initialize(deployer);
        setup_coin_and_player(@0x19, 10_000_000);
        setup_coin_and_player(@0x1A, 10_000_000);
        create(creator, 100, string::utf8(b"illegal"));
        let game = object_addr(@0x19, b"illegal");
        join(joiner, game);
        // e2-e5 is not a pawn move; whoever is white attempts it.
        let creator_is_white = borrow_global<State>(game).creator_is_white;
        let white_sig: &signer = if (creator_is_white) creator else joiner;
        move_piece(white_sig, game, 52, 28, 0);
    }
}
