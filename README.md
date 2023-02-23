# Aptos Tic-Tac-Toe

* This currently provides a full onchain tic-tac-toe implementation.  Each move is done by an individual and it
is fully multiplayer.  There is a game creator, which is not allowed to modify the game unless it's finished.
* It provides view functions to tell when there are winners, and to view the board

## How to install

You can publish this with the aptos CLI (please version 1.0.6 or newer).  These instructions are for devnet, but you can simply
use a testnet / mainnet account instead.

```
aptos init --profile game --network devnet
cd move
aptos move publish --named-addresses deploy_account=game --profile game
```

## How to play (without a UI and just the CLI)
### Setup
Create two new users to play the game (for mainnet or with other users, you won't need to do this)

```
aptos init --profile x --network devnet
aptos init --profile o --network devnet
```

Then start the game, this will create the resource in the game account that you created in the first step.  This can be any other account, and it't not only limited to the publishing account.

```
aptos move run --function-id game::tic_tac_toe::start_game --args address:x address:o --profile game
```

### Play moves

The board, and the numbered spaces:
```
|-|-|-|
|0|1|2|
|-|-|-|
|3|4|5|
|-|-|-|
|6|7|8|
|-|-|-|
```

You can play a space 0-8, in the example below, I give the space 5 for player x
```
aptos move run --function-id game::tic_tac_toe::play_space --args address:game u64:5 --profile x
```

### View state
You can view the current winner (if any) (0 is None, 1 is X, 2 is O, 3 is Draw)
```
aptos move view --function-id game::tic_tac_toe::winner --args address:game --profile game
```
#### Current player
You can view the current player and their corresponding symbol (1 is X, 2 is O).
```
aptos move view --function-id game::tic_tac_toe::current_player --args address:game --profile game
```

#### Board
You can view the board (in a rough sense) here.  The numbers will be laid out in one long series of 9 two digit numbers, that represent the board.  00 represents no move, 01 represents X, 02 represents O.
```
aptos move view --function-id game::tic_tac_toe::get_board --args address:game --profile game
```

### Restart game and cleaning up
### Reset game
You can restart the game with the same players.  For fairness, the starting player will be the person who lost, or for a draw, whoever didn't go first last.
```
aptos move run --function-id game::tic_tac_toe::reset_game --args address:game --profile x
```

### Delete game
The game administrator account can always delete the game:
```
aptos move run --function-id game::tic_tac_toe::delete_game --args address:game --profile game
```

## TODO
* Add a UI
* Expand to other games, such as checkers
