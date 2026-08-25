import { Card, CardContent, CardTitle } from "@/components/ui/card";

export function HowToPlay({ variant }: { variant: "lobby" | "game" | "chess" }) {
  const items =
    variant === "lobby"
      ? [
          "Connect any AIP-62 wallet (Petra is listed by default).",
          "Join a game with the creator’s address or .apt name plus the game name.",
          "Create a match by naming it and entering both player addresses.",
          "Share the resulting URL — anyone can watch; only the two players can move.",
        ]
      : variant === "chess"
        ? [
            "Create a game and pick your stake; joining locks both wagers in escrow.",
            "A random draw assigns colors at join — white moves first.",
            "Tap a piece to see its legal moves, tap a square to move. Promotions ask you to pick a piece.",
            "Checkmate wins the pot; stalemate, dead positions, and the fifty-move rule refund both players.",
          ]
        : [
          "Click an empty cell, then approve the transaction in your wallet.",
          "Turns and winners are enforced on-chain, so moves cannot be faked.",
          "The board refreshes automatically while you wait for the other player.",
          "After a win or draw, either player can reset. The creator can delete the game.",
        ];

  return (
    <Card>
      <CardTitle>How to play</CardTitle>
      <CardContent>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
