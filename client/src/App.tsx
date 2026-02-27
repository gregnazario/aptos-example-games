import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { type ChangeEvent, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { WalletSelector } from "@/components/WalletSelector";

const config = new AptosConfig({ network: Network.DEVNET });
const aptos = new Aptos(config);

export const NETWORK = "devnet";

// TODO: make this more accessible / be deployed by others?
export const moduleAddress = "0x3b36cac0ec1054b6a99facdef2a0015a2858ff75d10251590e606365394ac5bd";

// Extract game info from URL using native APIs
const getGameFromURL = (): { address: string; name: string } | null => {
	const match = window.location.pathname.match(/^\/game\/([^/]+)\/([^/]+)$/);
	if (match) return { address: match[1], name: match[2] };
	return null;
};

function App() {
	const NONE = 0;
	const X = 1;
	const O = 2;
	const DRAW = 3;

	// TODO Consolidate a lot of these
	const [accountHasGame, setAccountHasGame] = useState<boolean>(false);
	const [gameOver, setGameOver] = useState<boolean>(false);
	const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
	const [gameCreator, setGameCreator] = useState<string>("");
	const [gameIdAddress, setGameIdAddress] = useState<string>("");
	const [gameIdName, setGameIdName] = useState<string>("");
	const [gameNotFound, setGameNotFound] = useState<boolean>(false);
	const [gameName, setGameName] = useState<string>("default");
	const [XAddress, setXAddress] = useState<string>("");
	const [OAddress, setOAddress] = useState<string>("");

	const [currentPlayer, setCurrentPlayer] = useState<{
		symbol: string;
		address: string;
		name: string;
	}>({
		symbol: "",
		address: "",
		name: "",
	});
	const [players, setPlayers] = useState<{ playerX: string; playerO: string }>({
		playerX: "",
		playerO: "",
	});
	const [winner, setWinner] = useState<{
		symbol: string;
		address: string;
		alert_type: "success" | "warning" | "error";
	}>({
		symbol: "",
		address: "",
		alert_type: "warning",
	});
	const [board, setBoard] = useState<string[]>(["", "", "", "", "", "", "", "", ""]);
	const { account, network, connected, signAndSubmitTransaction } = useWallet();

	const loadGame = async () => {
		const gameInfo = getGameFromURL();

		if (gameInfo != null) {
			setup_game_on_load(gameInfo.address, gameInfo.name).catch(console.error);
		} else if (account?.address != null) {
			setGameCreator(account.address.toString());
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: loadGame is intentionally excluded to avoid re-triggering the polling interval on every render
	useEffect(() => {
		// On load, pull the game from the path, otherwise go to main menu
		loadGame();
		const poller = setInterval(loadGame, 10000);
		return () => {
			clearInterval(poller);
		};
	}, []);

	// Sets up the game on load.  has to be done this way since no await in use effect
	const setup_game_on_load = async (game_address: string, game_name: string) => {
		const creator_name = await resolveToName(game_address);
		const creator_address = await resolveToAddress(game_address);
		setGameCreator(creator_name);
		setGameIdAddress(creator_address);
		setGameIdName(game_name);
		joinGameInner(game_address, game_name);
	};

	// Listener for changing the Game name input box
	const onChangeGameIdName = async (event: ChangeEvent<HTMLInputElement>) => {
		const name = event.target.value;
		setGameIdName(name);
	};

	// Listener for changing the Game address input box
	const onChangeGameIdAddress = async (event: ChangeEvent<HTMLInputElement>) => {
		const address = event.target.value;
		setGameIdAddress(address);
	};

	// Listener for changing the Game Name input box
	const onChangeGameName = async (event: ChangeEvent<HTMLInputElement>) => {
		const value = event.target.value;
		setGameName(value);
	};

	// Listener for changing the X Address input box
	const onChangeXAddress = async (event: ChangeEvent<HTMLInputElement>) => {
		const address = event.target.value;
		setXAddress(address);
	};

	// Listener for changing the O Address input box
	const onChangeOAddress = async (event: ChangeEvent<HTMLInputElement>) => {
		const address = event.target.value;
		setOAddress(address);
	};

	// Resolves a name or address to a name
	const resolveToName = async (maybe_address: string): Promise<string> => {
		// TODO: Provide useful messages if names don't resolve
		try {
			const response = await fetch(
				`https://www.aptosnames.com/api/mainnet/v1/primary-name/${maybe_address}`,
			);
			const { name } = await response.json();

			// If I can resolve the name, let's provide that
			if (name != null) {
				return `${name}.apt`;
			}
		} catch {}

		// In all other cases, show the original string
		return maybe_address;
	};

	// Resolves a name or address to an address
	const resolveToAddress = async (maybe_name: string): Promise<string> => {
		// TODO: Provide useful messages if names don't resolve
		try {
			const response = await fetch(
				`https://www.aptosnames.com/api/mainnet/v1/address/${maybe_name}`,
			);
			const { address } = await response.json();
			// If name resolves, return the address
			if (address != null) {
				return address;
			}
		} catch {}
		// If it can't resolve, act like it's an address
		return maybe_name;
	};

	// Fetches the winner given a game address
	const fetchWinner = async (gameAddress: string, gameName: string) => {
		try {
			// Run the view function to fetch the winner
			const winner_info = await aptos.view({
				payload: {
					function: `${moduleAddress}::tic_tac_toe::winner`,
					functionArguments: [gameAddress, gameName],
				},
			});

			// Check the player who won, lost, or had a draw
			const winner_num = winner_info[0] as number;
			let winner_address = "";
			let winner_symbol = "";
			let type: "success" | "warning" | "error" = "warning";

			if (winner_num === X) {
				// Player X won
				winner_symbol = "X";
				winner_address = winner_info[1].toString();
				setGameOver(true);
			} else if (winner_num === O) {
				// Player O won
				winner_symbol = "O";
				winner_address = winner_info[1].toString();
				setGameOver(true);
			} else if (winner_num === DRAW) {
				// Neither player won
				winner_symbol = "Draw";
				winner_address = "";
				setGameOver(true);
			}

			// If the current player won, display a green banner, yellow if draw, red if lost
			const player_address = account?.address?.toString();
			if (winner_symbol === "Draw") {
				type = "warning";
			} else if (player_address != null && winner_address === player_address) {
				// TODO: Handle matching different representations (missing 0 at beginning)
				type = "success";
			} else {
				type = "error";
			}

			setWinner({ symbol: winner_symbol, address: winner_address, alert_type: type });
		} catch {
			// If we fail to pull the winner, game isn't over (hopefully)
			setWinner({ symbol: "", address: "", alert_type: "warning" });
			setGameOver(false);
		}
	};

	// Return to the main menu
	const mainMenu = async () => {
		// Hide the board, go back to main page
		window.history.pushState({}, "", "/");
		setAccountHasGame(false);
	};

	// Go to the game page
	const joinGame = async () => {
		await joinGameInner(gameIdAddress, gameIdName);
	};

	const joinGameInner = async (gameAddress: string, gameName: string) => {
		// Resolve names first
		const creator_name = await resolveToName(gameAddress);
		const creator_address = await resolveToAddress(gameAddress);

		setGameCreator(creator_name);
		setGameIdAddress(creator_address);
		// First save the game address
		window.history.pushState({}, "", `/game/${creator_name}/${gameName}`);

		// Now fetch game
		await fetchGame(creator_address, gameName);
		await fetchWinner(creator_address, gameName);
	};

	// Retrieve game board from on chain
	const fetchGame = async (gameAddress: string, gameName: string) => {
		// Set transaction in progress for "loading" spinner
		setTransactionInProgress(true);

		try {
			// Retrieve the whole board array via view function
			const result = await aptos.view({
				payload: {
					function: `${moduleAddress}::tic_tac_toe::get_board`,
					functionArguments: [gameAddress, gameName],
				},
			});

			// Retrieve the next player by view function
			const current_player = await aptos.view({
				payload: {
					function: `${moduleAddress}::tic_tac_toe::current_player`,
					functionArguments: [gameAddress, gameName],
				},
			});

			// Retrieve current players by view function
			const players = await aptos.view({
				payload: {
					function: `${moduleAddress}::tic_tac_toe::players`,
					functionArguments: [gameAddress, gameName],
				},
			});

			// Resolve names for players
			const playerX = await resolveToName(players[0].toString());
			const playerO = await resolveToName(players[1].toString());

			// Convert player info to readable outputs
			const player_num = current_player[0] as number;
			let player_address = "";
			let player_symbol = "";
			let player_name = "";
			if (player_num === X) {
				player_symbol = "X";
				player_address = current_player[1].toString();
				player_name = playerX;
			} else if (player_num === O) {
				player_symbol = "O";
				player_address = current_player[1].toString();
				player_name = playerO;
			} else {
				player_symbol = "";
				player_address = "";
				player_name = "";
			}

			// Run through each square in the board, and populate the board
			const layout = ["", "", "", "", "", "", "", "", ""];
			const boardData = result[0] as string;
			let index = 0;
			for (let i = 2; i < boardData.length; i += 2) {
				// Convert from string to number because it's a u64
				const symbol_num = Number(boardData[i + 1]);
				if (symbol_num === NONE) {
					layout[index] = " ";
				} else if (symbol_num === X) {
					layout[index] = "X";
				} else if (symbol_num === O) {
					layout[index] = "O";
				}
				index++;
			}

			// Setup all the board display information
			setPlayers({ playerX: playerX, playerO: playerO });
			setCurrentPlayer({ symbol: player_symbol, address: player_address, name: player_name });
			setBoard(layout);
			setAccountHasGame(true);
			setGameNotFound(false);
			await fetchWinner(gameAddress, gameName);
		} catch (e: unknown) {
			console.error(e);
			// If it errors out, we say there's no game found
			setAccountHasGame(false);
			setGameNotFound(true);
		} finally {
			// Clear up the loading spinner
			setTransactionInProgress(false);
		}
	};

	// Creates a new game onchain
	const addNewGame = async () => {
		// Ensure you're logged in
		if (!account) return [];
		setTransactionInProgress(true);

		// Resolve addresses
		const x_address = await resolveToAddress(XAddress);
		const o_address = await resolveToAddress(OAddress);

		// Start the new game!
		const payload = {
			data: {
				function: `${moduleAddress}::tic_tac_toe::start_game` as `${string}::${string}::${string}`,
				functionArguments: [gameName, x_address, o_address],
			},
		};

		try {
			// sign and submit transaction to chain, waiting for it to complete
			const response = await signAndSubmitTransaction(payload);
			await aptos.waitForTransaction({ transactionHash: response.hash });

			// Initialize the local state
			const addr = account.address.toString();
			setGameIdAddress(addr);
			setGameIdName(gameName);
			window.history.pushState({}, "", `/game/${addr}/${gameName}`);
			setAccountHasGame(true);
			await fetchGame(addr, gameName);
		} catch (_error: unknown) {
			// TODO: Display banner of error of creation
			setAccountHasGame(false);
		} finally {
			setTransactionInProgress(false);
		}
	};

	// Reset the game so the same players can play afterwards
	const resetGame = async () => {
		// Ensure you're logged in
		if (!account) return [];
		setTransactionInProgress(true);
		const payload = {
			data: {
				function: `${moduleAddress}::tic_tac_toe::reset_game` as `${string}::${string}::${string}`,
				functionArguments: [gameIdAddress, gameIdName],
			},
		};

		try {
			const response = await signAndSubmitTransaction(payload);
			await aptos.waitForTransaction({ transactionHash: response.hash });

			// Cleanup state from previous game
			setAccountHasGame(true);
			setWinner({ symbol: "", address: "", alert_type: "warning" });
			setGameOver(false);
			await fetchGame(gameIdAddress, gameIdName);
		} catch (_error: unknown) {
			// TODO: Display banner of error of reset
		} finally {
			setTransactionInProgress(false);
		}
	};

	// Remove this game entirely from the account
	const deleteGame = async () => {
		// Ensure you're logged in
		if (!account) return [];

		// If it's not the correct address, not lets accidentally delete the wrong game
		if (gameIdAddress !== account.address.toString()) return [];

		setTransactionInProgress(true);
		const payload = {
			data: {
				function: `${moduleAddress}::tic_tac_toe::delete_game` as `${string}::${string}::${string}`,
				functionArguments: [gameIdName],
			},
		};

		try {
			const response = await signAndSubmitTransaction(payload);
			await aptos.waitForTransaction({ transactionHash: response.hash });
			// Refresh state
			setAccountHasGame(false);
			setWinner({ symbol: "", address: "", alert_type: "warning" });
			setGameOver(false);
			await fetchGame(gameIdAddress, gameIdName);
		} catch (_error: unknown) {
			// TODO: Display banner of error of delete
			setAccountHasGame(false);
		} finally {
			setTransactionInProgress(false);
		}
	};

	// Play a single space as an X or O
	const playSpace = async (space: number) => {
		// Ensure you're logged in
		if (!account) return [];
		setTransactionInProgress(true);
		const payload = {
			data: {
				function: `${moduleAddress}::tic_tac_toe::play_space` as `${string}::${string}::${string}`,
				functionArguments: [gameIdAddress, gameIdName, space],
			},
		};

		try {
			const response = await signAndSubmitTransaction(payload);
			await aptos.waitForTransaction({ transactionHash: response.hash });
			setAccountHasGame(true);
		} catch (_error: unknown) {
			setAccountHasGame(false);
		} finally {
			setTransactionInProgress(false);
		}

		// Fetch the new board
		await fetchGame(gameIdAddress, gameIdName);
	};

	const networkName = network?.name ? (network.name as string).toLowerCase() : "";

	return (
		<div className="min-h-screen bg-background">
			{/* Header */}
			<header className="flex items-center justify-between border-b px-6 py-4">
				<h1 className="text-xl font-bold">Tic-Tac-Toe ({network?.name ?? "unknown"})</h1>
				<WalletSelector />
			</header>

			{/* Alerts */}
			{!connected && (
				<Alert className="mx-6 mt-4">
					<AlertDescription>Please connect your wallet</AlertDescription>
				</Alert>
			)}
			{connected && networkName !== NETWORK && (
				<Alert variant="destructive" className="mx-6 mt-4">
					<AlertDescription>
						Wallet is connected to {network?.name}. Please connect to {NETWORK}
					</AlertDescription>
				</Alert>
			)}

			{/* Main content */}
			{connected && networkName === NETWORK && (
				<main
					className={`mx-auto max-w-2xl px-6 py-8 ${transactionInProgress ? "opacity-50 pointer-events-none" : ""}`}
				>
					{!accountHasGame && (
						<div className="space-y-8">
							{/* Game not found alert */}
							{gameNotFound && (
								<Alert variant="destructive">
									<AlertDescription>
										Game {getGameFromURL()?.name ?? ""} is not found at{" "}
										{getGameFromURL()?.address ?? ""}
									</AlertDescription>
								</Alert>
							)}

							{/* Join Game form */}
							<Card>
								<CardHeader>
									<CardTitle>Join Existing Game</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="game-creator">
											Game Creator
										</label>
										<Input
											id="game-creator"
											onChange={onChangeGameIdAddress}
											placeholder="Game Creator (address or .apt name)"
											defaultValue={gameIdAddress}
										/>
									</div>
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="game-name-join">
											Game Name
										</label>
										<Input
											id="game-name-join"
											onChange={onChangeGameIdName}
											placeholder="Game Name"
											defaultValue={gameIdName}
										/>
									</div>
									<Button onClick={() => joinGame()}>Join Game</Button>
								</CardContent>
							</Card>

							{/* Create Game form */}
							<Card>
								<CardHeader>
									<CardTitle>Create New Game</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="new-game-name">
											Game Name
										</label>
										<Input
											id="new-game-name"
											onChange={onChangeGameName}
											placeholder="Game Name"
											defaultValue={gameName}
										/>
									</div>
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="player-x">
											Player X Address
										</label>
										<Input
											id="player-x"
											onChange={onChangeXAddress}
											placeholder="Player X Address"
											defaultValue={XAddress}
										/>
									</div>
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="player-o">
											Player O Address
										</label>
										<Input
											id="player-o"
											onChange={onChangeOAddress}
											placeholder="Player O Address"
											defaultValue={OAddress}
										/>
									</div>
									<Button onClick={addNewGame}>Start new game</Button>
								</CardContent>
							</Card>

							{/* How to play */}
							<Card>
								<CardHeader>
									<CardTitle>How to play</CardTitle>
								</CardHeader>
								<CardContent>
									<ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
										<li>Connect your wallet of choice with the button in the upper right</li>
										<li>
											To connect to an existing game, enter a game creator (APT Name or Address)
											into the game creator field, and the game name into the game name field. Then,
											click "Join Game". If the account was "0x12345" and the game name was
											"default", the game id would be "0x12345" and "default"
										</li>
										<li>
											To create a new game, enter the names of the two players, as well as a name
											for the game, and click start new game.
										</li>
										<li>
											The game URL will then be switched to the game, and the page can simply be
											refreshed for future updates
										</li>
										<li>Future will add listing of games, maybe matchmaking as well</li>
									</ul>
								</CardContent>
							</Card>
						</div>
					)}

					{accountHasGame && (
						<div className="space-y-6">
							{/* Main menu button */}
							<Button variant="outline" onClick={() => mainMenu()}>
								Main Menu
							</Button>

							{/* Player info card */}
							<Card>
								<CardHeader>
									<CardTitle>
										{gameCreator} : {gameIdName}
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="grid grid-cols-2 gap-4 text-sm">
										<div>
											<span className="font-medium">Player X:</span> {players.playerX}
										</div>
										<div>
											<span className="font-medium">Player O:</span> {players.playerO}
										</div>
									</div>
								</CardContent>
							</Card>

							{/* Current player / winner alert */}
							{!gameOver && (
								<Alert>
									<AlertDescription>
										Current player is {currentPlayer.symbol} ({currentPlayer.name})
									</AlertDescription>
								</Alert>
							)}
							{gameOver && (
								<Alert variant={winner.alert_type === "error" ? "destructive" : "default"}>
									<AlertDescription>
										{winner.symbol === "Draw"
											? "Game ended in a draw!"
											: `Winner is ${winner.symbol} (${winner.address})`}
									</AlertDescription>
								</Alert>
							)}

							{/* Board grid */}
							<div className="grid grid-cols-3 gap-2 w-fit mx-auto">
								{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((pos) => (
									<Button
										key={`cell-${pos}`}
										variant="outline"
										className="w-20 h-20 text-2xl font-bold"
										onClick={() => playSpace(pos)}
										disabled={gameOver || board[pos].trim() !== ""}
									>
										{board[pos]}
									</Button>
								))}
							</div>

							{/* Game over actions */}
							{gameOver && (
								<div className="flex gap-4 justify-center">
									<Button onClick={resetGame}>Play again?</Button>
									{gameIdAddress === account?.address?.toString() && (
										<Button variant="destructive" onClick={deleteGame}>
											Delete game (only the game account can)
										</Button>
									)}
								</div>
							)}

							{/* How to play */}
							<Card>
								<CardHeader>
									<CardTitle>How to play</CardTitle>
								</CardHeader>
								<CardContent>
									<ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
										<li>Click the space that you'd like to play</li>
										<li>Accept the transaction, or cancel and choose a new space</li>
										<li>
											Wait for the other person to finish their turn and refresh (Sometime
											auto-refresh will be added)
										</li>
										<li>
											The goal of the game is to get 3 in a row without getting blocked by the other
											player.
										</li>
										<li>All rules of tic-tac-toe are enforced on-chain and cannot be cheated</li>
										<li>When the game ends, either player can reset the game with "Play again"</li>
										<li>
											If you're the creator of the game, you can delete the game entirely with
											"Delete game"
										</li>
									</ul>
								</CardContent>
							</Card>
						</div>
					)}
				</main>
			)}
		</div>
	);
}

export default App;
