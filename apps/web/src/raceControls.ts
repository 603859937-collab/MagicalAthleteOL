import type { GameState } from "./protocol";

export function canRollRaceDice(
  game: GameState | undefined,
  playerId: string,
  blocked: boolean,
): boolean {
  return game?.phase === "RACING"
    && (game.pendingRoll?.nextPlayerId ?? game.activePlayerId) === playerId
    && game.resolutionStatus === "WAITING_FOR_ROLL"
    && game.pendingDecision === null
    && !blocked;
}
