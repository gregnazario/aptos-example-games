import { Network } from "@aptos-labs/ts-sdk";

export const NETWORK = "devnet" as const;

export const APTOS_NETWORKS = {
  devnet: Network.DEVNET,
  testnet: Network.TESTNET,
  mainnet: Network.MAINNET,
} as const;

export type AptosNetworkName = keyof typeof APTOS_NETWORKS;

export const APTOS_NETWORK = APTOS_NETWORKS[NETWORK];

export const MODULE_ADDRESS =
  "0x3b36cac0ec1054b6a99facdef2a0015a2858ff75d10251590e606365394ac5bd";

export const NONE = 0;
export const X = 1;
export const O = 2;
export const DRAW = 3;

export const GAME_ID_MAX_CREATOR = 128;
export const GAME_ID_MAX_NAME = 64;
