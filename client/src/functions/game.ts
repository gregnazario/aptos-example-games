import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  asAddressString,
  errorMessage,
  parseAccountAddress,
} from "@/lib/address";
import { ansAptos, aptos } from "@/lib/aptos";
import {
  GAME_ID_MAX_CREATOR,
  GAME_ID_MAX_NAME,
  MODULE_ADDRESS,
} from "@/lib/constants";
import {
  type GameStateResult,
  markFromNum,
  parseBoard,
  parseWinner,
} from "@/lib/game";

const GameIdSchema = z.object({
  creator: z.string().trim().min(1).max(GAME_ID_MAX_CREATOR),
  name: z.string().trim().min(1).max(GAME_ID_MAX_NAME),
});

const NAME_CACHE_TTL_MS = 10 * 60 * 1000;
const nameCache = new Map<string, { value: string; expires: number }>();
const addressCache = new Map<string, { value: string; expires: number }>();

function cacheGet(map: Map<string, { value: string; expires: number }>, key: string) {
  const hit = map.get(key);
  if (!hit || hit.expires <= Date.now()) {
    if (hit) map.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(
  map: Map<string, { value: string; expires: number }>,
  key: string,
  value: string,
) {
  map.set(key, { value, expires: Date.now() + NAME_CACHE_TTL_MS });
}

function aptosErrorPayload(error: unknown): {
  errorCode?: string;
  vmErrorCode?: number;
  message: string;
} {
  if (!error || typeof error !== "object") {
    return { message: errorMessage(error) };
  }
  const err = error as {
    data?: {
      error_code?: string;
      message?: string;
      vm_error_code?: number;
    };
    message?: string;
  };
  return {
    errorCode: err.data?.error_code,
    vmErrorCode: err.data?.vm_error_code,
    message: `${err.data?.message ?? ""} ${err.message ?? ""}`,
  };
}

/** Move abort codes from tic-tac-toe.move: EGAME_NOT_FOUND=8, ESTORE_NOT_FOUND=13. */
const MISSING_GAME_ABORT_CODES = new Set([8, 13]);

function isMissingGameError(error: unknown): boolean {
  const { errorCode, vmErrorCode, message } = aptosErrorPayload(error);
  if (vmErrorCode != null && MISSING_GAME_ABORT_CODES.has(Number(vmErrorCode))) {
    return true;
  }
  // Resource missing on the creator account — not a missing published module.
  if (
    errorCode === "resource_not_found" ||
    errorCode === "table_item_not_found"
  ) {
    return true;
  }
  const text = message.toLowerCase();
  if (
    text.includes("egame_not_found") ||
    text.includes("estore_not_found") ||
    text.includes("game not found") ||
    text.includes("store not found")
  ) {
    return true;
  }
  return (
    /\babort code[:\s]+(?:0x)?(?:8|13|d)\b/.test(text) ||
    /tic_tac_toe[:\s]+(?:0x)?(?:8|13|d)\b/.test(text)
  );
}

async function resolveToName(maybeAddress: string): Promise<string> {
  const cached = cacheGet(nameCache, maybeAddress);
  if (cached) return cached;

  try {
    const name = await ansAptos.getPrimaryName({ address: maybeAddress });
    if (name) {
      const display = name.endsWith(".apt") ? name : `${name}.apt`;
      cacheSet(nameCache, maybeAddress, display);
      return display;
    }
  } catch {
    // Fall through to the original identifier.
  }

  cacheSet(nameCache, maybeAddress, maybeAddress);
  return maybeAddress;
}

async function resolveToAddress(maybeName: string): Promise<string> {
  const trimmed = maybeName.trim();
  const direct = parseAccountAddress(trimmed);
  if (direct) return direct;

  const cached = cacheGet(addressCache, trimmed);
  if (cached) return cached;

  const ansName = trimmed.endsWith(".apt") ? trimmed : `${trimmed}.apt`;
  try {
    const owner = await ansAptos.getOwnerAddress({ name: ansName });
    if (owner) {
      const resolved = parseAccountAddress(asAddressString(owner));
      if (resolved) {
        cacheSet(addressCache, trimmed, resolved);
        return resolved;
      }
    }
  } catch {
    // Unresolvable names are reported below.
  }

  throw new Error(
    `Could not resolve "${trimmed}" to an Aptos address. Use 0x… or a .apt name.`,
  );
}

export const getGameState = createServerFn({ method: "GET" })
  .validator(GameIdSchema)
  .handler(async ({ data }): Promise<GameStateResult> => {
    const gameName = data.name;
    let creatorAddress: string;
    try {
      creatorAddress = await resolveToAddress(data.creator);
    } catch (error) {
      return {
        found: false,
        reason: "error",
        creator: data.creator,
        name: gameName,
        message: errorMessage(error),
      };
    }

    try {
      const creatorName = await resolveToName(creatorAddress);
      const [boardRaw, currentPlayerRaw, playersRaw, winnerRaw] =
        await Promise.all([
          aptos.view({
            payload: {
              function: `${MODULE_ADDRESS}::tic_tac_toe::get_board`,
              functionArguments: [creatorAddress, gameName],
            },
          }),
          aptos.view({
            payload: {
              function: `${MODULE_ADDRESS}::tic_tac_toe::current_player`,
              functionArguments: [creatorAddress, gameName],
            },
          }),
          aptos.view({
            payload: {
              function: `${MODULE_ADDRESS}::tic_tac_toe::players`,
              functionArguments: [creatorAddress, gameName],
            },
          }),
          aptos.view({
            payload: {
              function: `${MODULE_ADDRESS}::tic_tac_toe::winner`,
              functionArguments: [creatorAddress, gameName],
            },
          }),
        ]);

      const playerXAddress = asAddressString(playersRaw[0]);
      const playerOAddress = asAddressString(playersRaw[1]);
      const [playerXName, playerOName] = await Promise.all([
        resolveToName(playerXAddress),
        resolveToName(playerOAddress),
      ]);

      const currentNum = Number(currentPlayerRaw[0]);
      const currentAddress = asAddressString(currentPlayerRaw[1]);
      const currentSymbol = markFromNum(currentNum);
      const current =
        currentSymbol === "X" || currentSymbol === "O"
          ? {
              symbol: currentSymbol,
              address: currentAddress,
              name: currentSymbol === "X" ? playerXName : playerOName,
            }
          : null;

      return {
        found: true,
        creatorAddress,
        creatorName,
        gameName,
        board: parseBoard(boardRaw[0]),
        playerX: { address: playerXAddress, name: playerXName },
        playerO: { address: playerOAddress, name: playerOName },
        current,
        winner: parseWinner(Number(winnerRaw[0]), winnerRaw[1]),
      };
    } catch (error) {
      if (isMissingGameError(error)) {
        return {
          found: false,
          reason: "missing",
          creator: data.creator,
          name: gameName,
        };
      }
      return {
        found: false,
        reason: "error",
        creator: data.creator,
        name: gameName,
        message: errorMessage(error),
      };
    }
  });

export const resolveGameTarget = createServerFn({ method: "GET" })
  .validator(GameIdSchema)
  .handler(async ({ data }) => {
    const creatorAddress = await resolveToAddress(data.creator);
    const creatorName = await resolveToName(creatorAddress);
    return {
      creatorAddress,
      creatorName,
      name: data.name,
    };
  });
