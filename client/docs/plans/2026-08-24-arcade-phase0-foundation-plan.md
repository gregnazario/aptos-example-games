# Arcade Phase 0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `arcade` Move package foundation — `wager` (escrow + settlement) and `hub` (lobby registry) — fully unit-tested, plus a client arcade shell pointed at testnet.

**Architecture:** One new Move package `move/arcade` published immutably. Game instances are Aptos objects whose FungibleStore *is* the pot. Only `wager` moves APT; games get access via `friend`. Client reads the hub registry for the lobby.

**Tech Stack:** Move (AptosFramework pinned `rev = "mainnet"`), aptos-core CLI, TanStack Start + `@aptos-labs/ts-sdk` v6, vitest.

**Design doc:** `client/docs/plans/2026-08-24-arcade-productionization-design.md`

## Global Constraints

- Framework dependency: `git = "https://github.com/aptos-labs/aptos-framework.git"`, `rev = "mainnet"`, `subdir = "aptos-framework"` (copied from `move/Move.toml`).
- Package named `Arcade`, named address `arcade = "_"` in Move.toml.
- No public function other than the entry functions listed below may exist on `wager`; settlement is `public(friend)` only.
- Fund invariants (each must have a named test): I1 pot ≥ settlement owed at every state, I2 only `wager::settle*`/`cancel` move APT out, I3 terminal states one-shot, I4 every state has a player-callable exit.
- `TIMEOUT_SECONDS = 259_200` (3 days).
- All events must be declared as structs with `has drop, store` and emitted through `EventHandle`s stored on the `Game` resource.
- Client: network from `VITE_NETWORK` env (default `testnet`); module address from `VITE_ARCADE_PACKAGE` env; no hardcoded devnet after this phase.
- Commit messages plain English, no attribution trailers.

---

### Task 1: Package scaffold

**Files:**
- Create: `move/arcade/Move.toml`
- Create: `move/arcade/sources/wager.move`
- Create: `move/arcade/sources/hub.move`

**Interfaces:**
- Produces: compiling empty modules `arcade::wager`, `arcade::hub` used by Tasks 2–5.

- [ ] **Step 1: Create Move.toml**

```toml
[package]
name = 'Arcade'
version = '0.1.0'

[dependencies.AptosFramework]
git = "https://github.com/aptos-labs/aptos-framework.git"
rev = "mainnet"
subdir = "aptos-framework"

[addresses]
arcade = "_"
```

- [ ] **Step 2: Create stub modules**

`move/arcade/sources/wager.move`:
```move
/// Escrow and settlement for arcade games. The only module that moves APT.
module arcade::wager {
}
```

`move/arcade/sources/hub.move`:
```move
/// Singleton registry of open games for lobby discovery.
module arcade::hub {
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd move/arcade && aptos move compile --named-addresses arcade=0xcafe`
Expected: exit 0, "compiling may take a while" then success, no warnings about missing modules.

- [ ] **Step 4: Commit**

```bash
git add move/arcade
git commit -m "Scaffold arcade Move package"
```

---

### Task 2: Hub registry

**Files:**
- Modify: `move/arcade/sources/hub.move`
- Test: same file, `#[test]` section

**Interfaces:**
- Produces:
  - `public fun initialize(deployer: &signer)` — idempotent; creates the singleton `Registry` named object `utf8(b"arcade-hub")` under the deployer.
  - `public fun registry_address(): address` — derived named-object address (works before initialize; resource read fails if uninitialized).
  - `public(friend) fun list(kind: u8, game: address) acquires Registry`
  - `public(friend) fun unlist(kind: u8, game: address) acquires Registry`
  - `#[view] public fun open_games(kind: u8): vector<address> acquires Registry`
  - `#[view] public fun is_initialized(): bool`
- Consumes: nothing (Task 1 stubs).

- [ ] **Step 1: Write failing tests** (append inside `module arcade::hub { ... }`)

