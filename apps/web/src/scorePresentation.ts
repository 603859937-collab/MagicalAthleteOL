import type { GamePhase, PlayerState } from "./protocol";

export function scoreLabel(player: Pick<PlayerState, "score" | "activeRacers">, phase: GamePhase): string {
  const racePoints = player.activeRacers.reduce((sum, racer) => sum + racer.points, 0);
  return phase === "RACING"
    ? `${player.score} 分 + 本场 ${racePoints} 分`
    : `${player.score} 分`;
}
