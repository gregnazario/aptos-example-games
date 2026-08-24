import { Network } from "@aptos-labs/ts-sdk";

// Env-driven so dev deploys can target devnet while production targets testnet/mainnet.
export const NETWORK = (import.meta.env.VITE_NETWORK ?? "testnet") as
  | "devnet"
  | "testnet"
  | "mainnet";

export const APTOS_NETWORKS = {
  devnet: Network.DEVNET,
  testnet: Network.TESTNET,
  mainnet: Network.MAINNET,
} as const;

export type AptosNetworkName = keyof typeof APTOS_NETWORKS;

export const APTOS_NETWORK = APTOS_NETWORKS[NETWORK];

// Legacy v1 tic-tac-toe module (devnet). The arcade package address comes from env.
export const MODULE_ADDRESS =
  import.meta.env.VITE_TTT_V1_MODULE ??
  "0x3b36cac0ec1054b6a99facdef2a0015a2858ff75d10251590e606365394ac5bd";

// Zero address means "arcade package not deployed here" — the lobby hides itself.
export const ARCADE_PACKAGE: string =
  import.meta.env.VITE_ARCADE_PACKAGE ?? "0x0";

export const NONE = 0;
export const X = 1;
export const O = 2;
export const DRAW = 3;

export const GAME_ID_MAX_CREATOR = 128;
export const GAME_ID_MAX_NAME = 64;
