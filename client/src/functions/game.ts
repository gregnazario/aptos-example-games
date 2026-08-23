import { createServerFn } from "@tanstack/react-start";
import { ansAptos, aptos } from "@/lib/aptos";
import { gameIdSchema } from "@/lib/game-id";
import { createLiveDeps, loadGameState, resolveCreator } from "@/lib/load-game";

const deps = createLiveDeps({ aptos, ansAptos });

export const getGameState = createServerFn({ method: "GET" })
  .validator(gameIdSchema)
  .handler(async ({ data }) => loadGameState(data, deps));

export const resolveGameTarget = createServerFn({ method: "GET" })
  .validator(gameIdSchema)
  .handler(async ({ data }) => resolveCreator(data, deps));
