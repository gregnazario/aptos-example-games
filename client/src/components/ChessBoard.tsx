interface ChessBoardProps {
  board: number[];
  selected: number | null;
  targets: { to: number; promo: number }[];
  onSquareClick: (square: number) => void;
  /** Render black's perspective when the viewer plays black. */
  flipped: boolean;
}

const GLYPHS: Record<number, string> = {
  1: "♙",
  2: "♘",
  3: "♗",
  4: "♖",
  5: "♕",
  6: "♔",
  9: "♟",
  10: "♞",
  11: "♝",
  12: "♜",
  13: "♛",
  14: "♚",
};

function isLightSquare(sq: number): boolean {
  const row = Math.floor(sq / 8);
  const col = sq % 8;
  return (row + col) % 2 === 0;
}

/**
 * Pure presentational board driven by chain state. Move hints come from the
 * contract's legal_moves view — this component never validates rules itself.
 */
export function ChessBoard({
  board,
  selected,
  targets,
  onSquareClick,
  flipped,
}: ChessBoardProps) {
  const order = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i));
  const targetSet = new Set(targets.map((t) => t.to));
  return (
    <div className="grid aspect-square w-full max-w-xl grid-cols-8 overflow-hidden rounded-lg border border-border shadow-sm select-none">
      {order.map((sq) => (
        <button
          key={sq}
          type="button"
          aria-label={`chess square ${sq}`}
          data-testid={`chess-square-${sq}`}
          data-selected={selected === sq ? "true" : undefined}
          data-target={targetSet.has(sq) ? "true" : undefined}
          onClick={() => onSquareClick(sq)}
          className={[
            "flex items-center justify-center text-3xl leading-none sm:text-4xl",
            isLightSquare(sq) ? "bg-neutral-200" : "bg-neutral-500",
            targetSet.has(sq)
              ? "outline outline-2 -outline-offset-2 outline-emerald-500"
              : "",
            selected === sq
              ? "outline outline-2 -outline-offset-2 outline-sky-600"
              : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {GLYPHS[board[sq]] ?? ""}
        </button>
      ))}
    </div>
  );
}