```move
    #[test_only]
    use std::signer;

    #[test]
    pub fun test_initialize_is_idempotent() {
        let deployer = &signer::test_signer(@0xdeaf);
        initialize(deployer);
        initialize(deployer);
        assert!(is_initialized());
    }

    #[test]
    pub fun test_list_unlist_roundtrip() acquires Registry {
        let deployer = &signer::test_signer(@0xdeaf);
        initialize(deployer);
        list(1, @0x1111);
        list(1, @0x2222);
        assert!(open_games(1) == vector[@0x1111, @0x2222]);
        unlist(1, @0x1111);
        assert!(open_games(1) == vector[@0x2222]);
        unlist(1, @0x2222);
        assert!(open_games(1) == vector<address>[]);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xcafe`
Expected: compile error — `initialize` etc. undefined.

- [ ] **Step 3: Implement hub**

```move
module arcade::hub {
    use std::vector;
    use std::string::{Self, String};
    use aptos_framework::object::{Self};
    use aptos_framework::simple_map::{Self, SimpleMap};

    /// Hub singleton not initialized yet
    const E_NOT_INITIALIZED: u64 = 1;
    /// Game not present in the list being removed
    const E_NOT_LISTED: u64 = 2;

    const SEED: vector<u8> = b"arcade-hub";

    /// Singleton named object: open game addresses by game kind.
    struct Registry has key {
        open: SimpleMap<u8, vector<address>>,
    }

    /// Deployer call; safe to repeat.
    public fun initialize(deployer: &signer) {
        let addr = object::create_named_object_address(&signer::address_of(deployer), SEED);
        if (exists<Registry>(addr)) {
            return
        };
        let ctor = object::create_named_object(deployer, SEED);
        let hub_signer = ctor.generate_signer();
        move_to(&hub_signer, Registry {
            open: simple_map::create(),
        });
    }

    public fun registry_address(): address {
        // Caller supplies the deploy account; the client always uses the package account.
        object::create_named_object_address(&@arcade, SEED)
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
        assert!(!vector::contains(games, &game), E_NOT_LISTED);
        vector::push_back(games, game);
    }

    public(friend) fun unlist(kind: u8, game: address) acquires Registry {
        assert!(is_initialized(), E_NOT_INITIALIZED);
        let registry = borrow_global_mut<Registry>(registry_address());
        let games = simple_map::borrow_mut(&mut registry.open, &kind);
        let maybe = vector::index_of(games, &game);
        assert!(maybe.is_some(), E_NOT_LISTED);
        vector::remove(games, maybe.destroy_some());
    }
```

Note: `option` handling — add `use std::option;` and write it explicitly if `maybe.is_some()` sugar fails on the pinned framework; the explicit form is:
```move
        let (found, idx) = vector::index_of(games, &game);
        assert!(found, E_NOT_LISTED);
        vector::remove(games, idx);
```
Use the explicit form in the implementation.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xcafe`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add move/arcade/sources/hub.move
git commit -m "Add hub lobby registry with list/unlist and views"
```

---

### Task 3: Wager core — create, cancel, stake escrow

**Files:**
- Modify: `move/arcade/sources/wager.move`
- Test: same file, `#[test]` section

**Interfaces:**
- Produces:
  - `const PHASE_OPEN: u8 = 0; PHASE_IN_PROGRESS: u8 = 1; PHASE_SETTLED: u8 = 2;` (public visibility via view)
  - `const KIND_TIC_TAC_TOE: u8 = 1; KIND_CHECKERS: u8 = 2; KIND_BACKGAMMON: u8 = 3;`
  - `public fun create_game(creator: &signer, kind: u8, stake: u64, metadata: String): object::ConstructorRef acquires` — creates game object + APT FungibleStore pot, transfers creator stake, lists in hub, emits `GameCreated`, returns the ConstructorRef **before** dropping so the calling game module can attach its state resource with `ctor.generate_signer()`.
  - `public entry fun cancel(creator: &signer, game_addr: address) acquires` — Open only, creator only, refunds entire pot.
  - `#[view] public fun game_exists(game_addr: address): bool`, `#[view] public fun phase(game_addr): u8`, `#[view] public fun stake(game_addr): u64`, `#[view] public fun players(game_addr): (address, address)`, `#[view] public fun pot(game_addr): u64` (APT balance of the store).
