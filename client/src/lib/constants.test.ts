import { Network } from "@aptos-labs/ts-sdk";
import { describe, expect, test } from "vitest";
import { APTOS_NETWORK, APTOS_NETWORKS, NETWORK } from "./constants";

describe("network mapping", () => {
  test("defaults to devnet (legacy module keeps working with no env)", () => {
    expect(NETWORK).toBe("devnet");
    expect(APTOS_NETWORK).toBe(APTOS_NETWORKS.devnet);
    expect(APTOS_NETWORK).toBe(Network.DEVNET);
    expect(APTOS_NETWORKS.testnet).toBe(Network.TESTNET);
    expect(APTOS_NETWORKS.mainnet).toBe(Network.MAINNET);
  });
});
