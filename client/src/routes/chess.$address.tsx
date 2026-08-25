import { createFileRoute } from "@tanstack/react-router";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useCallback, useEffect, useState } from "react";
import { ChessBoard } from "@/components/ChessBoard";
import { HowToPlay } from "@/components/HowToPlay";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GamePhase,
  GameSummary,
  arcadeDeployed,
  getGameSummary,
} from "@/lib/arcade";
import { aptos } from "@/lib/aptos";
import {
  FORFEIT_SECONDS_FALLBACK,
  OUTCOME,
  PackedMove,
  colorOf,
  getChessBoard,
  getChessState,
  getLegalMoves,
  getSecondsSinceLastMove,
  getTimeoutSeconds,
} from "@/lib/chess";
import { ARCADE_PACKAGE } from "@/lib/constants";

export const Route = createFileRoute("/chess/$address")({
  component: ChessPage,
});

const PKG = ARCADE_PACKAGE.trim().toLowerCase();
const POLL_MS = 5_000;

function isOwnPiece(color: "white" | "black", piece: number): boolean {
  if (piece === 0) return false;
  return color === "white" ? piece < 7 : piece >= 9;
}

function outcomeText(outcome: number): string | null {
  switch (outcome) {
    case OUTCOME.WhiteWon:
      return "Checkmate — white wins the pot.";
    case OUTCOME.BlackWon:
      return "Checkmate — black wins the pot.";
    case OUTCOME.Stalemate:
      return "Draw by stalemate — stakes refunded.";
    case OUTCOME.Insufficient:
      return "Draw — insufficient material; stakes refunded.";
    case OUTCOME.FiftyMove:
      return "Draw by the fifty-move rule — stakes refunded.";
    case OUTCOME.Resigned:
      return "Resignation — the opponent takes the pot.";
    case OUTCOME.Forfeited:
      return "Forfeit claimed on timeout.";
    default:
      return null;
  }
}

