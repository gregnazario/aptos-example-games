/// Escrow and settlement for arcade games. The only module that moves APT.
module arcade::wager {
    use std::signer;
    use std::string::{Self, String};
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::coin;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::fungible_asset::{Self, FungibleStore, Metadata};
    use aptos_framework::object::{Self, ConstructorRef, ExtendRef};
    use aptos_framework::primary_fungible_store::{Self};
    use aptos_framework::timestamp;
    use std::option;
    use arcade::hub;

    const PHASE_OPEN: u8 = 0;
    const PHASE_IN_PROGRESS: u8 = 1;
    const PHASE_SETTLED: u8 = 2;

    /// Stake must be greater than zero
    const E_ZERO_STAKE: u64 = 1;
    /// Game resource not found at address
    const E_GAME_NOT_FOUND: u64 = 2;
    /// Caller is not allowed for this operation
    const E_NOT_ALLOWED: u64 = 3;
    /// Game is not in the required phase
    const E_WRONG_PHASE: u64 = 4;

    // Event actions
    const ACTION_CREATED: u8 = 1;
    const ACTION_JOINED: u8 = 2;
    const ACTION_SETTLED: u8 = 3;
    const ACTION_CANCELLED: u8 = 4;
    const ACTION_FORFEITED: u8 = 5;

    /// Shared game core. The game object also owns the APT pot store.
    struct Game has key {
        phase: u8,
        kind: u8,
        creator: address,
        player_a: address,
        player_b: address,
        stake: u64,
        last_move_at: u64,
        metadata: String,
        extend_ref: ExtendRef,
        pot_store: address,
        game_events: EventHandle<GameEvent>,
    }

    struct GameEvent has drop, store {
        game: address,
        action: u8,
        actor: address,
        amount: u64,
    }

    /// Creates the game object, its APT pot, and escrows the creator's stake.
    /// Returns the ConstructorRef so the calling game module can attach state.
    public fun create_game(
        creator: &signer,
        kind: u8,
        stake: u64,
        metadata: String,
    ): ConstructorRef {
        assert!(stake > 0, E_ZERO_STAKE);
        let creator_addr = signer::address_of(creator);

        let ctor = object::create_named_object(creator, *string::bytes(&metadata));
        let game_signer = ctor.generate_signer();
        let pot = fungible_asset::create_store(&ctor, apt_metadata());

        move_to(&game_signer, Game {
            phase: PHASE_OPEN,
            kind,
            creator: creator_addr,
            player_a: creator_addr,
            player_b: @0x0,
            stake,
            last_move_at: timestamp::now_seconds(),
            metadata,
            extend_ref: ctor.generate_extend_ref(),
            pot_store: object::object_address(&pot),
            game_events: object::new_event_handle(&game_signer),
        });

        let game_addr = object::object_address(&object::object_from_constructor_ref<Game>(&ctor));
        transfer_in(creator, game_addr, stake);
        hub::list(kind, game_addr);
        emit(game_addr, ACTION_CREATED, creator_addr, stake);
        ctor
    }

    /// Refunds the creator and closes the game. Open phase only.
    public entry fun cancel(creator: &signer, game_addr: address) acquires Game {
        {
            let game = borrow_global_mut<Game>(game_addr);
            assert!(game.phase == PHASE_OPEN, E_WRONG_PHASE);
            assert!(signer::address_of(creator) == game.creator, E_NOT_ALLOWED);
            game.phase = PHASE_SETTLED;
        };
        let balance = pot_balance(game_addr);
        {
            let game = borrow_global<Game>(game_addr);
            let creator_addr = game.creator;
            let kind = game.kind;
            pay_out(game_addr, creator_addr, balance);
            hub::unlist(kind, game_addr);
        };
        emit(game_addr, ACTION_CANCELLED, signer::address_of(creator), balance);
    }

    // --- helpers ---

    /// APT metadata object, resolved through the coin pairing (works on-chain and in tests).
    fun apt_metadata(): object::Object<Metadata> {
        option::extract(&mut coin::paired_metadata<AptosCoin>())
    }

    fun pot_store(game_addr: address): object::Object<FungibleStore> acquires Game {
        object::address_to_object<FungibleStore>(borrow_global<Game>(game_addr).pot_store)
    }

    fun pot_balance(game_addr: address): u64 acquires Game {
        fungible_asset::balance(pot_store(game_addr))
    }

