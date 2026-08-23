import { DRAW, NONE, O, X } from "./constants";
import { asAddressString } from "./address";

export type Mark = "" | "X" | "O";

export type PlayerInfo = {
  address: string;
  name: string;
};

export type WinnerInfo = {
  symbol: "X" | "O" | "Draw";
  address: string;
};

export type GameState = {
  found: true;
  creatorAddress: string;
  creatorName: string;
  gameName: string;
  board: Mark[];
  playerX: PlayerInfo;
  playerO: PlayerInfo;
  current: { symbol: Exclude<Mark, "">; address: string; name: string } | null;
  winner: WinnerInfo | null;
};

export type MissingGame = {
  found: false;
  reason: "missing";
  creator: string;
  name: string;
};

export type GameLookupError = {
  found: false;
  reason: "error";
  creator: string;
  name: string;
  message: string;
};

export type GameStateResult = GameState | MissingGame | GameLookupError;

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function markFromNum(value: number): Mark {
  if (value === X) return "X";
  if (value === O) return "O";
  return "";
}

function bytesFromUnknown(raw: unknown): number[] | null {
  if (raw instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(raw));
  }
  if (ArrayBuffer.isView(raw)) {
    return Array.from(
      new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
    );
  }
  if (Array.isArray(raw)) {
    return raw.map(Number);
  }
  if (raw && typeof raw === "object" && Symbol.iterator in raw) {
    return Array.from(raw as Iterable<unknown>, Number);
  }
  return null;
}

export function parseBoard(raw: unknown): Mark[] {
  const cells: Mark[] = Array.from({ length: 9 }, () => "");

  if (typeof raw === "string") {
    const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
    for (let i = 0; i < 9; i++) {
      const pair = hex.slice(i * 2, i * 2 + 2);
      if (!pair) break;
      cells[i] = markFromNum(Number.parseInt(pair, 16));
    }
    return cells;
  }

  const bytes = bytesFromUnknown(raw);
  if (!bytes) return cells;
  for (let i = 0; i < 9 && i < bytes.length; i++) {
    cells[i] = markFromNum(Number(bytes[i]));
  }
  return cells;
}

export function winningCells(board: Mark[]): number[] {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return [...line];
    }
  }
  return [];
}

export function parseWinner(
  winnerNum: number,
  winnerAddress: unknown,
): WinnerInfo | null {
  if (winnerNum === X) {
    return { symbol: "X", address: asAddressString(winnerAddress) };
  }
  if (winnerNum === O) {
    return { symbol: "O", address: asAddressString(winnerAddress) };
  }
  if (winnerNum === DRAW) {
    return { symbol: "Draw", address: "" };
  }
  return null;
}

export function isEmptyMark(mark: Mark | undefined): boolean {
  return !mark || mark.trim() === "";
}

export { NONE, X, O, DRAW };
