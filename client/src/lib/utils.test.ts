import { describe, expect, test } from "vitest";
import { shortenAddress } from "./utils";

describe("shortenAddress", () => {
  test("keeps short values intact", () => {
    expect(shortenAddress("0x1")).toBe("0x1");
  });

  test("elides the middle of a long address", () => {
    const address = "0x1234567890abcdef1234567890abcdef12345678";
    expect(shortenAddress(address, 4)).toBe("0x1234…5678");
    expect(shortenAddress(address, 6)).toBe("0x123456…345678");
  });
});
