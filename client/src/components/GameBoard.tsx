import { cn } from "@/lib/utils";
import { isEmptyMark, type Mark, winningCells } from "@/lib/game";

export function GameBoard({
  board,
  disabled,
  pending,
  onPlay,
}: {
  board: Mark[];
  disabled?: boolean;
  pending?: boolean;
  onPlay: (space: number) => void;
}) {
  const winners = winningCells(board);

  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-sm grid-cols-3 gap-3",
        pending && "pointer-events-none opacity-60",
      )}
    >
      {board.map((mark, index) => {
        const isWin = winners.includes(index);
        const empty = isEmptyMark(mark);
        return (
          <button
            key={index}
            type="button"
            disabled={disabled || !empty}
            onClick={() => onPlay(index)}
            className={cn(
              "aspect-square rounded-3xl border text-5xl transition",
              "bg-[#0d1714] shadow-[inset_0_1px_0_rgb(255_255_255_/_0.04)]",
              empty
                ? "border-border text-transparent hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/5"
                : "border-border/80",
              isWin && "border-primary/70 bg-primary/10 shadow-[0_0_24px_rgb(62_224_176_/_0.2)]",
              mark === "X" && "font-display italic text-[color:var(--mark-x)]",
              mark === "O" && "font-sans font-semibold text-[color:var(--mark-o)]",
            )}
          >
            {empty ? "" : mark}
          </button>
        );
      })}
    </div>
  );
}
