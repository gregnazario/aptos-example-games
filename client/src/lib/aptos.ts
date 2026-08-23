import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { APTOS_NETWORK } from "./constants";

export const aptos = new Aptos(new AptosConfig({ network: APTOS_NETWORK }));

// ANS names live on mainnet even when the game contract is on another network.
export const ansAptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