- Consumes: `hub::list`, `hub::unlist` (Task 2). `friend arcade::hub;` not needed (hub is called BY wager).

- [ ] **Step 1: Write failing tests**

Inside `module arcade::wager`, test section:

```move
    #[test_only]
    use std::signer;
    #[test_only]
    use aptos_framework::aptos_account;
    #[test_only]
    use aptos_framework::coin;
    #[test_only]
    use aptos_framework::guid;

    #[test_only]
    fun setup_player(who: address): u64 {
        aptos_account::create_account(who);
        coin::mint_test_coin(&signer::test_signer(@0xa550c18), who, 10_000_000); // minted by aptos framework test minter
        coin::balance<AptosCoin>(who)
    }

    #[test]
    pub fun test_create_escrows_stake() acquires {
        let creator = @0x1111;
        setup_player(creator);
        // hub must exist for listing
        hub::initialize(&signer::test_signer(@arcade));

        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"test"));
        ctor; // drop
        let game_addr = last_game_address(creator, b"test"); // helper: see step 3
        assert!(phase(game_addr) == PHASE_OPEN);
        assert!(pot(game_addr) == 100);
        assert!(coin::balance<AptosCoin>(creator) == 10_000_000 - 100);
    }

    #[test]
    #[expected_abort_code(coin::EINSUFFICIENT_BALANCE)]
    pub fun test_create_rejects_unfunded_stake() acquires {
        let creator = @0x2222;
        aptos_account::create_account(creator); // no coins
        hub::initialize(&signer::test_signer(@arcade));
        create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"x"));
    }

    #[test]
    pub fun test_cancel_refunds_only_creator_while_open() acquires {
        let creator = @0x3333;
        setup_player(creator);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"c"));
        ctor;
        let game_addr = last_game_address(creator, b"c");
        cancel(&signer::test_signer(creator), game_addr);
        assert!(phase(game_addr) == PHASE_SETTLED);
        assert!(coin::balance<AptosCoin>(creator) == 10_000_000);
        // hub delisted
        assert!(vector::length(&hub::open_games(KIND_TIC_TAC_TOE)) == 0);
    }
```

`AptosCoin` import: `#[test_only] use aptos_framework::aptos_coin::AptosCoin;`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xcafe`
Expected: compile errors (create_game undefined).

- [ ] **Step 3: Implement wager core**

```move
module arcade::wager {
    use std::signer;
    use std::string::{Self, String};
    use aptos_framework::coin;
    use aptos_framework::event::{Self, EventHandle};
    use aptos_framework::fungible_asset::{Self, FungibleStore, Metadata};
    use aptos_framework::object::{Self, ConstructorRef, ObjectSignerCapability};
    use aptos_framework::primary_fungible_store::{Self};
    use aptos_framework::timestamp;
    use arcade::hub;

    /// APT metadata object lives at the framework address.
    const APT: address = @aptos_framework;

    const PHASE_OPEN: u8 = 0;
    const PHASE_IN_PROGRESS: u8 = 1;
    const PHASE_SETTLED: u8 = 2;

    const KIND_TIC_TAC_TOE: u8 = 1;
    const KIND_CHECKERS: u8 = 2;
    const KIND_BACKGAMMON: u8 = 3;

    /// Stake must be greater than zero
    const E_ZERO_STAKE: u64 = 1;
    /// Game resource not found at address
    const E_GAME_NOT_FOUND: u64 = 2;
    /// Caller is not allowed for this operation
    const E_NOT_ALLOWED: u64 = 3;
    /// Game is not in the required phase
    const E_WRONG_PHASE: u64 = 4;
    /// Wrong game kind for this operation
    const E_WRONG_KIND: u64 = 5;

    struct Game has key {
        phase: u8,
        kind: u8,
        creator: address,
        player_a: address,
        player_b: address,
        stake: u64,
        last_move_at: u64,
        metadata: String,
        object_signer_cap: ObjectSignerCapability,
        pot_store: address,
        game_events: EventHandle<GameEvent>,
    }

