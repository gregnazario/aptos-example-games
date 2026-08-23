import { Network } from "@aptos-labs/ts-sdk";
import { describe, expect, test } from "vitest";
import { APTOS_NETWORK, APTOS_NETWORKS, NETWORK } from "./constants";

describe("network mapping", () => {
  test("SDK and wallet adapter share one Network enum value", () => {
    expect(NETWORK).toBe("devnet");
    expect(APTOS_NETWORK).toBe(APTOS_NETWORKS.devnet);
    expect(APTOS_NETWORK).toBe(Network.DEVNET);
    expect(APTOS_NETWORKS.testnet).toBe(Network.TESTNET);
    expect(APTOS_NETWORKS.mainnet).toBe(Network.MAINNET);
  });
});
