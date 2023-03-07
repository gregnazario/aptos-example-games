import {Layout, Row, Col, Button, Spin, Input, Alert} from "antd";
import {WalletSelector} from "@aptos-labs/wallet-adapter-ant-design";
import "@aptos-labs/wallet-adapter-ant-design/dist/index.css";
import {AptosClient} from "aptos";
import {useWallet} from "@aptos-labs/wallet-adapter-react";
import {ChangeEvent, useState, useEffect} from "react";
import {createBrowserHistory} from "history";
import {matchPath} from "react-router";

// TODO: Load URL from wallet
export const NODE_URL = "https://fullnode.testnet.aptoslabs.com";
export const client = new AptosClient(NODE_URL);


// TODO: make this more accessible / be deployed by others?
export const moduleAddress = "0x3e650cb888bc74421a4d8a0c35ddaf37608465d7fe4bf0aae092188568bab6b9";

function App(this: any) {
    const NONE = 0;
    const X = 1;
    const O = 2;
    const DRAW = 3;

    const [accountHasGame, setAccountHasGame] = useState<boolean>(false);
    const [gameOver, setGameOver] = useState<boolean>(false);
    const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
    const [enteredGameId, setEnteredGameId] = useState<string>("");
    const [gameId, setGameId] = useState<string>("");
    const [gameNotFound, setGameNotFound] = useState<boolean>(false);
    const [gameName, setGameName] = useState<string>("default");
    const [XAddress, setXAddress] = useState<string>("");
    const [OAddress, setOAddress] = useState<string>("");

    const [currentPlayer, setCurrentPlayer] = useState<{ symbol: string, address: string }>({symbol: "", address: ""});
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
        const match = matchPath("/game/:game_id", window.location.pathname);

        if (match != null && match.params.game_id != null) {
            const gameId = match.params.game_id;
            setGameId(gameId);
            setEnteredGameId(gameId);
            fetchGame(gameId)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [account])

    // Listener for changing the Game Address input box
    const onChangeGameAddress = async (event: ChangeEvent<HTMLInputElement>) => {
        // TODO: Resolve for address also the ANS names
        const value = event.target.value;
        setEnteredGameId(value);
    }

    // Listener for changing the X Address input box
    const onChangeGameName = async (event: ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        setGameName(value);
    }

    // Listener for changing the X Address input box
    const onChangeXAddress = async (event: ChangeEvent<HTMLInputElement>) => {
        // TODO: Resolve for address also the ANS names
        const value = event.target.value;
        setXAddress(value);
    }

    // Listener for changing the O Address input box
    const onChangeOAddress = async (event: ChangeEvent<HTMLInputElement>) => {
        // TODO: Resolve for address also the ANS names
        const value = event.target.value;
        setOAddress(value);
    }

    // Fetches the winner given a game address
    const fetchWinner = async (gameId: string) => {
        let [gameAddress, gameName] = splitGameId(gameId);
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
        // First save the game address
        // TODO: probably just use URL and not save twice
        setGameId(enteredGameId);
        let browserHistory = createBrowserHistory();
        browserHistory.push(`/game/${enteredGameId}`);
        // Now fetch game
        await fetchGame(enteredGameId);
        await fetchWinner(enteredGameId);
    };

    function splitGameId(gameId: String): [string, string] {
        let parts = gameId.split(":");
        return [parts[0], parts[1]]
    }

    // Retrieve game board from on chain
    const fetchGame = async (gameId: string) => {
        // Set transaction in progress for "loading" spinner
        setTransactionInProgress(true);
        let [gameAddress, gameName] = splitGameId(gameId);

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

            // Convert player info to readable outputs
            const player_num = current_player[0] as number;
            let player_address = "";
            let player_symbol = "";
            if (player_num === X) {
                player_symbol = "X"
                player_address = current_player[1].toString();
            } else if (player_num === O) {
                player_symbol = "O"
                player_address = current_player[1].toString();
            } else {
                player_symbol = ""
                player_address = "";
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
            setCurrentPlayer({symbol: player_symbol, address: player_address});
            setBoard(layout);
            setAccountHasGame(true);
            setGameNotFound(false);
            await fetchWinner(gameId);
        } catch (e: any) {
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
        // Start the new game!
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::start_game`,
            type_arguments: [],
            arguments: [gameName, XAddress, OAddress],
        };

        try {
            // sign and submit transaction to chain, waiting for it to complete
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);

            const gameId = `${account.address}:${gameName}`
            // Initialize the local state
            let browserHistory = createBrowserHistory();
            browserHistory.push(`/game/${gameId}`);
            setAccountHasGame(true);
            setEnteredGameId(gameId);
            setGameId(gameId);
            await fetchGame(gameId);
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
        let [gameAddress, gameName] = splitGameId(gameId);
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::reset_game`,
            type_arguments: [],
            arguments: [gameAddress, gameName],
        };

        try {
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);

            // Cleanup state from previous game
            setAccountHasGame(true);
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
            await fetchGame(gameId)
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
        setTransactionInProgress(true);
        let [gameName] = splitGameId(gameId);
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::delete_game`,
            type_arguments: [],
            arguments: [gameName],
        };

        try {
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);
            setAccountHasGame(false);
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
            await fetchGame(gameId)
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
        let [gameAddress, gameName] = splitGameId(gameId);
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::play_space`,
            type_arguments: [],
            arguments: [gameAddress, gameName, space],
        };

        try {
            const response = await signAndSubmitTransaction(payload);
            await client.waitForTransaction(response.hash);
            setAccountHasGame(true);
        } catch (error: any) {
            setAccountHasGame(false);
        }

        // Fetch the new board
        await fetchGame(gameId);
    }

    return (
        <>
            <Layout>
                <Row align="middle">
                    <Col span={10} offset={2}>
                        <h1>Tic-Tac-Toe</h1>
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
                connected && network?.name as string !== 'Testnet' &&
                <Alert message={`Wallet is connected to ${network?.name}.  Please connect to testnet`} type="warning"/>
            }
            {connected && network?.name as string === "Testnet" && <Spin spinning={transactionInProgress}>
                {!accountHasGame && (
                    <div>
                        <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                            {gameNotFound &&
                                <Col span={8} offset={8}>
                                    <Alert message={`Game is not found at (${gameId})`} type="error"/>
                                </Col>
                            }
                            <Col span={12} offset={8}>
                                <Input.Group compact>
                                    <p>Game Address</p>
                                    <Input
                                        onChange={(event) => {
                                            onChangeGameAddress(event)
                                        }}
                                        style={{width: "calc(100% - 60px)"}}
                                        placeholder="Game Address"
                                        size="large"
                                        defaultValue={gameId}
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
                        <Input.Group>
                            <Row align="middle" gutter={[0, 32]} style={{marginTop: "2rem"}}>
                                {!gameOver &&
                                    <Col span={8} offset={8}>
                                        <Alert
                                            message={`Current player is ${currentPlayer.symbol} (${currentPlayer.address})`}/>
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
                                {gameOver && gameId === account?.address &&
                                    <Col span={8} offset={8}>
                                        <Button onClick={deleteGame} block type="primary"
                                                style={{height: "40px", backgroundColor: "#3f67ff"}}>
                                            Delete game (only the game account can)
                                        </Button>
                                    </Col>
                                }
                            </Row>
                        </Input.Group>
                    </div>
                )}
            </Spin>}
        </>
    );
}

export default App;