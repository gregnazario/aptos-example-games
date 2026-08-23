import { describe, expect, test } from "vitest";
import { GAME_ID_MAX_CREATOR, GAME_ID_MAX_NAME } from "./constants";
import { gameIdSchema } from "./game-id";

describe("gameIdSchema", () => {
  test("trims creator and name", () => {
    const parsed = gameIdSchema.parse({
      creator: "  0x1  ",
      name: " default ",
    });
    expect(parsed).toEqual({ creator: "0x1", name: "default" });
  });

  test("rejects empty strings", () => {
    expect(gameIdSchema.safeParse({ creator: "", name: "default" }).success).toBe(
      false,
    );
    expect(gameIdSchema.safeParse({ creator: "0x1", name: "   " }).success).toBe(
      false,
    );
  });

  test("rejects values over the length cap", () => {
    expect(
      gameIdSchema.safeParse({
        creator: "a".repeat(GAME_ID_MAX_CREATOR + 1),
        name: "default",
      }).success,
    ).toBe(false);
    expect(
      gameIdSchema.safeParse({
        creator: "0x1",
        name: "n".repeat(GAME_ID_MAX_NAME + 1),
      }).success,
    ).toBe(false);
  });

  test("accepts values at the length cap", () => {
    expect(
      gameIdSchema.safeParse({
        creator: "a".repeat(GAME_ID_MAX_CREATOR),
        name: "n".repeat(GAME_ID_MAX_NAME),
      }).success,
    ).toBe(true);
  });
});
