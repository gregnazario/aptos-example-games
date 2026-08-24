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
  timeout forfeit once playing (3 days).

## Tests

```
cd move/arcade
aptos move test --named-addresses arcade=0xcafe
```

## Deploy (testnet)

The package is treated as immutable: fixes ship as new module versions,
never upgrades.

```
aptos init --network testnet --profile arcade-deploy
aptos account fund-with-faucet --profile arcade-deploy --amount 100000000
cd move/arcade
aptos move publish --profile arcade-deploy --named-addresses arcade=<DEPLOY_ADDRESS>
aptos move run --profile arcade-deploy --function-id <DEPLOY_ADDRESS>::hub::initialize
```

Then set `VITE_ARCADE_PACKAGE=<DEPLOY_ADDRESS>` in `client/.env`.
