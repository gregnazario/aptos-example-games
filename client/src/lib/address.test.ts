import { AccountAddress } from "@aptos-labs/ts-sdk";
import { describe, expect, test } from "vitest";
import {
  addressesEqual,
  asAddressString,
  errorMessage,
  parseAccountAddress,
} from "./address";

describe("asAddressString", () => {
  test("stringifies SDK-like values", () => {
    expect(asAddressString("0x1")).toBe("0x1");
    expect(asAddressString({ toString: () => "0x2" })).toBe("0x2");
    expect(asAddressString(null)).toBe("");
    expect(asAddressString(undefined)).toBe("");
  });
});

describe("parseAccountAddress", () => {
  test("canonicalizes valid hex addresses", () => {
    const parsed = parseAccountAddress("0x1");
    expect(parsed).toBe(AccountAddress.from("0x1").toString());
    expect(parsed?.startsWith("0x")).toBe(true);
  });

  test("pads short 0x-prefixed addresses", () => {
    const parsed = parseAccountAddress("0xaa");
    expect(parsed).toBe(
      AccountAddress.from(`0x${"aa".padStart(64, "0")}`).toString(),
    );
  });

  test("does not treat unprefixed hex as an address (ANS names like cafe)", () => {
    expect(parseAccountAddress("cafe")).toBeNull();
    expect(parseAccountAddress("dead")).toBeNull();
  });

  test("accepts a LONG hex string without 0x", () => {
    const long = "aa".repeat(32);
    expect(parseAccountAddress(long)).toBe(
      AccountAddress.from(`0x${long}`).toString(),
    );
  });

  test("rejects names and empty strings", () => {
    expect(parseAccountAddress("alice.apt")).toBeNull();
    expect(parseAccountAddress("bob")).toBeNull();
    expect(parseAccountAddress("")).toBeNull();
    expect(parseAccountAddress("0xzz")).toBeNull();
  });
});

describe("addressesEqual", () => {
  test("treats short and padded hex as the same account", () => {
    const canonical = AccountAddress.from("0x1").toString();
    expect(addressesEqual("0x1", canonical)).toBe(true);
    expect(addressesEqual("0xaa", `0x${"aa".padStart(64, "0")}`)).toBe(true);
    expect(addressesEqual("0x1", "0x2")).toBe(false);
    expect(addressesEqual(null, "0x1")).toBe(false);
    expect(addressesEqual("", "0x1")).toBe(false);
  });
});

describe("errorMessage", () => {
  test("prefers Error.message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
  });
});
