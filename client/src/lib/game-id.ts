import { z } from "zod";
import { GAME_ID_MAX_CREATOR, GAME_ID_MAX_NAME } from "./constants";

export const gameIdSchema = z.object({
  creator: z.string().trim().min(1).max(GAME_ID_MAX_CREATOR),
  name: z.string().trim().min(1).max(GAME_ID_MAX_NAME),
});

export type GameId = z.infer<typeof gameIdSchema>;