function ChessPage() {
  const { address: gameAddress } = Route.useParams();
  const { connected, account, signAndSubmitTransaction } = useWallet();

  const [summary, setSummary] = useState<GameSummary | null>(null);
  const [board, setBoard] = useState<number[] | null>(null);
  const [sideToMove, setSideToMove] = useState<number>(0);
  const [creatorIsWhite, setCreatorIsWhite] = useState<boolean>(true);
  const [secondsSinceMove, setSecondsSinceMove] = useState<number>(0);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(FORFEIT_SECONDS_FALLBACK);
  const [outcome, setOutcome] = useState<number>(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [targets, setTargets] = useState<PackedMove[]>([]);
  const [promoPrompt, setPromoPrompt] = useState<{
    from: number;
    to: number;
    options: PackedMove[];
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, state, b, seconds, timeout] = await Promise.all([
        getGameSummary(gameAddress),
        getChessState(gameAddress),
        getChessBoard(gameAddress),
        getSecondsSinceLastMove(gameAddress),
        getTimeoutSeconds(),
      ]);
      setSummary(s);
      setSideToMove(state.sideToMove);
      setCreatorIsWhite(state.creatorIsWhite);
      setOutcome(state.outcome);
      setBoard(b);
      setSecondsSinceMove(seconds);
      setTimeoutSeconds(timeout);
    } catch {
      setError("Could not read this game from chain. Is the address right?");
    }
  }, [gameAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const settled = summary?.phase === GamePhase.Settled;
  const inProgress = summary?.phase === GamePhase.InProgress;

  // Poll for the opponent's moves until the game ends.
  useEffect(() => {
    if (settled) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [settled, refresh]);

  const viewer = account?.address.toString().toLowerCase() ?? "";
  const myColor = summary
    ? colorOf(
        { creatorIsWhite },
        { playerA: summary.playerA, playerB: summary.playerB },
        viewer,
      )
    : null;
  const myTurn =
    myColor !== null &&
    ((sideToMove === 0 && myColor === "white") ||
      (sideToMove === 1 && myColor === "black"));

  // Randomness-bearing entries (chess::join) must NEVER be simulated: the
  // randomness bridge is unavailable during simulation, so a simulated run
  // would abort even though the real transaction succeeds. This dapp performs
  // no simulation anywhere; wallets that pre-simulate must special-case
  // randomness payloads (Petra does). Kept as a separate named path so the
  // constraint is visible at every randomness call site.
  const submitNoSimulation = async (fn: string, args: unknown[]) => {
    setError("");
    setPending(true);
    try {
      const response = await signAndSubmitTransaction({
        data: {
          function: `${PKG}::${fn}` as `${string}::${string}::${string}`,
          functionArguments: args as never[],
        },
      });
      await aptos.waitForTransaction({ transactionHash: response.hash });
      setSelected(null);
      setTargets([]);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed.");
    } finally {
      setPending(false);
    }
  };

  const submit = async (fn: string, args: unknown[]) => submitNoSimulation(fn, args);

  const onSquareClick = async (sq: number) => {
    if (!board || !inProgress || !myTurn || pending) return;
    if (selected === null) {
      if (!isOwnPiece(myColor!, board[sq])) return;
      setSelected(sq);
      try {
        setTargets(await getLegalMoves(gameAddress, sq));
      } catch {
        setError("Could not fetch legal moves from chain.");
      }
      return;
    }
    if (sq === selected) {
      setSelected(null);
      setTargets([]);
      return;
    }
    const matching = targets.filter((t) => t.to === sq);
    if (matching.length > 1) {
      // Promotion: one packed entry per piece; ask which one.
      setPromoPrompt({ from: selected, to: sq, options: matching });
      return;
    }
    if (matching.length === 1) {
      await submit("chess::move_piece", [
        gameAddress,
        matching[0].from,
        sq,
        matching[0].promo,
      ]);
      return;
    }
    // Re-select another own piece, or clear.
    if (isOwnPiece(myColor!, board[sq])) {
      setSelected(sq);
      try {
        setTargets(await getLegalMoves(gameAddress, sq));
      } catch {
        setError("Could not fetch legal moves from chain.");
      }
    } else {
      setSelected(null);
      setTargets([]);
    }
  };

  const onPromoPick = async (promo: number) => {
    if (!promoPrompt) return;
    const { from, to } = promoPrompt;
    setPromoPrompt(null);
    await submit("chess::move_piece", [gameAddress, from, to, promo]);
  };

  const settledBanner = outcomeText(outcome);

  return (
    <div className="grid gap-8 lg:grid-cols-[auto_1fr]">
      <section className="space-y-4 pt-2">
        {settledBanner}
        <h1 className="font-display text-3xl tracking-tight">Wagered chess</h1>
        {summary ? (
          <p className="text-sm text-muted-foreground">
            Stake {summary.stake} octas each · pot {summary.pot} · white:{" "}
            {(creatorIsWhite
              ? summary.playerA
              : summary.playerB
            ).slice(0, 10)}
            …
          </p>
        ) : null}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {myColor && !settled ? (
          <p className="text-sm">
            You play <strong>{myColor}</strong>.{" "}
            {!myTurn ? "Waiting for the opponent…" : "Your move."}
          </p>
        ) : null}
        {!connected && (
          <Alert>
            <AlertDescription>Connect a wallet to interact.</AlertDescription>
          </Alert>
        )}
      </section>

      <div className="space-y-6">
        {board && (
          <ChessBoard
            board={board}
            selected={selected}
            targets={targets}
            onSquareClick={(sq) => void onSquareClick(sq)}
            flipped={myColor === "black"}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>Game actions</CardTitle>
            <CardDescription>
              {arcadeDeployed()
                ? "Everything below is enforced by the chess module on-chain."
                : "Arcade package not configured for this deployment."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {summary && summary.phase === GamePhase.Open && connected && viewer !== summary.playerA.toLowerCase() && (
              <Button
                disabled={pending}
                onClick={() => void submitNoSimulation("chess::join", [gameAddress])}
              >
                Join and escrow stake
              </Button>
            )}
            {summary && summary.phase === GamePhase.Open && viewer === summary.playerA.toLowerCase() && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void submit("wager::cancel", [gameAddress])}
              >
                Cancel game
              </Button>
            )}
            {inProgress && myColor && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void submit("chess::resign", [gameAddress])}
              >
                Resign
              </Button>
            )}
            {inProgress && myColor && secondsSinceMove > timeoutSeconds && !myTurn && (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() => void submit("chess::claim_forfeit", [gameAddress])}
              >
                Claim forfeit (opponent stalled)
              </Button>
            )}
            {inProgress && myColor && secondsSinceMove > timeoutSeconds && myTurn && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => void submit("wager::forfeit_timeout", [gameAddress])}
              >
                Claim timeout refund
              </Button>
            )}
            {settled && (
              <p className="text-sm text-muted-foreground">
                This game has settled. Create a fresh one from the lobby.
              </p>
            )}
          </CardContent>
        </Card>

        <HowToPlay variant="chess" />
      </div>

      <Dialog
        open={promoPrompt !== null}
        onOpenChange={(open) => !open && setPromoPrompt(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote your pawn</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2 text-center text-3xl">
            {[5, 4, 3, 2].map((code) => (
              <Button
                key={code}
                variant="outline"
                disabled={pending}
                onClick={() => void onPromoPick(code)}
                aria-label={code === 5 ? "promote to queen" : code === 4 ? "promote to rook" : code === 3 ? "promote to bishop" : "promote to knight"}
              >
                {code === 5 ? "♕" : code === 4 ? "♖" : code === 3 ? "♗" : "♘"}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