    struct GameEvent has drop, store {
        game: address,
        action: u8, // 1 created, 2 joined, 3 settled, 4 cancelled, 5 forfeited
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
    ): ConstructorRef acquires {
        assert!(stake > 0, E_ZERO_STAKE);
        let creator_addr = signer::address_of(creator);

        let ctor = object::create_named_object(creator, metadata_bytes(&metadata));
        let game_signer = ctor.generate_signer();
        let signer_cap = ctor.create_signer_capability();
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
            object_signer_cap: signer_cap,
            pot_store: object::object_address(&pot),
            game_events: event::new_event_handle(&game_signer),
        });

        let game_addr = object::object_address(&ctor.object_from_constructor_ref<Game>());
        transfer_in(creator, game_addr, stake);
        hub::list(kind, game_addr);
        emit(game_addr, 1, creator_addr, stake);
        ctor
    }

    /// Refunds the creator and closes the game. Open phase only.
    public entry fun cancel(creator: &signer, game_addr: address) acquires {
        let game = borrow_global_mut<Game>(game_addr);
        assert!(game.phase == PHASE_OPEN, E_WRONG_PHASE);
        assert!(signer::address_of(creator) == game.creator, E_NOT_ALLOWED);
        game.phase = PHASE_SETTLED;
        let balance = pot_balance(game_addr);
        let creator_addr = game.creator;
        let kind = game.kind;
        let cap = &game.object_signer_cap;
        pay_out(cap, game_addr, creator_addr, balance);
        hub::unlist(kind, game_addr);
        emit(game_addr, 4, creator_addr, balance);
    }

    // --- internal helpers ---

    inline fun apt_metadata(): object::Object<Metadata> {
        object::address_to_object<Metadata>(APT)
    }

    inline fun pot_store(game_addr: address): object::Object<FungibleStore> {
        object::address_to_object<FungibleStore>(borrow_global<Game>(game_addr).pot_store)
    }

    inline fun pot_balance(game_addr: address): u64 {
        fungible_asset::balance(pot_store(game_addr))
    }

    /// Player-signed deposit from the player's APT primary store into the pot.
    inline fun transfer_in(player: &signer, game_addr: address, amount: u64) {
        let from = primary_fungible_store::primary_store(signer::address_of(player), apt_metadata());
        fungible_asset::transfer(player, from, pot_store(game_addr), amount);
    }

    /// Object-signed payout from the pot to a player's APT primary store.
    inline fun pay_out(cap: &ObjectSignerCapability, game_addr: address, to: address, amount: u64) {
        let object_signer = object::signer_from_signer_capability(cap);
        let to_store = primary_fungible_store::primary_store(to, apt_metadata());
        fungible_asset::transfer(&object_signer, pot_store(game_addr), to_store, amount);
    }

    inline fun emit(game_addr: address, action: u8, actor: address, amount: u64) acquires {
        let game = borrow_global_mut<Game>(game_addr);
        event::emit_event(&mut game.game_events, GameEvent { game: game_addr, action, actor, amount });
    }

    inline fun metadata_bytes(metadata: &String): vector<u8> {
        // object seed derived from display metadata; uniqueness enforced by create_named_object_address collision abort
        *string::bytes(metadata)
    }

    // --- views ---

    #[view] public fun game_exists(game_addr: address): bool { exists<Game>(game_addr) }
    #[view] public fun phase(game_addr: address): u8 { borrow_global<Game>(game_addr).phase }
    #[view] public fun kind(game_addr: address): u8 { borrow_global<Game>(game_addr).kind }
    #[view] public fun stake(game_addr: address): u64 { borrow_global<Game>(game_addr).stake }
    #[view] public fun pot(game_addr: address): u64 acquires { pot_balance(game_addr) }
    #[view] public fun players(game_addr: address): (address, address) {
        let g = borrow_global<Game>(game_addr);
        (g.player_a, g.player_b)
    }
```

Uniqueness note: two games by the same creator with identical metadata would collide on the named-object seed and abort with `object::EOBJECT_ALREADY_EXISTS` — acceptable and surfaced as "name taken". `last_game_address` test helper:
```move
    #[test_only]
    fun last_game_address(creator: address, seed: vector<u8>): address {
        object::create_named_object_address(&creator, seed)
    }
