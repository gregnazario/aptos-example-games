import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { NETWORK } from "./constants";

export const aptos = new Aptos(
  new AptosConfig({
    network: NETWORK === "devnet" ? Network.DEVNET : Network.TESTNET,
  }),
);

// ANS names live on mainnet even when the game contract is on devnet.
export const ansAptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
