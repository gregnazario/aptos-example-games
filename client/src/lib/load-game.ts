import type { Aptos } from "@aptos-labs/ts-sdk";
import {
  asAddressString,
  errorMessage,
  parseAccountAddress,
} from "./address";
import { isMissingGameError } from "./aptos-error";
import { MODULE_ADDRESS } from "./constants";
import {
  type GameStateResult,
  markFromNum,
  parseBoard,
  parseWinner,
} from "./game";
import type { GameId } from "./game-id";
import { TtlCache } from "./ttl-cache";

export const NAME_CACHE_TTL_MS = 10 * 60 * 1000;

export type ViewRequest = {
  payload: {
    function: string;
    functionArguments: unknown[];
  };
};

export type LoadGameDeps = {
  view: (request: ViewRequest) => Promise<unknown[]>;
  getPrimaryName: (args: {
    address: string;
  }) => Promise<string | null | undefined>;
  getOwnerAddress: (args: { name: string }) => Promise<unknown>;
  nameCache: TtlCache<string>;
  addressCache: TtlCache<string>;
};

export function createLiveDeps(clients: {
  aptos: Aptos;
  ansAptos: Aptos;
}): LoadGameDeps {
  return {
    view: (request) =>
      clients.aptos.view({
        payload: {
          function: request.payload
            .function as `${string}::${string}::${string}`,
          functionArguments: request.payload.functionArguments as never,
        },
      }),
    getPrimaryName: (args) => clients.ansAptos.getPrimaryName(args),
    getOwnerAddress: (args) => clients.ansAptos.getOwnerAddress(args),
    nameCache: new TtlCache(NAME_CACHE_TTL_MS),
    addressCache: new TtlCache(NAME_CACHE_TTL_MS),
  };
}

export async function resolveToName(
  maybeAddress: string,
  deps: Pick<LoadGameDeps, "getPrimaryName" | "nameCache">,
): Promise<string> {
  const cached = deps.nameCache.get(maybeAddress);
  if (cached) return cached;

  try {
    const name = await deps.getPrimaryName({ address: maybeAddress });
    if (name) {
      const display = name.endsWith(".apt") ? name : `${name}.apt`;
      deps.nameCache.set(maybeAddress, display);
      return display;
    }
  } catch {
    // Fall through to the original identifier.
  }

  deps.nameCache.set(maybeAddress, maybeAddress);
  return maybeAddress;
}

export async function resolveToAddress(
  maybeName: string,
  deps: Pick<LoadGameDeps, "getOwnerAddress" | "addressCache">,
): Promise<string> {
  const trimmed = maybeName.trim();
  const direct = parseAccountAddress(trimmed);
  if (direct) return direct;

  const cached = deps.addressCache.get(trimmed);
  if (cached) return cached;

  const ansName = trimmed.endsWith(".apt") ? trimmed : `${trimmed}.apt`;
  try {
    const owner = await deps.getOwnerAddress({ name: ansName });
    if (owner) {
      const resolved = parseAccountAddress(asAddressString(owner));
      if (resolved) {
        deps.addressCache.set(trimmed, resolved);
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

export async function loadGameState(
  data: GameId,
  deps: LoadGameDeps,
): Promise<GameStateResult> {
  const gameName = data.name;
  let creatorAddress: string;
  try {
    creatorAddress = await resolveToAddress(data.creator, deps);
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
    const creatorName = await resolveToName(creatorAddress, deps);
    const [boardRaw, currentPlayerRaw, playersRaw, winnerRaw] =
      await Promise.all([
        deps.view({
          payload: {
            function: `${MODULE_ADDRESS}::tic_tac_toe::get_board`,
            functionArguments: [creatorAddress, gameName],
          },
        }),
        deps.view({
          payload: {
            function: `${MODULE_ADDRESS}::tic_tac_toe::current_player`,
            functionArguments: [creatorAddress, gameName],
          },
        }),
        deps.view({
          payload: {
            function: `${MODULE_ADDRESS}::tic_tac_toe::players`,
            functionArguments: [creatorAddress, gameName],
          },
        }),
        deps.view({
          payload: {
            function: `${MODULE_ADDRESS}::tic_tac_toe::winner`,
            functionArguments: [creatorAddress, gameName],
          },
        }),
      ]);

    const playerXAddress = asAddressString(playersRaw[0]);
    const playerOAddress = asAddressString(playersRaw[1]);
    const [playerXName, playerOName] = await Promise.all([
      resolveToName(playerXAddress, deps),
      resolveToName(playerOAddress, deps),
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
}

export async function resolveCreator(data: GameId, deps: LoadGameDeps) {
  const creatorAddress = await resolveToAddress(data.creator, deps);
  const creatorName = await resolveToName(creatorAddress, deps);
  return {
    creatorAddress,
    creatorName,
    name: data.name,
  };
}
