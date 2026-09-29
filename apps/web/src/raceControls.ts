import type { GameState } from "./protocol";

export function raceDiceTurnKey(game: GameState, playbackBusy: boolean): string | undefined {
  if (game.phase !== "RACING" || playbackBusy || game.pendingDecision
    || game.resolutionStatus !== "WAITING_FOR_ROLL") return undefined;
  if (game.pendingRoll) return `${game.raceNumber}:${game.pendingRoll.id}:${game.pendingRoll.throwIndex}`;
  const lastRoll = [...game.raceLog].reverse().find((event) => event.type === "DICE_ROLLED");
  return `${game.raceNumber}:main:${game.activePlayerId}:${lastRoll?.rollSerial ?? game.raceLog.length}`;
}

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
