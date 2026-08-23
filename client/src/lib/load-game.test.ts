import { AccountAddress } from "@aptos-labs/ts-sdk";
import { describe, expect, test, vi } from "vitest";
import { MODULE_ADDRESS } from "./constants";
import {
  loadGameState,
  resolveCreator,
  resolveToAddress,
  resolveToName,
  type LoadGameDeps,
} from "./load-game";
import { TtlCache } from "./ttl-cache";

const CREATOR = AccountAddress.from(
  `0x${"aa".padStart(64, "0")}`,
).toString();
const PLAYER_X = AccountAddress.from("0x1").toString();
const PLAYER_O = AccountAddress.from("0x2").toString();

function baseDeps(
  overrides: Partial<LoadGameDeps> = {},
): LoadGameDeps {
  return {
    view: vi.fn(async () => {
      throw new Error("unexpected view");
    }),
    getPrimaryName: vi.fn(async () => null),
    getOwnerAddress: vi.fn(async () => null),
    nameCache: new TtlCache<string>(60_000),
    addressCache: new TtlCache<string>(60_000),
    ...overrides,
  };
}

function liveView(options?: {
  board?: Uint8Array;
  current?: [number, string];
  winner?: [number, unknown];
}) {
  const board = options?.board ?? new Uint8Array([1, 2, 0, 0, 0, 0, 0, 0, 0]);
  const current = options?.current ?? ([1, PLAYER_X] as [number, string]);
  const winner = options?.winner ?? ([0, "0x0"] as [number, unknown]);
  return vi.fn(async ({ payload }: { payload: { function: string } }) => {
    const fn = payload.function;
    if (fn === `${MODULE_ADDRESS}::tic_tac_toe::get_board`) return [board];
    if (fn === `${MODULE_ADDRESS}::tic_tac_toe::current_player`) return current;
    if (fn === `${MODULE_ADDRESS}::tic_tac_toe::players`) {
      return [PLAYER_X, PLAYER_O];
    }
    if (fn === `${MODULE_ADDRESS}::tic_tac_toe::winner`) return winner;
    throw new Error(`unexpected view ${fn}`);
  });
}

describe("resolveToAddress", () => {
  test("returns a canonical hex address without calling ANS", async () => {
    const deps = baseDeps();
    await expect(resolveToAddress("0xaa", deps)).resolves.toBe(CREATOR);
    expect(deps.getOwnerAddress).not.toHaveBeenCalled();
  });

  test("resolves a .apt name and caches it", async () => {
    const deps = baseDeps({
      getOwnerAddress: vi.fn(async ({ name }) => {
        if (name === "alice.apt") return CREATOR;
        return null;
      }),
    });
    await expect(resolveToAddress("alice", deps)).resolves.toBe(CREATOR);
    await expect(resolveToAddress("alice", deps)).resolves.toBe(CREATOR);
    expect(deps.getOwnerAddress).toHaveBeenCalledTimes(1);
    expect(deps.getOwnerAddress).toHaveBeenCalledWith({ name: "alice.apt" });
  });

  test("sends unprefixed hex names to ANS instead of padding them", async () => {
    const deps = baseDeps({
      getOwnerAddress: vi.fn(async ({ name }) => {
        if (name === "cafe.apt") return CREATOR;
        return null;
      }),
    });
    await expect(resolveToAddress("cafe", deps)).resolves.toBe(CREATOR);
    expect(deps.getOwnerAddress).toHaveBeenCalledWith({ name: "cafe.apt" });
  });

  test("throws when the name cannot be resolved", async () => {
    const deps = baseDeps();
    await expect(resolveToAddress("nobody", deps)).rejects.toThrow(
      /Could not resolve "nobody"/,
    );
  });
});

