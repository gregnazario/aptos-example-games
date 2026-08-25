import { aptos } from "./aptos";
import { ARCADE_PACKAGE } from "./constants";

// Mirrors the outcome constants in move/arcade/sources/chess_rules.move.
export const OUTCOME = {
  Ongoing: 0,
  WhiteMated: 1, // white delivered mate, white won
  BlackMated: 2, // black delivered mate, black won
  Stalemate: 3,
  Insufficient: 4,
  FiftyMove: 5,
  Resigned: 6,
  Forfeited: 7,
} as const;

// Mirrors the piece codes in chess_rules.move: white 1..6, black +8.
export const PIECE = {
  Empty: 0,
  WPawn: 1,
  WKnight: 2,
  WBishop: 3,
  WRook: 4,
  WQueen: 5,
  WKing: 6,
  BPawn: 9,
  BKnight: 10,
  BBishop: 11,
  BRook: 12,
  BQueen: 13,
  BKing: 14,
} as const;

export interface ChessState {
  sideToMove: number; // 0 white, 1 black
  castling: number;
  epSquare: number; // 255 = none
  halfmoveClock: number;
  outcome: number;
  creatorIsWhite: boolean;
}

export interface PackedMove {
  from: number;
  to: number;
  promo: number;
}

const PKG = ARCADE_PACKAGE.trim().toLowerCase();

async function view<T>(fn: string, args: unknown[]): Promise<T[]> {
  const result = await aptos.view({
    payload: {
      function: `${PKG}::${fn}` as `${string}::${string}::${string}`,
      functionArguments: args as never[],
    },
  });
  return result as T[];
}

export async function getChessBoard(address: string): Promise<number[]> {
  const [board] = await view<bigint>("chess::board", [address]);
  return Array.from((board as unknown as number[]) ?? []);
}

export async function getChessState(address: string): Promise<ChessState> {
  const [[stm, castling, ep, clock, outcome, creatorIsWhite]] = await view<
    [number, number, number, bigint, number, boolean]
  >("chess::state", [address]);
  return {
    sideToMove: Number(stm),
    castling: Number(castling),
    epSquare: Number(ep),
    halfmoveClock: Number(clock),
    outcome: Number(outcome),
    creatorIsWhite: Boolean(creatorIsWhite),
  };
}

// The Move view takes Option<u8>; the empty array encodes none.
export async function getLegalMoves(
  address: string,
  from?: number,
): Promise<PackedMove[]> {
  const [moves] = await view<bigint[]>("chess::legal_moves_view", [
    address,
    from === undefined ? [] : [from],
  ]);
  return (Array.isArray(moves) ? moves : []).map((m) => unpackMove(Number(m)));
}

// Same packing as chess_rules::pack_move: from(6b) << 10 | to(6b) << 4 | promo(4b).
export function unpackMove(packed: number): PackedMove {
  return {
    from: (packed >> 10) & 63,
    to: (packed >> 4) & 63,
    promo: packed & 15,
  };
}

const FILES = "abcdefgh";

/** Square index -> algebraic name. Index 0 is a8 (row = 8 - rank). */
export function squareName(sq: number): string {
  return `${FILES[sq % 8]}${8 - Math.floor(sq / 8)}`;
}

export function parseSquare(name: string): number {
  const file = FILES.indexOf(name[0]?.toLowerCase() ?? "");
  const rank = Number(name.slice(1));
  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) {
    throw new Error(`Bad square: ${name}`);
  }
  return (8 - rank) * 8 + file;
}

const GLYPHS = [
  "", "♙", "♘", "♗", "♖", "♕", "♔", "", "",
  "♟", "♞", "♝", "♜", "♛", "♚",
];

export function pieceGlyph(code: number): string {
  return GLYPHS[code] ?? "";
}

/** Which color does `addr` play given the flip bit and wager roster? */
export function colorOf(
  state: Pick<ChessState, "creatorIsWhite">,
  players: { playerA: string; playerB: string },
  addr: string,
): "white" | "black" | null {
  const norm = (a: string) => a.trim().toLowerCase();
  if (norm(addr) === norm(players.playerA)) {
    return state.creatorIsWhite ? "white" : "black";
  }
  if (norm(addr) === norm(players.playerB)) {
    return state.creatorIsWhite ? "black" : "white";
  }
  return null;
}