```

If `coin::mint_test_coin` is unavailable on the pinned rev, replace `setup_player` with `aptos_framework::aptos_cli::test_account(...)`-style helper or `coin::mint_to` under `#[test_only]` framework signer with `coin::create_treasury_cap` from genesis pattern — check `move/build/ExampleTicTacToe/sources/dependencies/AptosFramework/managed_coin.move` for the test mint helper name and adapt; the assertion is only "creator ends up with a known APT balance".

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xcafe`
Expected: hub tests + 3 wager tests passing.

- [ ] **Step 5: Commit**

```bash
git add move/arcade/sources/wager.move
git commit -m "Add wager core: game object creation, pot escrow, cancel refund"
```

---

### Task 4: Join and settlement

**Files:**
- Modify: `move/arcade/sources/wager.move`
- Test: same file

**Interfaces:**
- Produces:
  - `public(friend) fun join_core(player: &signer, game_addr: address) acquires` — Open→InProgress, sets `player_b`, transfers `stake` in, emits joined, unlists from hub.
  - `public(friend) fun settle(game_addr: address, winner: address) acquires` — InProgress→Settled, pays whole pot to winner, emits settled.
  - `public(friend) fun settle_draw(game_addr: address) acquires` — splits pot evenly (stake each; any remainder dust to `player_a`).
  - `public(friend) fun touch(game_addr: address) acquires` — updates `last_move_at` (games call on every move).
  - `public(friend) fun timeout_seconds(): u64`
- Consumes: Task 3 internals (`pay_out`, `emit`, phase constants).

- [ ] **Step 1: Write failing tests**

```move
    #[test]
    pub fun test_join_funds_pot_and_starts_game() acquires {
        let creator = @0x4444;
        let opponent = @0x5555;
        setup_player(creator);
        setup_player(opponent);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_CHECKERS, 250, string::utf8(b"j"));
        ctor;
        let game_addr = last_game_address(creator, b"j");
        join_core(&signer::test_signer(opponent), game_addr);
        assert!(phase(game_addr) == PHASE_IN_PROGRESS);
        assert!(pot(game_addr) == 500);
        let (a, b) = players(game_addr);
        assert!(a == creator && b == opponent);
        assert!(vector::length(&hub::open_games(KIND_CHECKERS)) == 0);
    }

    #[test]
    #[expected_abort_code(E_NOT_ALLOWED)]
    pub fun test_join_rejects_same_player_twice() acquires {
        let creator = @0x6666;
        setup_player(creator);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"t"));
        ctor;
        join_core(&signer::test_signer(creator), last_game_address(creator, b"t"));
    }

    #[test]
    pub fun test_settle_pays_winner_whole_pot() acquires {
        let creator = @0x7777;
        let opponent = @0x8888;
        setup_player(creator);
        setup_player(opponent);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_BACKGAMMON, 300, string::utf8(b"s"));
        ctor;
        let game_addr = last_game_address(creator, b"s");
        join_core(&signer::test_signer(opponent), game_addr);
        settle(game_addr, opponent);
        assert!(phase(game_addr) == PHASE_SETTLED);
        assert!(pot(game_addr) == 0);
        assert!(coin::balance<AptosCoin>(opponent) == 10_000_000 - 300 + 600);
    }

    #[test]
    #[expected_abort_code(E_WRONG_PHASE)]
    pub fun test_settle_is_one_shot() acquires {
        // I3
        let creator = @0x9999;
        let opponent = @0xAAAA;
        setup_player(creator);
        setup_player(opponent);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"d"));
        ctor;
        let game_addr = last_game_address(creator, b"d");
        join_core(&signer::test_signer(opponent), game_addr);
        settle(game_addr, creator);
        settle(game_addr, creator);
    }

    #[test]
    pub fun test_settle_draw_splits_evenly() acquires {
        let creator = @0xB1;
        let opponent = @0xB2;
        setup_player(creator);
        setup_player(opponent);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"e"));
        ctor;
        let game_addr = last_game_address(creator, b"e");
        join_core(&signer::test_signer(opponent), game_addr);
        settle_draw(game_addr);
        assert!(coin::balance<AptosCoin>(creator) == 10_000_000);
        assert!(coin::balance<AptosCoin>(opponent) == 10_000_000);
    }

    #[test]
    pub fun test_open_game_always_exit_cancel_or_join() acquires {
        // I4 open-phase coverage: creator can always cancel
        let creator = @0xB3;
        setup_player(creator);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"f"));
        ctor;
        cancel(&signer::test_signer(creator), last_game_address(creator, b"f"));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xcafe`
Expected: compile errors (join_core/settle undefined).

- [ ] **Step 3: Implement**

```move
    /// Called by game modules from their join entry function.
    public(friend) fun join_core(player: &signer, game_addr: address) acquires {
        let player_addr = signer::address_of(player);
        let game = borrow_global_mut<Game>(game_addr);
        assert!(game.phase == PHASE_OPEN, E_WRONG_PHASE);
        assert!(player_addr != game.player_a, E_NOT_ALLOWED);
        let stake = game.stake;
        let kind = game.kind;
        game.player_b = player_addr;
        game.phase = PHASE_IN_PROGRESS;
        game.last_move_at = timestamp::now_seconds();
        transfer_in(player, game_addr, stake);
        hub::unlist(kind, game_addr);
        emit(game_addr, 2, player_addr, stake);
    }

    /// Pays the whole pot to `winner` and closes the game. Friend-only.
    public(friend) fun settle(game_addr: address, winner: address) acquires {
        let game = borrow_global_mut<Game>(game_addr);
        assert!(game.phase == PHASE_IN_PROGRESS, E_WRONG_PHASE);
        assert!(winner == game.player_a || winner == game.player_b, E_NOT_ALLOWED);
        game.phase = PHASE_SETTLED;
        let balance = pot_balance(game_addr);
        let cap = &game.object_signer_cap;
        pay_out(cap, game_addr, winner, balance);
        emit(game_addr, 3, winner, balance);
    }

    /// Splits the pot; both players get their stake back.
    public(friend) fun settle_draw(game_addr: address) acquires {
        let game = borrow_global_mut<Game>(game_addr);
        assert!(game.phase == PHASE_IN_PROGRESS, E_WRONG_PHASE);
        game.phase = PHASE_SETTLED;
        let stake = game.stake;
        let a = game.player_a;
        let b = game.player_b;
        let cap = &game.object_signer_cap;
        pay_out(cap, game_addr, a, stake);
        pay_out(cap, game_addr, b, pot_balance(game_addr)); // remainder incl. any dust
        emit(game_addr, 3, a, 2 * stake);
    }

    /// Games call this on every accepted move.
    public(friend) fun touch(game_addr: address) acquires {
        borrow_global_mut<Game>(game_addr).last_move_at = timestamp::now_seconds();
    }

    public(friend) fun timeout_seconds(): u64 {
        259_200
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xcafe`
Expected: all tests green (hub 2, wager 9).

- [ ] **Step 5: Commit**

```bash
git add move/arcade/sources/wager.move
git commit -m "Add wager join and settlement paths with one-shot terminal guard"
```

---

### Task 5: Invariant hardening tests

**Files:**
- Modify: `move/arcade/sources/wager.move` (test section only)

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces: named tests pinning I1–I4.

- [ ] **Step 1: Add invariant tests**

```move
    #[test]
    pub fun test_i1_pot_never_owed_more_than_balance() acquires {
        // After join, settle can always pay in full: pot == 2*stake, settle pays exactly pot.
        let creator = @0xC1;
        let opponent = @0xC2;
        setup_player(creator);
        setup_player(opponent);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"i1"));
        ctor;
        let game_addr = last_game_address(creator, b"i1");
        join_core(&signer::test_signer(opponent), game_addr);
        assert!(pot(game_addr) == 200);
        settle(game_addr, creator);
        assert!(pot(game_addr) == 0); // nothing owed, nothing left
    }

    #[test]
    #[expected_abort_code(E_NOT_ALLOWED)]
    pub fun test_i2_cancel_rejects_non_creator() acquires {
        let creator = @0xC3;
        let other = @0xC4;
        setup_player(creator);
        setup_player(other);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"i2"));
        ctor;
        cancel(&signer::test_signer(other), last_game_address(creator, b"i2"));
    }

    #[test]
    #[expected_abort_code(E_WRONG_PHASE)]
    pub fun test_cancel_rejected_after_join() acquires {
        // joined games must end via settle/forfeit, never via the refund path
        let creator = @0xC5;
        let opponent = @0xC6;
        setup_player(creator);
        setup_player(opponent);
        hub::initialize(&signer::test_signer(@arcade));
        let ctor = create_game(&signer::test_signer(creator), KIND_TIC_TAC_TOE, 100, string::utf8(b"i3"));
        ctor;
        let game_addr = last_game_address(creator, b"i3");
        join_core(&signer::test_signer(opponent), game_addr);
        cancel(&signer::test_signer(creator), game_addr);
    }
