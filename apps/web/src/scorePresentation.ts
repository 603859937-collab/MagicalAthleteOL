import type { TFunction } from "i18next";

import i18n from "./i18n";
import type { GamePhase, PlayerState } from "./protocol";

function count(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function scoreLabel(
  player: Pick<PlayerState, "score" | "activeRacers">,
  phase: GamePhase,
  t: TFunction = i18n.t,
  locale: string = i18n.language,
): string {
  const racePoints = player.activeRacers.reduce((sum, racer) => sum + racer.points, 0);
  return phase === "RACING"
    ? t("race:score.racing", { score: count(player.score, locale), race: count(racePoints, locale) })
    : t("race:score.idle", { score: count(player.score, locale) });
}