    /// Player-signed deposit from the player's APT primary store into the pot.
    fun transfer_in(player: &signer, game_addr: address, amount: u64) acquires Game {
        let from = primary_fungible_store::primary_store(signer::address_of(player), apt_metadata());
        fungible_asset::transfer(player, from, pot_store(game_addr), amount);
    }

    /// Object-signed payout from the pot to a player's APT primary store.
    fun pay_out(game_addr: address, to: address, amount: u64) acquires Game {
        let object_signer = borrow_global<Game>(game_addr).extend_ref.generate_signer_for_extending();
        let to_store = primary_fungible_store::primary_store(to, apt_metadata());
        fungible_asset::transfer(&object_signer, pot_store(game_addr), to_store, amount);
    }

    fun emit(game_addr: address, action: u8, actor: address, amount: u64) acquires Game {
        let game = borrow_global_mut<Game>(game_addr);
        event::emit_event(&mut game.game_events, GameEvent {
            game: game_addr,
            action,
            actor,
            amount,
        });
    }

    // --- views ---

    #[view]
    public fun game_exists(game_addr: address): bool {
        exists<Game>(game_addr)
    }

    #[view]
    public fun phase(game_addr: address): u8 {
        borrow_global<Game>(game_addr).phase
    }

    #[view]
    public fun kind(game_addr: address): u8 {
        borrow_global<Game>(game_addr).kind
    }

    #[view]
    public fun stake(game_addr: address): u64 {
        borrow_global<Game>(game_addr).stake
    }

    #[view]
    public fun pot(game_addr: address): u64 acquires Game {
        pot_balance(game_addr)
    }

    #[view]
    public fun players(game_addr: address): (address, address) {
        let g = borrow_global<Game>(game_addr);
        (g.player_a, g.player_b)
    }

    /// Called by game modules from their join entry function.
    public(friend) fun join_core(player: &signer, game_addr: address) acquires Game {
        let player_addr = signer::address_of(player);
        {
            let game = borrow_global_mut<Game>(game_addr);
            assert!(game.phase == PHASE_OPEN, E_WRONG_PHASE);
            assert!(player_addr != game.player_a, E_NOT_ALLOWED);
            game.player_b = player_addr;
            game.phase = PHASE_IN_PROGRESS;
            game.last_move_at = timestamp::now_seconds();
            let kind = game.kind;
            let stake = game.stake;
            transfer_in(player, game_addr, stake);
            hub::unlist(kind, game_addr);
        };
        emit(game_addr, ACTION_JOINED, player_addr, 0);
    }

    /// Pays the whole pot to `winner` and closes the game. Friend-only.
    public(friend) fun settle(game_addr: address, winner: address) acquires Game {
        {
            let game = borrow_global_mut<Game>(game_addr);
            assert!(game.phase == PHASE_IN_PROGRESS, E_WRONG_PHASE);
            assert!(winner == game.player_a || winner == game.player_b, E_NOT_ALLOWED);
            game.phase = PHASE_SETTLED;
        };
        let balance = pot_balance(game_addr);
        pay_out(game_addr, winner, balance);
        emit(game_addr, ACTION_SETTLED, winner, balance);
    }

    /// Splits the pot; both players get their stake back.
    public(friend) fun settle_draw(game_addr: address) acquires Game {
        {
            let game = borrow_global_mut<Game>(game_addr);
            assert!(game.phase == PHASE_IN_PROGRESS, E_WRONG_PHASE);
            game.phase = PHASE_SETTLED;
        };
        let (a, b, stake) = {
            let game = borrow_global<Game>(game_addr);
            (game.player_a, game.player_b, game.stake)
        };
        pay_out(game_addr, a, stake);
        pay_out(game_addr, b, pot_balance(game_addr)); // remainder incl. any dust
        emit(game_addr, ACTION_SETTLED, a, 2 * stake);
    }

    /// Games call this on every accepted move.
    public(friend) fun touch(game_addr: address) acquires Game {
        borrow_global_mut<Game>(game_addr).last_move_at = timestamp::now_seconds();
    }

    /// Seconds after `last_move_at` without a move before forfeit can be claimed.
    public fun timeout_seconds(): u64 {
        259_200
    }

    #[view]
    public fun last_move_at(game_addr: address): u64 {
        borrow_global<Game>(game_addr).last_move_at
    }

    #[view]
    public fun time_since_last_move(game_addr: address): u64 {
        timestamp::now_seconds() - borrow_global<Game>(game_addr).last_move_at
    }