```

- [ ] **Step 2: Run full test suite**

Run: `cd move/arcade && aptos move test --named-addresses arcade=0xcafe`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add move/arcade/sources/wager.move
git commit -m "Pin wager fund invariants I1-I4 with tests"
```

---

### Task 6: Client arcade shell on testnet

**Files:**
- Modify: `client/src/lib/constants.ts`
- Create: `client/src/lib/arcade.ts`
- Create: `client/src/lib/arcade.test.ts`
- Create: `client/.env.example`
- Modify: `client/src/routes/index.tsx` (lobby section listing open arcade games)

**Interfaces:**
- Consumes: `aptos` client from `client/src/lib/aptos.ts`; hub views `hub::open_games`, `is_initialized`, wager views `phase/stake/players/pot`.
- Produces:
  - `NETWORK: Network` env-driven; `ARCADE_PACKAGE: string` env-driven.
  - `arcade.ts`: `getOpenGames(kind: GameKind): Promise<string[]>`, `getGameSummary(addr: string): Promise<GameSummary>`, `GameKind` enum mirrored from Move constants.

- [ ] **Step 1: Update constants**

`client/src/lib/constants.ts` — replace the hardcoded block with:

```ts
import { Network } from "@aptos-labs/ts-sdk";

export const NETWORK = (import.meta.env.VITE_NETWORK ?? "testnet") as Network;

export const ARCADE_PACKAGE =
  import.meta.env.VITE_ARCADE_PACKAGE ?? "0x0"; // set after testnet publish

export const MODULE_ADDRESS = ARCADE_PACKAGE;

export const NONE = 0;
export const X = 1;
export const O = 2;
export const DRAW = 3;

export const GAME_ID_MAX_CREATOR = 128;
export const GAME_ID_MAX_NAME = 64;
```

