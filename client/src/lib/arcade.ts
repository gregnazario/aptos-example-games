import { aptos } from "./aptos";
import { ARCADE_PACKAGE } from "./constants";

// Mirrors the constants in move/arcade/sources/wager.move and hub.move.
export enum GameKind {
  TicTacToe = 1,
  Checkers = 2,
  Backgammon = 3,
}

export enum GamePhase {
  Open = 0,
  InProgress = 1,
  Settled = 2,
}

export enum GameEventAction {
  Created = 1,
  Joined = 2,
  Settled = 3,
  Cancelled = 4,
  Forfeited = 5,
}

export interface GameSummary {
  address: string;
  kind: GameKind;
  phase: GamePhase;
  stake: string;
  pot: string;
  playerA: string;
  playerB: string;
}

export function arcadeDeployed(): boolean {
  const value = ARCADE_PACKAGE.trim().toLowerCase();
  // Any all-zero address (0x0, 0x000…0) means "not configured".
  return /^0x[0-9a-f]+$/.test(value) && !/^0x0+$/.test(value);
}

async function view(fn: string, args: unknown[]): Promise<unknown[]> {
  const result = await aptos.view({
    payload: {
      function: `${ARCADE_PACKAGE}::${fn}` as `${string}::${string}::${string}`,
      functionArguments: args as never[],
    },
  });
  return result as unknown[];
}

export async function getOpenGames(kind: GameKind): Promise<string[]> {
  const [games] = await view("hub::open_games", [kind]);
  return Array.isArray(games) ? (games as string[]) : [];
}

export async function getGameSummary(address: string): Promise<GameSummary> {
  const [[kind], [phase], [stake], [pot], players] = await Promise.all([
    view("wager::kind", [address]),
    view("wager::phase", [address]),
    view("wager::stake", [address]),
    view("wager::pot", [address]),
    view("wager::players", [address]),
  ]);
  const [playerA, playerB] = players as [string, string];
  return {
    address,
    kind: kind as GameKind,
    phase: phase as GamePhase,
    stake: String(stake),
    pot: String(pot),
    playerA,
    playerB,
  };
}
