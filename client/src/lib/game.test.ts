import { describe, expect, test } from "vitest";
import {
  isEmptyMark,
  markFromNum,
  parseBoard,
  parseWinner,
  winningCells,
  type Mark,
} from "./game";

const EMPTY: Mark[] = Array.from({ length: 9 }, () => "");
const XO_EMPTY = ["X", "O", "", "", "", "", "", "", ""] as const;

describe("parseBoard", () => {
  test("Uint8Array is not a JS array (the original ts-sdk miss)", () => {
    expect(Array.isArray(new Uint8Array([1, 2]))).toBe(false);
  });

  test("reads ts-sdk vector<u8> as Uint8Array", () => {
    expect(parseBoard(new Uint8Array([1, 2, 0, 0, 0, 0, 0, 0, 0]))).toEqual([
      ...XO_EMPTY,
    ]);
  });

  test("reads a Uint8Array view with a nonzero byteOffset", () => {
    const packed = new Uint8Array([9, 9, 1, 2, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseBoard(packed.subarray(2))).toEqual([...XO_EMPTY]);
  });

  test("reads ArrayBuffer, number[], and hex strings", () => {
    expect(
      parseBoard(new Uint8Array([1, 2, 0, 0, 0, 0, 0, 0, 0]).buffer),
    ).toEqual([...XO_EMPTY]);
    expect(parseBoard([1, 2, 0, 0, 0, 0, 0, 0, 0])).toEqual([...XO_EMPTY]);
    expect(parseBoard("0x010200000000000000")).toEqual([...XO_EMPTY]);
    expect(parseBoard("010200000000000000")).toEqual([...XO_EMPTY]);
  });

  test("reads Buffer when present", () => {
    expect(parseBoard(Buffer.from([1, 2, 0, 0, 0, 0, 0, 0, 0]))).toEqual([
      ...XO_EMPTY,
    ]);
  });

  test("ignores values past nine cells", () => {
    expect(parseBoard([1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1])).toEqual([
      "X",
      "O",
      "X",
      "O",
      "X",
      "O",
      "X",
      "O",
      "X",
    ]);
  });

  test("returns nine empty cells for unknown input", () => {
    expect(parseBoard(null)).toEqual(EMPTY);
    expect(parseBoard(undefined)).toEqual(EMPTY);
    expect(parseBoard({})).toEqual(EMPTY);
    expect(parseBoard(42)).toEqual(EMPTY);
  });
});

describe("markFromNum / isEmptyMark", () => {
  test("maps chain constants onto marks", () => {
    expect(markFromNum(0)).toBe("");
    expect(markFromNum(1)).toBe("X");
    expect(markFromNum(2)).toBe("O");
    expect(markFromNum(3)).toBe("");
  });

  test("isEmptyMark treats blank and missing cells as empty", () => {
    expect(isEmptyMark("")).toBe(true);
    expect(isEmptyMark(undefined)).toBe(true);
    expect(isEmptyMark("X")).toBe(false);
    expect(isEmptyMark("O")).toBe(false);
  });
});

describe("winningCells", () => {
  const cells = (...marks: Mark[]) => marks;

  test("returns no winners on an empty or mixed board", () => {
    expect(winningCells(EMPTY)).toEqual([]);
    expect(
      winningCells(cells("X", "O", "X", "O", "X", "O", "O", "X", "O")),
    ).toEqual([]);
  });

  test("detects every win line", () => {
    expect(winningCells(cells("X", "X", "X", "", "", "", "", "", ""))).toEqual([
      0, 1, 2,
    ]);
    expect(winningCells(cells("", "", "", "O", "O", "O", "", "", ""))).toEqual([
      3, 4, 5,
    ]);
    expect(winningCells(cells("", "", "", "", "", "", "X", "X", "X"))).toEqual([
      6, 7, 8,
    ]);
    expect(winningCells(cells("O", "", "", "O", "", "", "O", "", ""))).toEqual([
      0, 3, 6,
    ]);
    expect(winningCells(cells("", "X", "", "", "X", "", "", "X", ""))).toEqual([
      1, 4, 7,
    ]);
    expect(winningCells(cells("", "", "O", "", "", "O", "", "", "O"))).toEqual([
      2, 5, 8,
    ]);
    expect(winningCells(cells("X", "", "", "", "X", "", "", "", "X"))).toEqual([
      0, 4, 8,
    ]);
    expect(winningCells(cells("", "", "O", "", "O", "", "O", "", ""))).toEqual([
      2, 4, 6,
    ]);
  });
});

describe("parseWinner", () => {
  test("returns X and O with the winner address", () => {
    expect(parseWinner(1, "0xabc")).toEqual({ symbol: "X", address: "0xabc" });
    expect(parseWinner(2, "0xdef")).toEqual({ symbol: "O", address: "0xdef" });
  });

  test("returns a draw without an address", () => {
    expect(parseWinner(3, "0xabc")).toEqual({ symbol: "Draw", address: "" });
  });

  test("returns null while the game is ongoing", () => {
    expect(parseWinner(0, "0x0")).toBeNull();
  });
});