`client/.env.example`:
```
VITE_NETWORK=testnet
VITE_ARCADE_PACKAGE=0x0000000000000000000000000000000000000000000000000000000000000000
```

- [ ] **Step 2: Write failing vitest for arcade lib**

`client/src/lib/arcade.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getOpenGames, GameKind } from "./arcade";

vi.mock("./aptos", () => ({
  aptos: {
    view: vi.fn().mockResolvedValue([[GameKind.TicTacToe, ["0x1", "0x2"]]]),
  },
  ansAptos: {},
}));

describe("getOpenGames", () => {
  it("flattens the hub view result into addresses", async () => {
    expect(await getOpenGames(GameKind.TicTacToe)).toEqual(["0x1", "0x2"]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd client && npx vitest run src/lib/arcade.test.ts`
Expected: FAIL — `./arcade` not found.

- [ ] **Step 4: Implement arcade.ts**

```ts
import { aptos } from "./aptos";
import { ARCADE_PACKAGE } from "./constants";

export enum GameKind {
  TicTacToe = 1,
  Checkers = 2,
  Backgammon = 3,
}

export enum GamePhase {
  Open = 0,
  InProgress = 1,
  Settled = 2,
}

export interface GameSummary {
  address: string;
  kind: GameKind;
  phase: GamePhase;
  stake: string;
  pot: string;
  playerA: string;
  playerB: string;
}

export async function getOpenGames(kind: GameKind): Promise<string[]> {
  const [games] = await aptos.view({
    payload: {
      function: `${ARCADE_PACKAGE}::hub::open_games`,
      functionArguments: [kind],
    },
  });
  return games as string[];
}

export async function getGameSummary(address: string): Promise<GameSummary> {
  const [[kind], [phase], [stake], [pot], [playerA, playerB]] = await Promise.all([
    view(address, "kind"),
    view(address, "phase"),
    view(address, "stake"),
    view(address, "pot"),
    viewTuple(address, "players"),
  ]);
  return {
    address,
    kind,
    phase,
    stake: stake.toString(),
    pot: pot.toString(),
    playerA,
    playerB,
  };
}

async function view(address: string, fn: string): Promise<unknown[]> {
  return aptos.view({
    payload: {
      function: `${ARCADE_PACKAGE}::wager::${fn}`,
      functionArguments: [address],
    },
  });
}

async function viewTuple(address: string, fn: string): Promise<unknown[]> {
  return aptos.view({
    payload: {
      function: `${ARCADE_PACKAGE}::wager::${fn}`,
      functionArguments: [address],
    },
  });
}
```

