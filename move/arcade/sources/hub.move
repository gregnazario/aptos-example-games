/// Singleton registry of open games for lobby discovery.
module arcade::hub {
    use std::vector;
    use aptos_framework::object;
    use aptos_framework::simple_map::{Self, SimpleMap};

    friend arcade::wager;

    /// Hub singleton not initialized yet
    const E_NOT_INITIALIZED: u64 = 1;
    /// Game not present in the list being removed, or already listed
    const E_NOT_LISTED: u64 = 2;

    const SEED: vector<u8> = b"arcade-hub";

    /// Hub singleton named object: open game addresses by game kind.
    struct Registry has key {
        open: SimpleMap<u8, vector<address>>,
    }

    /// Deployer call; safe to repeat.
    public fun initialize(deployer: &signer) {
        let addr = object::create_object_address(&signer::address_of(deployer), SEED);
        if (exists<Registry>(addr)) {
            return
        };
        let ctor = object::create_named_object(deployer, SEED);
        let hub_signer = ctor.generate_signer();
        move_to(&hub_signer, Registry {
            open: simple_map::create(),
        });
    }

    /// The canonical hub address, derived from the package account.
    public fun registry_address(): address {
        object::create_object_address(&@arcade, SEED)
    }

    #[view]
    public fun is_initialized(): bool {
        exists<Registry>(registry_address())
    }

    #[view]
    public fun open_games(kind: u8): vector<address> acquires Registry {
        let registry = borrow_global<Registry>(registry_address());
        if (simple_map::contains_key(&registry.open, &kind)) {
            *simple_map::borrow(&registry.open, &kind)
        } else {
            vector::empty()
        }
    }

    public(friend) fun list(kind: u8, game: address) acquires Registry {
        assert!(is_initialized(), E_NOT_INITIALIZED);
        let registry = borrow_global_mut<Registry>(registry_address());
        if (!simple_map::contains_key(&registry.open, &kind)) {
            simple_map::add(&mut registry.open, kind, vector::empty());
        };
        let games = simple_map::borrow_mut(&mut registry.open, &kind);
        let (found, _) = vector::index_of(games, &game);
        assert!(!found, E_NOT_LISTED);
        vector::push_back(games, game);
    }

    public(friend) fun unlist(kind: u8, game: address) acquires Registry {
        assert!(is_initialized(), E_NOT_INITIALIZED);
        let registry = borrow_global_mut<Registry>(registry_address());
        assert!(simple_map::contains_key(&registry.open, &kind), E_NOT_LISTED);
        let games = simple_map::borrow_mut(&mut registry.open, &kind);
        let (found, idx) = vector::index_of(games, &game);
        assert!(found, E_NOT_LISTED);
        vector::remove(games, idx);
    }

    #[test_only]
    use std::signer;

    #[test(deployer = @arcade)]
    fun test_initialize_is_idempotent(deployer: &signer) {
        initialize(deployer);
        assert!(is_initialized());
        initialize(deployer);
        assert!(is_initialized());
    }

    #[test(deployer = @arcade)]
    fun test_list_unlist_roundtrip(deployer: &signer) acquires Registry {
        initialize(deployer);
        list(1, @0x1111);
        list(1, @0x2222);
        assert!(open_games(1) == vector[@0x1111, @0x2222]);
        unlist(1, @0x1111);
        assert!(open_games(1) == vector[@0x2222]);
        unlist(1, @0x2222);
        assert!(open_games(1) == vector<address>[]);
    }
}
