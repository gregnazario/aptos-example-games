import {Alert, Button, Col, Descriptions, Input, Layout, Row, Spin, Typography} from "antd";
import {WalletSelector} from "@aptos-labs/wallet-adapter-ant-design";
import "@aptos-labs/wallet-adapter-ant-design/dist/index.css";
import {AptosClient} from "aptos";
import {useWallet} from "@aptos-labs/wallet-adapter-react";
import {ChangeEvent, useEffect, useState} from "react";
import {createBrowserHistory} from "history";
import {matchPath} from "react-router";

const {Paragraph} = Typography;

// TODO: Load URL from wallet
export const NODE_URL = "https://fullnode.mainnet.aptoslabs.com";
export const client = new AptosClient(NODE_URL);


// TODO: make this more accessible / be deployed by others?
export const moduleAddress = "0x3b36cac0ec1054b6a99facdef2a0015a2858ff75d10251590e606365394ac5bd";

function App(this: any) {
    const NONE = 0;
    const X = 1;
    const O = 2
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

    const [currentPlayer, setCurrentPlayer] = useState<{ symbol: string, address: string, name: string }>({
        symbol: "",
        address: "",
        name: ""
    });
    const [players, setPlayers] = useState<{ playerX: string, playerO: string }>({playerX: "", playerO: ""});
    const [winner, setWinner] = useState<{ symbol: string, address: string, alert_type: "success" | "warning" | "error" }>({
        symbol: "",
        address: "",
        alert_type: "warning"
    });
    const [board, setBoard] = useState<string[]>(["", "", "", "", "", "", "", "", ""]);
    const {account, network, connected, signAndSubmitTransaction} = useWallet();
    const browserHistory = createBrowserHistory();

    useEffect(() => {
        // On load, pull the game from the path, otherwise go to main menu
        const match = matchPath("/game/:game_address/:game_name", window.location.pathname);

        if (match != null && match.params.game_address != null && match.params.game_name != null) {
            let game_address = match.params.game_address;
            let game_name = match.params.game_name;
            setup_game_on_load(game_address, game_name).catch(console.error);
        } else if (account?.address != null) {
            setGameCreator(account?.address)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account, network?.name])

    // Retrieves the address and name from the URL
    const getAddressAndNameFromURL = (): { address: string, name: string } => {
        const match = matchPath("/game/:game_address/:game_name", window.location.pathname);

        if (match != null && match.params.game_address != null && match.params.game_name != null) {
            return {address: match.params.game_address, name: match.params.game_name}
        } else {
            return {address: "", name: ""}
        }
    }

    // Sets up the game on load.  has to be done this way since no await in use effect
    const setup_game_on_load = async (game_address: string, game_name: string) => {
        let creator_name = await resolveToName(game_address);
        let creator_address = await resolveToAddress(game_address);
        setGameCreator(creator_name);
        setGameIdAddress(creator_address);
        joinGameInner(game_address, game_name)
    }

    // Listener for changing the Game name input box
    const onChangeGameIdName = async (event: ChangeEvent<HTMLInputElement>) => {
        const name = event.target.value;
        setGameIdName(name);
    }

    // Listener for changing the Game address input box
    const onChangeGameIdAddress = async (event: ChangeEvent<HTMLInputElement>) => {
        const address = event.target.value;
        setGameIdAddress(address);
    }

    // Listener for changing the X Address input box
    const onChangeGameName = async (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setGameName(value);
    }

    // Listener for changing the X Address input box
    const onChangeXAddress = async (event: ChangeEvent<HTMLInputElement>) => {
        const address = event.target.value;
        setXAddress(address);
    }

    // Listener for changing the O Address input box
    const onChangeOAddress = async (event: ChangeEvent<HTMLInputElement>) => {
        const address = event.target.value;
        setOAddress(address);
    }

    // Resolves a name or address to a name
    const resolveToName = async (maybe_address: string): Promise<string> => {
        // TODO: Provide useful messages if names don't resolve
        try {
            const response = await fetch(`https://www.aptosnames.com/api/mainnet/v1/primary-name/${maybe_address}`);
            const {name} = await response.json();

            // If I can resolve the name, let's provide that
            if (name != null) {
                return `${name}.apt`
            }
        } catch {
        }

        // In all other cases, show the original string
        return maybe_address
    }

    // Resolves a name or address to an address
    const resolveToAddress = async (maybe_name: string): Promise<string> => {
        // TODO: Provide useful messages if names don't resolve
        try {
            const response = await fetch(`https://www.aptosnames.com/api/mainnet/v1/address/${maybe_name}`);
            const {address} = await response.json();
            // If name resolves, return the address
            if (address != null) {
                return address
            }
        } catch {
        }
        // If it can't resolve, act like it's an address
        return maybe_name
    }

    // Fetches the winner given a game address
    const fetchWinner = async (gameAddress: string, gameName: string) => {
        try {
            // Run the view function to fetch the winner
            const winner_info = await client.view({
                arguments: [gameAddress, gameName],
                function: `${moduleAddress}::tic_tac_toe::winner`,
                type_arguments: []
            });

            // Check the player who won, lost, or had a draw
            const winner_num = winner_info[0] as number;
            let winner_address = "";
            let winner_symbol = "";
            let type: "success" | "warning" | "error" = "warning"

            if (winner_num === X) {
                // Player X won
                winner_symbol = "X"
                winner_address = winner_info[1].toString();
                setGameOver(true);
            } else if (winner_num === O) {
                // Player O won
                winner_symbol = "O"
                winner_address = winner_info[1].toString();
                setGameOver(true);
            } else if (winner_num === DRAW) {
                // Neither player won
                winner_symbol = "Draw"
                winner_address = ""
                setGameOver(true);
            }

            // If the current player won, display a green banner, yellow if draw, red if lost
            let player_address = account?.address;
            if (winner_symbol === "Draw") {
                type = "warning"
            } else if (player_address !== null && winner_address === player_address) {
                // TODO: Handle matching different representations (missing 0 at beginning)
                type = "success"
            } else {
                type = "error"
            }

            setWinner({symbol: winner_symbol, address: winner_address, alert_type: type});
        } catch {
            // If we fail to pull the winner, game isn't over (hopefully)
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
        }
    };

    // Return to the main menu
    const mainMenu = async () => {
        // Hide the board, go back to main page
        browserHistory.push(`/`);
        setAccountHasGame(false);
    };

    // Go to the game page
    const joinGame = async () => {
        await joinGameInner(gameIdAddress, gameIdName)
    }

    const joinGameInner = async (gameAddress: string, gameName: string) => {
        // Resolve names first
        let creator_name = await resolveToName(gameAddress);
        let creator_address = await resolveToAddress(gameAddress);

        setGameCreator(creator_name);
        setGameIdAddress(creator_address);
        // First save the game address
        let browserHistory = createBrowserHistory();
        browserHistory.push(`/game/${creator_name}/${gameName}`);

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
            const result = await client.view({
                arguments: [gameAddress, gameName],
                function: `${moduleAddress}::tic_tac_toe::get_board`,
                type_arguments: []
            })

            // Retrieve the next player by view function
            const current_player = await client.view({
                arguments: [gameAddress, gameName],
                function: `${moduleAddress}::tic_tac_toe::current_player`,
                type_arguments: []
            });

            // Retrieve current players by view function
            const players = await client.view({
                arguments: [gameAddress, gameName],
                function: `${moduleAddress}::tic_tac_toe::players`,
                type_arguments: []
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
                player_symbol = "X"
                player_address = current_player[1].toString();
                player_name = playerX;
            } else if (player_num === O) {
                player_symbol = "O"
                player_address = current_player[1].toString();
                player_name = playerO;
            } else {
                player_symbol = ""
                player_address = "";
                player_name = "";
            }

            // Run through each square in the board, and populate the board
            let layout = ["", "", "", "", "", "", "", "", ""];
            let board = result[0] as string;
            let index = 0;
            for (let i = 2; i < board.length; i += 2) {
                // Convert from string to number because it's a u64
                const symbol_num = Number(board[i + 1]);
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

            setPlayers({playerX: playerX, playerO: playerO});
            setCurrentPlayer({symbol: player_symbol, address: player_address, name: player_name});
            setBoard(layout);
            setAccountHasGame(true);
            setGameNotFound(false);
            await fetchWinner(gameAddress, gameName);
        } catch (e: any) {
            console.error(e)
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
        let x_address = await resolveToAddress(XAddress);
        let o_address = await resolveToAddress(OAddress);

        // Start the new game!
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::start_game`,
            type_arguments: [],
            arguments: [gameName, x_address, o_address],
        };

        try {
            // sign and submit transaction to chain, waiting for it to complete
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);

            // Initialize the local state
            setGameIdAddress(account.address);
            setGameIdName(gameName);
            let browserHistory = createBrowserHistory();
            browserHistory.push(`/game/${account.address}/${gameName}`);
            setAccountHasGame(true);
            await fetchGame(account.address, gameName);
        } catch (error: any) {
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
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::reset_game`,
            type_arguments: [],
            arguments: [gameIdAddress, gameIdName],
        };

        try {
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);

            // Cleanup state from previous game
            setAccountHasGame(true);
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
            await fetchGame(gameIdAddress, gameIdName)
        } catch (error: any) {
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
        if (gameIdAddress !== account?.address) return [];

        setTransactionInProgress(true);
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::delete_game`,
            type_arguments: [],
            arguments: [gameIdName],
        };

        try {
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);
            // Refresh state
            setAccountHasGame(false);
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
            await fetchGame(gameIdAddress, gameIdName)
        } catch (error: any) {
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
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::play_space`,
            type_arguments: [],
            arguments: [gameIdAddress, gameIdName, space],
        };

        try {
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);
            setAccountHasGame(true);
        } catch (error: any) {
            setAccountHasGame(false);
        } finally {
            setTransactionInProgress(false);
        }

        // Fetch the new board
        await fetchGame(gameIdAddress, gameIdName);
    }

    return (
        <>
            <Layout>
                <Row align="middle">
                    <Col span={10} offset={2}>
                        <h1>Tic-Tac-Toe ({network?.name})</h1>
                    </Col>
                    <Col span={12} style={{textAlign: "right", paddingRight: "200px"}}>
                        <WalletSelector/>
                    </Col>
                </Row>
            </Layout>
            {
                !connected &&
                <Alert message={`Please connect your wallet`} type="info"/>
            }
            {
                connected && network?.name as string !== 'Mainnet' &&
                <Alert message={`Wallet is connected to ${network?.name}.  Please connect to mainnet`} type="warning"/>
            }
            {connected && network?.name as string === "Mainnet" && <Spin spinning={transactionInProgress}>
                {!accountHasGame && (
                    <div>
                        <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                            {gameNotFound &&
                                <Col span={8} offset={8}>
                                    <Alert
                                        message={`Game ${getAddressAndNameFromURL().name} is not found at ${getAddressAndNameFromURL().address}`}
                                        type="error"/>
                                </Col>
                            }
                            <Col span={12} offset={8}>
                                <Input.Group compact>
                                    <Paragraph>Game Creator</Paragraph>
                                    <Input
                                        onChange={(event) => {
                                            onChangeGameIdAddress(event)
                                        }}
                                        style={{width: "calc(100% - 60px)"}}
                                        placeholder="Game Creator"
                                        size="large"
                                        defaultValue={gameIdAddress}
                                    />
                                    <Paragraph>Game Name</Paragraph>
                                    <Input
                                        onChange={(event) => {
                                            onChangeGameIdName(event)
                                        }}
                                        style={{width: "calc(100% - 60px)"}}
                                        placeholder="Game Name"
                                        size="large"
                                        defaultValue={gameIdName}
                                    />
                                    <Button
                                        onClick={() => joinGame()}
                                        type="primary"
                                        style={{height: "40px", backgroundColor: "#3f67ff"}}
                                    >
                                        Join Game
                                    </Button>
                                </Input.Group>
                            </Col>
                        </Row>
                        <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                            <Col span={12} offset={8}>
                                <Input.Group compact>
                                    <Input
                                        onChange={(event) => {
                                            onChangeGameName(event)
                                        }}
                                        style={{width: "calc(100% - 60px)"}}
                                        placeholder="Game Name"
                                        size="large"
                                        defaultValue={gameName}
                                    />

                                    <Input
                                        onChange={(event) => {
                                            onChangeXAddress(event)
                                        }}
                                        style={{width: "calc(100% - 60px)"}}
                                        placeholder="Player X Address"
                                        size="large"
                                        defaultValue={XAddress}
                                    />

                                    <Input
                                        onChange={(event) => {
                                            onChangeOAddress(event)
                                        }}
                                        style={{width: "calc(100% - 60px)"}}
                                        placeholder="Player O Address"
                                        size="large"
                                        defaultValue={OAddress}
                                    />

                                    <Button
                                        onClick={addNewGame}
                                        type="primary"
                                        style={{height: "40px", backgroundColor: "#3f67ff"}}
                                    >
                                        Start new game
                                    </Button>
                                </Input.Group>
                            </Col>
                        </Row>
                        <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                            <Col span={8} offset={8}>
                                <p><b>How to play:</b>
                                    <li>Connect your wallet of choice with the button in the upper left</li>
                                    <li>To connect to an existing game, enter a game creator (APT Name or Address) into
                                        the game creator field, and the game name into the game name field. Then, click
                                        "Join Game". If the account was "0x12345" and the game name was "default", the
                                        game id would be "0x12345" and "default"
                                    </li>
                                    <li>To create a new game, enter the names of the two players, as well as a name for
                                        the game, and click start new game.
                                    </li>
                                    <li>The game URL will then be switched to the game, and the page can simply be
                                        refreshed for future updates
                                    </li>
                                    <li>Future will add listing of games, maybe matchmaking as well</li>
                                </p>
                            </Col>
                        </Row>
                    </div>
                )}
                {accountHasGame && (<div>
                        <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                            <Col span={8} offset={8}>
                                <Button
                                    onClick={() => mainMenu()}
                                    type="primary"
                                    style={{height: "40px", backgroundColor: "#3f67ff"}}
                                >
                                    Main Menu
                                </Button>
                            </Col>
                        </Row>
                        <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                            <Col span={8} offset={8}>
                                <Descriptions title={`${gameCreator} : ${gameIdName}`} bordered size="middle">
                                    <Descriptions.Item label="Player X" span={8}>{players.playerX}</Descriptions.Item>
                                    <Descriptions.Item label="Player O" span={8}>{players.playerO}</Descriptions.Item>
                                </Descriptions>
                            </Col>
                        </Row>
                        <Input.Group>
                            <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                                {!gameOver &&
                                    <Col span={8} offset={8}>
                                        <Alert
                                            message={`Current player is ${currentPlayer.symbol} (${currentPlayer.name})`}/>
                                    </Col>
                                }
                                {gameOver &&
                                    <Col span={8} offset={8}>
                                        <Alert message={`Winner is ${winner.symbol} (${winner.address})`}
                                               type={winner.alert_type}/>
                                    </Col>
                                }
                                <Col span={12} offset={8}>
                                    <Button onClick={() => playSpace(0)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[0]}
                                    </Button>
                                    <Button onClick={() => playSpace(1)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[1]}
                                    </Button>
                                    <Button onClick={() => playSpace(2)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[2]}
                                    </Button>
                                </Col>
                                <Col span={12} offset={8}>
                                    <Button onClick={() => playSpace(3)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[3]}
                                    </Button>
                                    <Button onClick={() => playSpace(4)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[4]}
                                    </Button>
                                    <Button onClick={() => playSpace(5)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[5]}
                                    </Button>
                                </Col>
                                <Col span={12} offset={8}>
                                    <Button onClick={() => playSpace(6)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[6]}
                                    </Button>
                                    <Button onClick={() => playSpace(7)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[7]}
                                    </Button>
                                    <Button onClick={() => playSpace(8)} block type="primary"
                                            style={{width: "80px", height: "80px"}}>
                                        {board[8]}
                                    </Button>
                                </Col>
                                {gameOver &&
                                    <Col span={8} offset={8}>
                                        <Button onClick={resetGame} block type="primary"
                                                style={{height: "40px", backgroundColor: "#5f67ff"}}>
                                            Play again?
                                        </Button>
                                    </Col>
                                }
                                {gameOver && gameIdAddress === account?.address &&
                                    <Col span={8} offset={8}>
                                        <Button onClick={deleteGame} block type="primary"
                                                style={{height: "40px", backgroundColor: "#3f67ff"}}>
                                            Delete game (only the game account can)
                                        </Button>
                                    </Col>
                                }
                            </Row>
                        </Input.Group>
                        <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                            <Col span={8} offset={8}>
                                <p><b>How to play:</b>
                                    <li>Click the space that you'd like to play</li>
                                    <li>Accept the transaction, or cancel and choose a new space</li>
                                    <li>Wait for the other person to finish their turn and refresh (Sometime
                                        auto-refresh will be added)
                                    </li>
                                    <li>The goal of the game is to get 3 in a row without getting blocked by the other
                                        player.
                                    </li>
                                    <li>All rules of tic-tac-toe are enforced on-chain and cannot be cheated</li>
                                    <li>When the game ends, either player can reset the game with "Play again"</li>
                                    <li>If you're the creator of the game, you can delete the game entirely with "Delete
                                        game"
                                    </li>
                                </p>
                            </Col>
                        </Row>
                    </div>
                )}
            </Spin>}
        </>
    );
}

export default App;