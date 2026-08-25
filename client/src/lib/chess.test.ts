import { describe, expect, it } from "vitest";
import {
  colorOf,
  parseSquare,
  pieceGlyph,
  squareName,
  unpackMove,
} from "./chess";

describe("squareName / parseSquare round-trip", () => {
  it("maps index 0 to a8 and 63 to h1", () => {
    expect(squareName(0)).toBe("a8");
    expect(squareName(63)).toBe("h1");
    expect(squareName(60)).toBe("e1");
    expect(squareName(4)).toBe("e8");
  });

  it("round-trips every square index", () => {
    for (let sq = 0; sq < 64; sq += 1) {
      expect(parseSquare(squareName(sq))).toBe(sq);
    }
  });

  it("rejects malformed squares", () => {
    expect(() => parseSquare("i1")).toThrow();
    expect(() => parseSquare("a9")).toThrow();
    expect(() => parseSquare("z")).toThrow();
  });
});

describe("unpackMove", () => {
  it("decodes from/to/promo fields", () => {
    expect(unpackMove((52 << 10) | (36 << 4))).toEqual({
      from: 52,
      to: 36,
      promo: 0,
    });
    // Underpromotion b7-b8 knight: from=9, to=1, promo=2.
    expect(unpackMove((9 << 10) | (1 << 4) | 2)).toEqual({
      from: 9,
      to: 1,
      promo: 2,
    });
  });

  it("survives the maximum packing values", () => {
    expect(unpackMove((63 << 10) | (63 << 4) | 15)).toEqual({
      from: 63,
      to: 63,
      promo: 15,
    });
  });
});

describe("pieceGlyph", () => {
  it("renders unicode glyphs per side", () => {
    expect(pieceGlyph(6)).toBe("♔");
    expect(pieceGlyph(14)).toBe("♚");
    expect(pieceGlyph(1)).toBe("♙");
    expect(pieceGlyph(9)).toBe("♟");
    expect(pieceGlyph(5)).toBe("♕");
    expect(pieceGlyph(13)).toBe("♛");
  });

  it("renders nothing for empty or unknown codes", () => {
    expect(pieceGlyph(0)).toBe("");
    expect(pieceGlyph(7)).toBe("");
    expect(pieceGlyph(99)).toBe("");
  });
});

describe("colorOf", () => {
  const players = { playerA: "0xaaa", playerB: "0xbbb" };

  it("honors the creator-is-white flip bit", () => {
    expect(
      colorOf({ creatorIsWhite: true }, players, "0xAAA"),
    ).toBe("white");
    expect(colorOf({ creatorIsWhite: true }, players, "0xbbb")).toBe("black");
    expect(colorOf({ creatorIsWhite: false }, players, "0xaaa")).toBe("black");
    expect(colorOf({ creatorIsWhite: false }, players, "0xBBB")).toBe("white");
  });

  it("returns null for spectators", () => {
    expect(colorOf({ creatorIsWhite: true }, players, "0xccc")).toBeNull();
  });
});
