import { Layout, Row, Col, Button, Spin, Input, Alert} from "antd";
import { WalletSelector } from "@aptos-labs/wallet-adapter-ant-design";
import "@aptos-labs/wallet-adapter-ant-design/dist/index.css";
import { AptosClient } from "aptos";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import {ChangeEvent, useState} from "react";

// TODO: Load from wallet
export const NODE_URL = "https://fullnode.devnet.aptoslabs.com";
export const client = new AptosClient(NODE_URL);
// TODO: make this more accessible / be deployed by others?
export const moduleAddress = "0x9b6adab7156c48f2f9ed9b5ab783a8c1d550b4130d409d9b1832931c38e4c845";

function App() {
    const [accountHasGame, setAccountHasGame] = useState<boolean>(false);
    const [gameOver, setGameOver] = useState<boolean>(false);
    const [transactionInProgress, setTransactionInProgress] = useState<boolean>(false);
    const [gameAddress, setGameAddress] = useState<string>("");
    const [XAddress, setXAddress] = useState<string>("");
    const [OAddress, setOAddress] = useState<string>("");

    const [currentPlayer, setCurrentPlayer] = useState<{symbol: string, address: string}>({symbol: "", address: ""});
    const [winner, setWinner] = useState<{symbol: string, address: string, alert_type: "success" | "warning" | "error"}>({symbol: "", address: "", alert_type: "warning"});
    const [board, setBoard] = useState<string[]>(["","","","","","","","",""]);
    const { account, signAndSubmitTransaction } = useWallet();

    const onChangeGameAddress = async(event: ChangeEvent<HTMLInputElement>) => {
        // Ensure you're logged in
        if (!account) return [];
        // TODO: Resolve for address also the ANS names
        const value = event.target.value;
        setGameAddress(value);
    }

    const onChangeXAddress = async(event: ChangeEvent<HTMLInputElement>) => {
        // Ensure you're logged in
        if (!account) return [];
        // TODO: Resolve for address also the ANS names
        const value = event.target.value;
        setXAddress(value);
    }
    const onChangeOAddress = async(event: ChangeEvent<HTMLInputElement>) => {
        // Ensure you're logged in
        if (!account) return [];
        // TODO: Resolve for address also the ANS names
        const value = event.target.value;
        setOAddress(value);
    }

    const fetchWinner = async() => {
        // Ensure you're logged in
        if (!account) return [];
        try {
            const player = await client.view({
                arguments: [gameAddress],
                function: `${moduleAddress}::tic_tac_toe::winner`,
                type_arguments: []
            });
            const player_num = player[0] as number;
            let player_address = "";
            let player_symbol = "";
            let type: "success"|"warning"|"error" = "warning"
            if (player_num === 1) {
                player_symbol = "X"
                player_address = player[1].toString();
                setGameOver(true);
            } else if (player_num === 2) {
                player_symbol = "O"
                player_address = player[1].toString();
                setGameOver(true);
            } else if (player_num === 3) {
                player_symbol = "Draw"
                setGameOver(true);
            }

            if (player_address === account?.address) {
                type = "success"
            } else {
                type = "error"
            }

            setWinner({symbol: player_symbol, address: player_address, alert_type: type});
        } catch {
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
        }
    };

    const fetchGame = async() => {
        // Ensure you're logged in
        if (!account) return [];
        setTransactionInProgress(true);
        try {
            const result = await client.view({arguments: [gameAddress], function: `${moduleAddress}::tic_tac_toe::get_board`, type_arguments: []});
            const current_player = await client.view({arguments: [gameAddress], function: `${moduleAddress}::tic_tac_toe::current_player`, type_arguments: []});
            const player_num = current_player[0] as number;
            let player_address = "";
            let player_symbol = "";
             if (player_num === 1) {
                 player_symbol = "X"
                 player_address = current_player[1].toString();
             } else if (player_num === 2) {
                 player_symbol = "O"
                 player_address = current_player[1].toString();
             }

             let layout = ["","","","","","","","",""];
             let board = result[0] as string;
             let index = 0;
            for (let i = 2; i < board.length; i+=2) {
                const symbol_num = board[i+1] as unknown as number
                if (symbol_num === 0) {
                    layout[index] = " ";
                } else if (symbol_num === 1) {
                    layout[index] = "X";
                } else if (symbol_num === 2) {
                    layout[index] = "O";
                }
                index++;
            }
            setCurrentPlayer({ symbol: player_symbol, address: player_address});
            setBoard(layout);
            setAccountHasGame(true);
            await fetchWinner();
        } catch (e: any) {
            setAccountHasGame(false);
        } finally {
            setTransactionInProgress(false);
        }
    };

    const addNewGame = async () => {
        // Ensure you're logged in
        if (!account) return [];
        setTransactionInProgress(true);
        // build a transaction payload to be submitted
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::start_game`,
            type_arguments: [],
            arguments: [XAddress, OAddress],
        };

        try {
            // sign and submit transaction to chain
            const response = await signAndSubmitTransaction(payload);
            // wait for transaction
            await client.waitForTransaction(response.hash);
            setAccountHasGame(true);
            await fetchGame();
        } catch (error: any) {
            setAccountHasGame(false);
        } finally {
            setTransactionInProgress(false);
        }
    };

    const resetGame = async () => {
        // Ensure you're logged in
        if (!account) return [];
        setTransactionInProgress(true);
        // build a transaction payload to be submitted
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::reset_game`,
            type_arguments: [],
            arguments: [gameAddress],
        };

        // TODO: Add simulation to tell if move is valid prior to submission?
        try {
            // sign and submit transaction to chain
            const response = await signAndSubmitTransaction(payload);
            // wait for transaction
            await client.waitForTransaction(response.hash);
            setAccountHasGame(true);
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
            await fetchGame()
        } catch (error: any) {
            // TODO: Log the failure to reset
        } finally {
            setTransactionInProgress(false);
        }
    };
    const deleteGame = async () => {
        // Ensure you're logged in
        if (!account) return [];
        setTransactionInProgress(true);
        // build a transaction payload to be submitted
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::delete_game`,
            type_arguments: [],
            arguments: [],
        };

        // TODO: Add simulation to tell if move is valid prior to submission?
        try {
            // sign and submit transaction to chain
            const response = await signAndSubmitTransaction(payload);
            // wait for transaction
            await client.waitForTransaction(response.hash);
            setAccountHasGame(false);
            setWinner({symbol: "", address: "", alert_type: "warning"});
            setGameOver(false);
            await fetchGame()
        } catch (error: any) {
            // TODO: Log the failure to reset
            setAccountHasGame(false);
        } finally {
            setTransactionInProgress(false);
        }
    };

    const playSpace = async (space: number) => {
        // Ensure you're logged in
        if (!account) return [];
        // build a transaction payload to be submitted
        // TODO: Do an ANS lookup for ANS name to account address
        const payload = {
            type: "entry_function_payload",
            function: `${moduleAddress}::tic_tac_toe::play_space`,
            type_arguments: [],
            // TODO add multiplayer and lookup
            arguments: [gameAddress, space],
        };

        // TODO: Add simulation to tell if move is valid prior to submission?
        try {
            // sign and submit transaction to chain
            const response = await signAndSubmitTransaction(payload);
            // wait for transaction
            await client.waitForTransaction(response.hash);
            setAccountHasGame(true);
        } catch (error: any) {
            setAccountHasGame(false);
        }

        await fetchGame();
    }

    return (
        <>
            <Layout>
                <Row align="middle">
                    <Col span={10} offset={2}>
                        <h1>Tic-Tac-Toe</h1>
                    </Col>
                    <Col span={12} style={{ textAlign: "right", paddingRight: "200px" }}>
                        <WalletSelector />
                    </Col>
                </Row>
            </Layout>
            <Spin spinning={transactionInProgress}>
                {!accountHasGame && (
                    <div>
                        <Row gutter={[0, 32]} style={{ marginTop: "2rem" }}>
                            <Col span={8} offset={8}>
                                <Input.Group compact>
                                    <p>Game Address</p>
                                    <Input
                                        onChange={(event) => {onChangeGameAddress(event)}}
                                        style={{ width: "calc(100% - 60px)" }}
                                        placeholder=""
                                        size="large"
                                        defaultValue={gameAddress}
                                    />
                                    <Button
                                        onClick={() => fetchGame()}
                                        type="primary"
                                        style={{ height: "40px", backgroundColor: "#3f67ff" }}
                                    >
                                        Join Game
                                    </Button>
                                </Input.Group>
                            </Col>
                        </Row>
                        <Row gutter={[0, 32]} style={{ marginTop: "2rem" }}>
                            <Col span={8} offset={8}>
                                <Input.Group compact>
                                    <p>Player X</p>
                                    <Input
                                        onChange={(event) => {onChangeXAddress(event)}}
                                        style={{ width: "calc(100% - 60px)" }}
                                        placeholder=""
                                        size="large"
                                        defaultValue={XAddress}
                                    />

                                    <p>Player O</p>
                                    <Input
                                        onChange={(event) => {onChangeOAddress(event)}}
                                        style={{ width: "calc(100% - 60px)" }}
                                        placeholder=""
                                        size="large"
                                        defaultValue={OAddress}
                                    />
                                    <Button
                                        onClick={addNewGame}
                                        type="primary"
                                        style={{ height: "40px", backgroundColor: "#3f67ff" }}
                                    >
                                        Start new game
                                    </Button>
                                </Input.Group>
                            </Col>
                        </Row>
                    </div>
                )}
                {accountHasGame && (<div>
                        <Input.Group>
                    <Row gutter={[0, 32]} style={{ marginTop: "2rem" }}>
                        {!gameOver &&
                            <Col span={8} offset={8}>
                                <Alert message = {`Current player is ${currentPlayer.symbol} (${currentPlayer.address})`} />
                            </Col>
                        }
                        {gameOver &&
                            <Col span={8} offset={8}>
                            <Alert message = {`Winner is ${winner.symbol} (${winner.address})`} type = {winner.alert_type}/>
                            </Col>
                        }
                        <Col span={8} offset={8}>
                            <Button onClick={() => playSpace(0)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[0]}
                            </Button>
                            <Button onClick={() => playSpace(1)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[1]}
                            </Button>
                            <Button onClick={() => playSpace(2)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[2]}
                            </Button>
                        </Col>
                        <Col span={8} offset={8}>
                            <Button onClick={() => playSpace(3)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[3]}
                            </Button>
                            <Button onClick={() => playSpace(4)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[4]}
                            </Button>
                            <Button onClick={() => playSpace(5)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[5]}
                            </Button>
                        </Col>
                        <Col span={8} offset={8}>
                            <Button onClick={() => playSpace(6)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[6]}
                            </Button>
                            <Button onClick={() => playSpace(7)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[7]}
                            </Button>
                            <Button onClick={() => playSpace(8)} block type="primary" style={{ width: "40px", height: "40px", backgroundColor: "#723e00" }}>
                                {board[8]}
                            </Button>
                        </Col>
                        {gameOver &&
                            <Col span={8} offset={8}>
                                <Button onClick={resetGame} block type="primary" style={{ height: "40px", backgroundColor: "#5f67ff" }}>
                                    Play again?
                                </Button>
                            </Col>
                        }
                        {gameOver && gameAddress === account?.address &&
                            <Col span={8} offset={8}>
                                <Button onClick={deleteGame} block type="primary" style={{ height: "40px", backgroundColor: "#3f67ff" }}>
                                    Delete game (only the game account can)
                                </Button>
                            </Col>
                        }
                    </Row>
                        </Input.Group>
                    </div>
                )}
            </Spin>
        </>
    );
}

export default App;