describe("resolveToName", () => {
  test("appends .apt and caches the display name", async () => {
    const deps = baseDeps({
      getPrimaryName: vi.fn(async () => "alice"),
    });
    await expect(resolveToName(CREATOR, deps)).resolves.toBe("alice.apt");
    await expect(resolveToName(CREATOR, deps)).resolves.toBe("alice.apt");
    expect(deps.getPrimaryName).toHaveBeenCalledTimes(1);
  });

  test("falls back to the address when ANS fails", async () => {
    const deps = baseDeps({
      getPrimaryName: vi.fn(async () => {
        throw new Error("indexer down");
      }),
    });
    await expect(resolveToName(CREATOR, deps)).resolves.toBe(CREATOR);
  });

  test("does not cache an ANS outage as a missing name", async () => {
    const getPrimaryName = vi
      .fn()
      .mockRejectedValueOnce(new Error("indexer down"))
      .mockResolvedValueOnce("alice");
    const deps = baseDeps({ getPrimaryName });
    await expect(resolveToName(CREATOR, deps)).resolves.toBe(CREATOR);
    await expect(resolveToName(CREATOR, deps)).resolves.toBe("alice.apt");
    expect(getPrimaryName).toHaveBeenCalledTimes(2);
  });
});

describe("loadGameState", () => {
  test("returns a live board from Uint8Array view results", async () => {
    const deps = baseDeps({
      view: liveView(),
      getPrimaryName: vi.fn(async ({ address }) =>
        address === CREATOR ? "host.apt" : null,
      ),
    });
    const result = await loadGameState(
      { creator: "0xaa", name: "default" },
      deps,
    );
    expect(result).toMatchObject({
      found: true,
      creatorAddress: CREATOR,
      creatorName: "host.apt",
      gameName: "default",
      board: ["X", "O", "", "", "", "", "", "", ""],
      playerX: { address: PLAYER_X, name: PLAYER_X },
      playerO: { address: PLAYER_O, name: PLAYER_O },
      current: { symbol: "X", address: PLAYER_X, name: PLAYER_X },
      winner: null,
    });
    expect(deps.view).toHaveBeenCalledTimes(4);
  });

  test("reports a finished game with an O winner", async () => {
    const deps = baseDeps({
      view: liveView({
        current: [0, "0x0"],
        winner: [2, PLAYER_O],
      }),
    });
    const result = await loadGameState(
      { creator: "0xaa", name: "final" },
      deps,
    );
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.current).toBeNull();
    expect(result.winner).toEqual({ symbol: "O", address: PLAYER_O });
  });

  test("returns missing when the store does not exist", async () => {
    const deps = baseDeps({
      view: vi.fn(async () => {
        throw Object.assign(new Error("Move abort"), {
          data: { vm_error_code: 13, message: "ESTORE_NOT_FOUND" },
        });
      }),
    });
    await expect(
      loadGameState({ creator: "0xaa", name: "ghost" }, deps),
    ).resolves.toEqual({
      found: false,
      reason: "missing",
      creator: "0xaa",
      name: "ghost",
    });
  });

  test("returns error when the module is unpublished", async () => {
    const deps = baseDeps({
      view: vi.fn(async () => {
        throw Object.assign(new Error("module missing"), {
          data: { error_code: "module_not_found", message: "module_not_found" },
        });
      }),
    });
    const result = await loadGameState(
      { creator: "0xaa", name: "default" },
      deps,
    );
    expect(result).toMatchObject({
      found: false,
      reason: "error",
      creator: "0xaa",
      name: "default",
    });
  });

  test("returns error when the creator cannot be resolved", async () => {
    const result = await loadGameState(
      { creator: "not-a-name", name: "default" },
      baseDeps(),
    );
    expect(result.found).toBe(false);
    if (result.found || result.reason !== "error") return;
    expect(result.message).toMatch(/Could not resolve/);
  });

  test("returns error on RPC failures", async () => {
    const deps = baseDeps({
      view: vi.fn(async () => {
        throw new Error("429 too many requests");
      }),
    });
    const result = await loadGameState(
      { creator: "0xaa", name: "default" },
      deps,
    );
    expect(result).toMatchObject({
      found: false,
      reason: "error",
      message: "429 too many requests",
    });
  });
});

describe("resolveCreator", () => {
  test("returns the canonical address and ANS name", async () => {
    const deps = baseDeps({
      getPrimaryName: vi.fn(async () => "host"),
    });
    await expect(
      resolveCreator({ creator: "0xaa", name: "default" }, deps),
    ).resolves.toEqual({
      creatorAddress: CREATOR,
      creatorName: "host.apt",
      name: "default",
    });
  });
});