    // ------------------------------------------------------------------
    // Test section (Task 3): create / cancel / escrow
    // ------------------------------------------------------------------

    #[test_only]
    use aptos_framework::aptos_account;
    #[test_only]
    use aptos_framework::aptos_coin_tests::mint_apt_fa_to_primary_fungible_store_for_test;
    #[test_only]
    use std::vector;

    #[test_only]
    fun setup_coin_and_player(who: address, amount: u64) {
        aptos_framework::timestamp::set_time_has_started_for_testing(
            &aptos_framework::account::create_signer_for_test(@aptos_framework),
        );
        aptos_framework::aptos_coin::ensure_initialized_with_apt_fa_metadata_for_test();
        aptos_account::create_account(who);
        mint_apt_fa_to_primary_fungible_store_for_test(who, amount);
    }

    #[test_only]
    fun apt_balance(who: address): u64 {
        primary_fungible_store::balance(who, apt_metadata())
    }

    #[test_only]
    fun last_game_address(creator: address, seed: vector<u8>): address {
        object::create_object_address(&creator, seed)
    }

    #[test(creator = @0x1111, deployer = @arcade)]
    fun test_create_escrows_stake(creator: &signer, deployer: &signer) {
        setup_coin_and_player(@0x1111, 10_000_000);
        hub::initialize(deployer);

        let ctor = create_game(creator, 1, 100, string::utf8(b"test"));
        let _ = ctor;
        let game_addr = last_game_address(@0x1111, b"test");
        assert!(phase(game_addr) == 0);
        assert!(pot(game_addr) == 100);
        assert!(apt_balance(@0x1111) == 10_000_000 - 100);
        assert!(vector::length(&hub::open_games(1)) == 1);
    }

