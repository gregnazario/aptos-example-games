import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { asAddressString } from "@/lib/address";
import { ansAptos, aptos } from "@/lib/aptos";
import { MODULE_ADDRESS } from "@/lib/constants";
import {
  type GameStateResult,
  markFromNum,
  parseBoard,
  parseWinner,
} from "@/lib/game";

const GameIdSchema = z.object({
  creator: z.string().min(1),
  name: z.string().min(1),
});

async function resolveToName(maybeAddress: string): Promise<string> {
  try {
    const name = await ansAptos.getPrimaryName({ address: maybeAddress });
    if (name) {
      return name.endsWith(".apt") ? name : `${name}.apt`;
    }
  } catch {
    // Fall through to the original identifier.
  }
  return maybeAddress;
}

async function resolveToAddress(maybeName: string): Promise<string> {
  const trimmed = maybeName.trim();
  if (!trimmed) return trimmed;

  const looksLikeName = trimmed.includes(".") || !trimmed.startsWith("0x");
  if (looksLikeName) {
    try {
      const owner = await ansAptos.getOwnerAddress({
        name: trimmed.endsWith(".apt") ? trimmed : `${trimmed}.apt`,
      });
      if (owner) return asAddressString(owner);
    } catch {
      // Treat the input as an address if ANS cannot resolve it.
    }
  }

  return trimmed;
}

export const getGameState = createServerFn({ method: "GET" })
  .validator(GameIdSchema)
  .handler(async ({ data }): Promise<GameStateResult> => {
    const creatorAddress = await resolveToAddress(data.creator);
    const creatorName = await resolveToName(creatorAddress);
    const gameName = data.name;

    try {
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
    } catch {
      return {
        found: false,
        creator: data.creator,
        name: gameName,
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
