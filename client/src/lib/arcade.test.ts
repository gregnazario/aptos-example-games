import { beforeEach, describe, expect, it, vi } from "vitest";

const { viewMock } = vi.hoisted(() => ({ viewMock: vi.fn() }));

vi.mock("./aptos", () => ({
  aptos: { view: viewMock },
  ansAptos: {},
}));

import { GameKind, getGameSummary, getOpenGames } from "./arcade";

describe("arcade hub client", () => {
  beforeEach(() => {
    viewMock.mockReset();
  });

  it("returns hub open games unchanged", async () => {
    viewMock.mockResolvedValue([["0x1", "0x2"]]);
    expect(await getOpenGames(GameKind.TicTacToe)).toEqual(["0x1", "0x2"]);
    expect(viewMock).toHaveBeenCalledWith({
      payload: {
        function: expect.stringContaining("::hub::open_games"),
        functionArguments: [GameKind.TicTacToe],
      },
    });
  });

  it("aggregates game summary views into one object", async () => {
    viewMock.mockImplementation(async ({ payload }) => {
      const fn = payload.function.split("::").pop();
      if (fn === "kind") return [GameKind.Checkers];
      if (fn === "phase") return [1];
      if (fn === "stake") return [100n];
      if (fn === "pot") return [200n];
      if (fn === "players") return ["0xa", "0xb"];
      throw new Error(`unexpected view ${fn}`);
    });
    const summary = await getGameSummary("0xgame");
    expect(summary).toEqual({
      address: "0xgame",
      kind: GameKind.Checkers,
      phase: 1,
      stake: "100",
      pot: "200",
      playerA: "0xa",
      playerB: "0xb",
    });
  });
});
