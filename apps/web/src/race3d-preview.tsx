import React from "react";
import ReactDOM from "react-dom/client";
import { RaceTableScene } from "./components/race3d/RaceTableScene";
import type { PlayerState } from "./protocol";
import "./styles.css";

const athlete = (id: string, position: number, state: Partial<{ tripped: boolean; finished: boolean; finishPosition: number; eliminated: boolean }> = {}) => ({
  id, name: id, nameZh: id, abilityTitleZh: "", abilitySummary: "", position, points: 0,
  finished: state.finished ?? false, finishPosition: state.finishPosition ?? null,
  eliminated: state.eliminated ?? false, tripped: state.tripped ?? false,
});
const ids = ["genius", "banana", "centaur", "baba_yaga", "magician", "hare"];
const players = ids.map((id, index): PlayerState => ({
  id: `p${index}`, name: `玩家 ${index + 1}`, position: index < 3 ? 8 : 0, connected: true, score: 0,
  selectionLocked: true, selectedAthlete: athlete(id, index < 3 ? 8 : index * 5, index === 1 ? { tripped: true } : index === 4 ? { finished: true, finishPosition: 1 } : index === 5 ? { eliminated: true } : {}),
  activeRacers: [athlete(id, index < 3 ? 8 : index * 5, index === 1 ? { tripped: true } : index === 4 ? { finished: true, finishPosition: 1 } : index === 5 ? { eliminated: true } : {})],
  team: [], usedAthleteIds: [], rollValues: null,
}));
const trackName = new URLSearchParams(window.location.search).get("track") === "mild" ? "Standard" : "WildWilds";
const trackTitle = trackName === "Standard" ? "Mild Mile" : "Wild Wilds";

ReactDOM.createRoot(document.getElementById("root")!).render(<main className="table"><section className="stage">
  <div className="race-heading"><div><p className="kicker">RACE 3 / 4</p><h2>{trackTitle}</h2></div></div>
  <RaceTableScene players={players} finishLine={30} trackName={trackName} />
</section></main>);