    #[test(creator = @0x3333, deployer = @arcade)]
    fun test_cancel_refunds_creator_and_delists(creator: &signer, deployer: &signer) acquires Game {
        setup_coin_and_player(@0x3333, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"c"));
        let _ = ctor;
        let game_addr = last_game_address(@0x3333, b"c");
        assert!(vector::length(&hub::open_games(1)) == 1);
        cancel(creator, game_addr);
        assert!(phase(game_addr) == 2);
        assert!(pot(game_addr) == 0);
        assert!(apt_balance(@0x3333) == 10_000_000);
        assert!(vector::length(&hub::open_games(1)) == 0);
    }

    #[test(creator = @0x2222, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::wager::E_ZERO_STAKE)]
    fun test_create_rejects_zero_stake(creator: &signer, deployer: &signer) {
        setup_coin_and_player(@0x2222, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 0, string::utf8(b"x"));
        let _ = ctor;
    }

    // ------------------------------------------------------------------
    // Task 4: join + settlement
    // ------------------------------------------------------------------

    #[test(creator = @0x4444, opponent = @0x5555, deployer = @arcade)]
    fun test_join_funds_pot_and_starts_game(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        setup_coin_and_player(@0x4444, 10_000_000);
        setup_coin_and_player(@0x5555, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 2, 250, string::utf8(b"j"));
        let _ = ctor;
        let game_addr = last_game_address(@0x4444, b"j");
        assert!(vector::length(&hub::open_games(2)) == 1);

        join_core(opponent, game_addr);
        assert!(phase(game_addr) == 1);
        assert!(pot(game_addr) == 500);
        let (a, b) = players(game_addr);
        assert!(a == @0x4444 && b == @0x5555);
        assert!(apt_balance(@0x5555) == 10_000_000 - 250);
        assert!(vector::length(&hub::open_games(2)) == 0);
    }

    #[test(creator = @0x6666, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::wager::E_NOT_ALLOWED)]
    fun test_join_rejects_creator_as_opponent(creator: &signer, deployer: &signer) acquires Game {
        setup_coin_and_player(@0x6666, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"t"));
        let _ = ctor;
        join_core(creator, last_game_address(@0x6666, b"t"));
    }

    #[test(creator = @0x7777, opponent = @0x8888, deployer = @arcade)]
    fun test_settle_pays_winner_whole_pot(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        setup_coin_and_player(@0x7777, 10_000_000);
        setup_coin_and_player(@0x8888, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 3, 300, string::utf8(b"s"));
        let _ = ctor;
        let game_addr = last_game_address(@0x7777, b"s");
        join_core(opponent, game_addr);
        settle(game_addr, @0x8888);
        assert!(phase(game_addr) == 2);
        assert!(pot(game_addr) == 0);
        assert!(apt_balance(@0x8888) == 10_000_000 - 300 + 600);
        assert!(apt_balance(@0x7777) == 10_000_000 - 300);
    }

    #[test(creator = @0x9999, opponent = @0xAAAA, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::wager::E_WRONG_PHASE)]
    fun test_settle_is_one_shot(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        setup_coin_and_player(@0x9999, 10_000_000);
        setup_coin_and_player(@0xAAAA, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"d"));
        let _ = ctor;
        let game_addr = last_game_address(@0x9999, b"d");
        join_core(opponent, game_addr);
        settle(game_addr, @0x9999);
        settle(game_addr, @0x9999);
    }

    #[test(creator = @0xB1, opponent = @0xB2, deployer = @arcade)]
    fun test_settle_draw_refunds_both(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        setup_coin_and_player(@0xB1, 10_000_000);
        setup_coin_and_player(@0xB2, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"e"));
        let _ = ctor;
        let game_addr = last_game_address(@0xB1, b"e");
        join_core(opponent, game_addr);
        settle_draw(game_addr);
        assert!(phase(game_addr) == 2);
        assert!(pot(game_addr) == 0);
        assert!(apt_balance(@0xB1) == 10_000_000);
        assert!(apt_balance(@0xB2) == 10_000_000);
    }

    #[test(creator = @0xC3, opponent = @0xC4, deployer = @arcade)]
    fun test_touch_updates_last_move_at(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        setup_coin_and_player(@0xC3, 10_000_000);
        setup_coin_and_player(@0xC4, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"m"));
        let _ = ctor;
        let game_addr = last_game_address(@0xC3, b"m");
        join_core(opponent, game_addr);
        aptos_framework::timestamp::fast_forward_seconds(60);
        touch(game_addr);
        assert!(last_move_at(game_addr) >= 60);
    }

    // ------------------------------------------------------------------
    // Task 5: fund invariants I1-I4
    // ------------------------------------------------------------------

    #[test(creator = @0xD1, opponent = @0xD2, deployer = @arcade)]
    fun test_i1_pot_always_covers_settlement(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        // After join the pot is exactly 2*stake and settle pays exactly that.
        setup_coin_and_player(@0xD1, 10_000_000);
        setup_coin_and_player(@0xD2, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"i1"));
        let _ = ctor;
        let game_addr = last_game_address(@0xD1, b"i1");
        join_core(opponent, game_addr);
        assert!(pot(game_addr) == 200);
        settle(game_addr, @0xD1);
        assert!(pot(game_addr) == 0);
        assert!(apt_balance(@0xD1) == 10_000_000 + 100);
        assert!(apt_balance(@0xD2) == 10_000_000 - 100);
    }

    #[test(creator = @0xD3, other = @0xD4, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::wager::E_NOT_ALLOWED)]
    fun test_i2_cancel_rejects_non_creator(
        creator: &signer,
        other: &signer,
        deployer: &signer,
    ) acquires Game {
        setup_coin_and_player(@0xD3, 10_000_000);
        setup_coin_and_player(@0xD4, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"i2"));
        let _ = ctor;
        cancel(other, last_game_address(@0xD3, b"i2"));
    }

    #[test(creator = @0xD5, opponent = @0xD6, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::wager::E_WRONG_PHASE)]
    fun test_i4_cancel_rejected_after_join(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        // Joined games must end via settle/forfeit, never via the refund path.
        setup_coin_and_player(@0xD5, 10_000_000);
        setup_coin_and_player(@0xD6, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"i4"));
        let _ = ctor;
        let game_addr = last_game_address(@0xD5, b"i4");
        join_core(opponent, game_addr);
        cancel(creator, game_addr);
    }

    #[test(creator = @0xD7, opponent = @0xD8, deployer = @arcade)]
    #[expected_failure(abort_code = arcade::wager::E_NOT_ALLOWED)]
    fun test_settle_rejects_outside_winner(
        creator: &signer,
        opponent: &signer,
        deployer: &signer,
    ) acquires Game {
        setup_coin_and_player(@0xD7, 10_000_000);
        setup_coin_and_player(@0xD8, 10_000_000);
        hub::initialize(deployer);
        let ctor = create_game(creator, 1, 100, string::utf8(b"sw"));
        let _ = ctor;
        let game_addr = last_game_address(@0xD7, b"sw");
        join_core(opponent, game_addr);
        settle(game_addr, @0xDA);
    }
}
