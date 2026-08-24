import { Network } from "@aptos-labs/ts-sdk";
import { describe, expect, test } from "vitest";
import { APTOS_NETWORK, APTOS_NETWORKS, NETWORK } from "./constants";

describe("network mapping", () => {
  test("defaults to testnet and maps onto the SDK enum", () => {
    expect(NETWORK).toBe("testnet");
    expect(APTOS_NETWORK).toBe(APTOS_NETWORKS.testnet);
    expect(APTOS_NETWORK).toBe(Network.TESTNET);
    expect(APTOS_NETWORKS.devnet).toBe(Network.DEVNET);
    expect(APTOS_NETWORKS.mainnet).toBe(Network.MAINNET);
  });
});
