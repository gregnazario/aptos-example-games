# Arcade package

Shared foundation for the on-chain arcade: `wager` (escrow + settlement) and
`hub` (lobby registry). Game modules (`tic_tac_toe_v2`, `checkers_v2`,
`backgammon`) arrive in later phases and will be `friend`s of `wager`.

## Invariants

- Only `wager` moves APT. Deposits are player-signed (`join`, `create`,
  cube top-ups); payouts happen exclusively through `settle`, `settle_draw`,
  and `cancel`, and settle paths are `public(friend)` to game modules only.
- The pot is the game object's own APT FungibleStore; balance always covers
  what settlement owes (pinned by tests).
- Terminal states are one-shot (`PHASE_SETTLED` gate).
- Every open game has a player-callable exit: creator `cancel` while open,
  and a central `forfeit_timeout` split refund after 3 days of inactivity.
  Game modules may implement turn-aware forfeits via `settle` (the stalled
  player loses the pot); `wager` itself cannot know whose turn it is, so its
  central path refunds both players instead of letting a caller name a loser.
- The phase-0 game-module stubs (`tic_tac_toe_v2`, `checkers_v2`,
  `backgammon`) are declared as `wager` friends upfront. The package uses
  the default `compatible` upgrade policy, so additional game modules can
  still be added after publish by extending the friend list.

## Tests

```
cd move/arcade
aptos move test --named-addresses arcade=0xcafe
```

## Deploy (testnet)

The package publishes with the default `compatible` upgrade policy: fixes
and new games ship as in-place upgrades that keep existing struct layouts
and public function signatures intact. Because the deployer key can change
code between publishes, it lives on a dedicated account; before any
mainnet deployment, strengthen the package to the `immutable` policy
(a one-way ratchet) so the audited code can no longer change.

```
aptos init --network testnet --profile arcade-deploy
aptos account fund-with-faucet --profile arcade-deploy --amount 100000000
cd move/arcade
aptos move publish --profile arcade-deploy --named-addresses arcade=<DEPLOY_ADDRESS>
aptos move run --profile arcade-deploy --function-id <DEPLOY_ADDRESS>::hub::initialize
```

Then set `VITE_ARCADE_PACKAGE=<DEPLOY_ADDRESS>` in `client/.env`.
