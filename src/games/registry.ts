import type { GameDefinition } from "../core/game";
import { pongGame } from "./pong";
import { snakeDuelGame } from "./snakeDuel";

/**
 * The cabinet's game list, in menu order.
 * Adding a game: write the module, then add it here. Nothing else changes.
 */
export const GAMES: readonly GameDefinition[] = [pongGame, snakeDuelGame];