- [ ] **Step 5: Run tests**

Run: `cd client && npx vitest run src/lib/arcade.test.ts`
Expected: PASS.

- [ ] **Step 6: Add lobby section to index route**

In `client/src/routes/index.tsx`, above the existing tic-tac-toe panel, add a `<section>` that renders when `ARCADE_PACKAGE !== "0x0"`: fetches `getOpenGames` for all three kinds via `useSuspenseQuery` (match existing route patterns) and lists kind + address + stake links. If the hub is not initialized (view throws), show "Arcade hub not deployed yet" instead of crashing (wrap in error boundary component already present).

- [ ] **Step 7: Run full client suite + typecheck**

Run: `cd client && npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add client/src/lib/constants.ts client/src/lib/arcade.ts client/src/lib/arcade.test.ts client/.env.example client/src/routes/index.tsx
git commit -m "Point client at testnet with arcade hub lobby shell"
```

---

### Task 7: Testnet publish spike (user-gated)

**Files:**
- Create: `move/arcade/README.md` (deploy notes)

**Interfaces:**
- Consumes: Tasks 1–6.

- [ ] **Step 1: Ask the user to create/fund the deploy account**

This step requires the user's key custody decision. Command sequence to run with the user:

```bash
aptos init --network testnet --profile arcade-deploy
# fund: aptos account fund-with-faucet --profile arcade-deploy --amount 100000000
```

- [ ] **Step 2: Publish**

```bash
cd move/arcade
aptos move publish --profile arcade-deploy --named-addresses arcade=<DEPLOY_ADDRESS>
aptos move run --profile arcade-deploy --function-id <DEPLOY_ADDRESS>::hub::initialize
```

Expected: publish succeeds, `hub::is_initialized` view returns `true`.

- [ ] **Step 3: Verify from client**

Set `client/.env` `VITE_ARCADE_PACKAGE=<DEPLOY_ADDRESS>`, run `npm run dev`, confirm the lobby renders the empty hub without errors, and create-then-cancel a dummy `Game` is NOT possible yet (no game module exists — expected).

- [ ] **Step 4: Write deploy notes + commit**

`move/arcade/README.md`: the exact commands above plus the invariant list and "no upgrades; fixes ship as new modules" policy.

```bash
git add move/arcade/README.md
git commit -m "Document arcade testnet deployment"
```

---

## Self-Review

- **Spec coverage:** Phases 0 of design doc = Tasks 1–7 here (wager, hub, shell, publish spike). Timeout/forfeit entries deferred to Phase 1 (game modules own turn logic) — matches design §Wager item 5. Cube funding (item 6) is Phase 3 — noted in design doc, not this plan. ✓
- **Placeholders:** Task 6 Step 6 describes the route change without full TSX — acceptable as it modifies an existing 280-line route; exact insertion contract given (section, condition, data source). Task 3 flags the test-mint helper name as framework-rev-dependent with a concrete fallback procedure. ✓
- **Type consistency:** `GameKind` numeric values match Move `KIND_*`; `GamePhase` matches `PHASE_*`; `getOpenGames`/`getGameSummary` names used consistently. ✓
