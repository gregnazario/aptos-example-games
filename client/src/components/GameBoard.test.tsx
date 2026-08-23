/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GameBoard } from "./GameBoard";
import type { Mark } from "@/lib/game";

afterEach(() => {
  cleanup();
});

const empty: Mark[] = ["", "", "", "", "", "", "", "", ""];

describe("GameBoard", () => {
  test("renders nine cells and reports the clicked index", async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    render(<GameBoard board={empty} onPlay={onPlay} />);
    const cells = screen.getAllByRole("button");
    expect(cells).toHaveLength(9);
    await user.click(cells[4]);
    expect(onPlay).toHaveBeenCalledWith(4);
  });

  test("disables occupied cells", async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const board: Mark[] = ["X", "", "O", "", "", "", "", "", ""];
    render(<GameBoard board={board} onPlay={onPlay} />);
    const cells = screen.getAllByRole("button");
    expect(cells[0]).toBeDisabled();
    expect(cells[2]).toBeDisabled();
    expect(cells[1]).toBeEnabled();
    await user.click(cells[0]);
    expect(onPlay).not.toHaveBeenCalled();
  });

  test("disables every cell when the board is locked", async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    render(<GameBoard board={empty} disabled onPlay={onPlay} />);
    for (const cell of screen.getAllByRole("button")) {
      expect(cell).toBeDisabled();
    }
    await user.click(screen.getAllByRole("button")[0]);
    expect(onPlay).not.toHaveBeenCalled();
  });

  test("highlights a completed win line", () => {
    const board: Mark[] = ["X", "X", "X", "O", "O", "", "", "", ""];
    render(<GameBoard board={board} onPlay={() => {}} />);
    const cells = screen.getAllByRole("button");
    expect(cells[0].className).toContain("border-primary/70");
    expect(cells[1].className).toContain("border-primary/70");
    expect(cells[2].className).toContain("border-primary/70");
    expect(cells[3].className).not.toContain("border-primary/70");
  });
});
