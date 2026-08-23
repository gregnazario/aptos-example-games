import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { GameBoard } from "@/components/GameBoard";
import { HowToPlay } from "@/components/HowToPlay";
import { WalletClient } from "@/components/WalletProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { getGameState } from "@/functions/game";
import { addressesEqual } from "@/lib/address";
import { aptos } from "@/lib/aptos";
import { MODULE_ADDRESS, NETWORK } from "@/lib/constants";
import { isEmptyMark, type GameState } from "@/lib/game";
import { shortenAddress } from "@/lib/utils";

export const Route = createFileRoute("/game/$creator/$name")({
  loader: async ({ params }) =>
    getGameState({
      data: { creator: params.creator, name: params.name },
    }),
  component: GamePage,
  pendingComponent: GamePending,
});

function GamePending() {
  return (
    <div className="py-20 text-center text-muted-foreground">
      Reading the board from chain…
    </div>
  );
}

function GamePage() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const params = Route.useParams();
  const txPendingRef = useRef(false);
  const routeKey = `${params.creator}/${params.name}`;
  const [cached, setCached] = useState<{ key: string; game: GameState } | null>(
    null,
  );

  useEffect(() => {
    if (result.found) setCached({ key: routeKey, game: result });
  }, [result, routeKey]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      if (txPendingRef.current) return;
      void router.invalidate();
    };
    const timer = window.setInterval(poll, 8000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [router]);

  const lastGame = cached?.key === routeKey ? cached.game : null;

  if (!result.found && result.reason === "missing") {
    return (
      <Card className="mt-6">
        <CardTitle>Game not found</CardTitle>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No board named{" "}
            <span className="text-foreground">{result.name || params.name}</span>{" "}
            exists at {result.creator || params.creator}.
          </p>
          <Button asChild className="mt-2 w-fit">
            <Link to="/">Back to lobby</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!result.found && result.reason === "error" && !lastGame) {
    return (
      <Card className="mt-6">
        <CardTitle>Couldn’t load this board</CardTitle>
        <CardContent>
          <p className="text-sm text-muted-foreground">{result.message}</p>
          <Button
            className="mt-2 w-fit"
            type="button"
            onClick={() => {
              void router.invalidate();
            }}
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const game = result.found ? result : lastGame;
  if (!game) return null;

  return (
    <div className="space-y-4">
      {!result.found ? (
        <Alert variant="warning">
          <AlertDescription>
            Couldn’t refresh the board ({result.message}). Showing the last
            known position.
          </AlertDescription>
        </Alert>
      ) : null}
      <LiveGame game={game} txPendingRef={txPendingRef} />
    </div>
  );
}

function LiveGame({
  game,
  txPendingRef,
}: {
  game: GameState;
  txPendingRef: MutableRefObject<boolean>;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            Live board
          </p>
          <h1 className="font-display text-4xl tracking-tight">
            {game.creatorName}
            <span className="text-muted-foreground"> / {game.gameName}</span>
          </h1>
        </div>
        <Button variant="outline" asChild>
          <Link to="/">Lobby</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardTitle>Players</CardTitle>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <PlayerSlot
              symbol="X"
              player={game.playerX}
              active={game.current?.symbol === "X" && !game.winner}
            />
            <PlayerSlot
              symbol="O"
              player={game.playerO}
              active={game.current?.symbol === "O" && !game.winner}
            />
          </CardContent>
        </Card>

        <StatusBanner game={game} />
      </div>

      <WalletClient
        fallback={<GameBoard board={game.board} disabled onPlay={() => {}} />}
      >
        <InteractiveBoard game={game} txPendingRef={txPendingRef} />
      </WalletClient>

      <HowToPlay variant="game" />
    </div>
  );
}

function PlayerSlot({
  symbol,
  player,
  active,
}: {
  symbol: "X" | "O";
  player: GameState["playerX"];
  active: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        active ? "border-primary/50 bg-primary/5" : "border-border"
      }`}
    >
      <div
        className={`font-display text-3xl ${
          symbol === "X"
            ? "italic text-[color:var(--mark-x)]"
            : "text-[color:var(--mark-o)]"
        }`}
      >
        {symbol}
      </div>
      <div className="mt-1 text-sm font-medium">{player.name}</div>
      <div className="font-mono text-xs text-muted-foreground">
        {shortenAddress(player.address, 6)}
      </div>
    </div>
  );
}

function StatusBanner({ game }: { game: GameState }) {
  if (game.winner) {
    return (
      <Alert variant={game.winner.symbol === "Draw" ? "warning" : "success"}>
        <AlertDescription>
          {game.winner.symbol === "Draw"
            ? "The board is full — it's a draw."
            : `${game.winner.symbol} wins${
                game.winner.address
                  ? ` (${shortenAddress(game.winner.address, 6)})`
                  : ""
              }.`}
        </AlertDescription>
      </Alert>
    );
  }

  if (game.current) {
    return (
      <Alert>
        <AlertDescription>
          {game.current.symbol} to move — {game.current.name}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertDescription>Waiting for chain state…</AlertDescription>
    </Alert>
  );
}

function InteractiveBoard({
  game,
  txPendingRef,
}: {
  game: GameState;
  txPendingRef: MutableRefObject<boolean>;
}) {
  const { account, connected, network, signAndSubmitTransaction } = useWallet();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    txPendingRef.current = pending;
    return () => {
      txPendingRef.current = false;
    };
  }, [pending, txPendingRef]);

  const networkName = network?.name ? String(network.name).toLowerCase() : "";
  const wrongNetwork = connected && networkName !== NETWORK;
  const accountAddress = account?.address?.toString();
  const isMyTurn =
    !!accountAddress &&
    !!game.current &&
    addressesEqual(accountAddress, game.current.address);
  const isCreator = addressesEqual(accountAddress, game.creatorAddress);
  const gameOver = !!game.winner;

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setPending(true);
    try {
      await fn();
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed.");
    } finally {
      setPending(false);
    }
  };

  const playSpace = (space: number) => {
    if (gameOver || !isEmptyMark(game.board[space])) return;
    void run(async () => {
      const response = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::tic_tac_toe::play_space`,
          functionArguments: [game.creatorAddress, game.gameName, space],
        },
      });
      await aptos.waitForTransaction({ transactionHash: response.hash });
    });
  };

  const resetGame = () => {
    void run(async () => {
      const response = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::tic_tac_toe::reset_game`,
          functionArguments: [game.creatorAddress, game.gameName],
        },
      });
      await aptos.waitForTransaction({ transactionHash: response.hash });
    });
  };

  const deleteGame = () => {
    void run(async () => {
      const response = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::tic_tac_toe::delete_game`,
          functionArguments: [game.gameName],
        },
      });
      await aptos.waitForTransaction({ transactionHash: response.hash });
      await router.navigate({ to: "/" });
    });
  };

  return (
    <div className="space-y-4">
      {!connected && (
        <Alert>
          <AlertDescription>
            Connect a wallet to play, reset, or delete this board.
          </AlertDescription>
        </Alert>
      )}
      {wrongNetwork && (
        <Alert variant="warning">
          <AlertDescription>
            Wallet is on {network?.name}. Switch to {NETWORK} to send moves.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <GameBoard
        board={game.board}
        pending={pending}
        disabled={!connected || wrongNetwork || gameOver || !isMyTurn}
        onPlay={playSpace}
      />

      {gameOver && (
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            onClick={resetGame}
            disabled={!connected || wrongNetwork || pending}
          >
            Play again
          </Button>
          {isCreator && (
            <Button
              variant="destructive"
              onClick={deleteGame}
              disabled={pending}
            >
              Delete game
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
