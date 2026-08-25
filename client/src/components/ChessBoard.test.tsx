/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

import { ChessBoard } from "./ChessBoard";

const empty = (): number[] => new Array<number>(64).fill(0);

describe("ChessBoard", () => {
  it("renders 64 squares and reports clicks", () => {
    const board = empty();
    board[60] = 6; // white king e1
    const onSquareClick = vi.fn();
    render(
      <ChessBoard
        board={board}
        selected={null}
        targets={[]}
        onSquareClick={onSquareClick}
        flipped={false}
      />,
    );
    expect(screen.getAllByTestId(/chess-square-/)).toHaveLength(64);
    fireEvent.click(screen.getByTestId("chess-square-60"));
    expect(onSquareClick).toHaveBeenCalledWith(60);
  });

  it("marks the selected square and legal targets", () => {
    render(
      <ChessBoard
        board={empty()}
        selected={52}
        targets={[
          { to: 44, promo: 0 },
          { to: 36, promo: 0 },
        ]}
        onSquareClick={() => {}}
        flipped={false}
      />,
    );
    expect(screen.getByTestId("chess-square-52").dataset.selected).toBe("true");
    expect(screen.getByTestId("chess-square-44").dataset.target).toBe("true");
    expect(screen.getByTestId("chess-square-36").dataset.target).toBe("true");
    expect(screen.getByTestId("chess-square-20").dataset.target).toBeUndefined();
  });

  it("flips the rendering order for black's perspective", () => {
    const board = empty();
    board[60] = 6; // e1 white king
    render(
      <ChessBoard
        board={board}
        selected={null}
        targets={[]}
        onSquareClick={() => {}}
        flipped={true}
      />,
    );
    // First rendered cell is index 63 when flipped.
    const first = screen.getAllByTestId(/chess-square-/)[0];
    expect(first.dataset.testid).toBe("chess-square-63");
  });
});
