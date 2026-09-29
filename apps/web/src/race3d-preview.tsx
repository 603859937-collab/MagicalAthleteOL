import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { RaceTableScene } from "./components/race3d/RaceTableScene";
import { RaceTrack } from "./components/RaceTrack";
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
function BoardPreview() {
  const [trackName, setTrackName] = useState<"Standard" | "WildWilds">(
    new URLSearchParams(window.location.search).get("track") === "mild" ? "Standard" : "WildWilds",
  );
  const [demoPlayers, setDemoPlayers] = useState(players);
  const [focus, setFocus] = useState<{ athleteId: string; close: boolean } | null>(null);
  const [showRacers, setShowRacers] = useState(true);
  const [view, setView] = useState("3d");
  const trackTitle = trackName === "Standard" ? "Mild Mile" : "Wild Wilds";
  const visiblePlayers = showRacers ? demoPlayers : [];

  return <main className={`table ${view === "3d" ? "immersive-race" : ""}`}><section className="stage race-stage">
  <div className="race-heading"><div><p className="kicker">棋盘预览</p><h2>{trackTitle}</h2></div></div>
  <div className="board-preview-controls">
    <div className="variant-control" aria-label="选择棋盘">
      <button className={trackName === "Standard" ? "active" : ""} aria-pressed={trackName === "Standard"}
        onClick={() => setTrackName("Standard")}>Mild Mile</button>
      <button className={trackName === "WildWilds" ? "active" : ""} aria-pressed={trackName === "WildWilds"}
        onClick={() => setTrackName("WildWilds")}>Wild Wilds</button>
    </div>
    <div className="variant-control" aria-label="棋盘视图">
      <button className={view === "3d" ? "active" : ""} aria-pressed={view === "3d"} onClick={() => setView("3d")}>立体桌面</button>
      <button className={view === "2d" ? "active" : ""} aria-pressed={view === "2d"} onClick={() => setView("2d")}>俯视棋盘</button>
    </div>
    <button className="command secondary" aria-pressed={showRacers}
      onClick={() => setShowRacers(!showRacers)}>{showRacers ? "隐藏棋子" : "显示棋子"}</button>
    <button className="command secondary" onClick={() => {
      setFocus({ athleteId: "genius", close: true });
      setDemoPlayers((current) => current.map((player, index) => index ? player : { ...player,
        activeRacers: player.activeRacers.map((racer) => ({ ...racer, position: (racer.position + 1) % 30 })) }));
    }}>演示移动</button>
    <button className="command secondary" onClick={() => setFocus({ athleteId: "banana", close: true })}>技能特写</button>
  </div>
  {view === "2d" ? <div className="track-wrap"><RaceTrack players={visiblePlayers} finishLine={30} trackName={trackName} /></div>
    : <RaceTableScene focus={focus} activePlayerId="p0" players={visiblePlayers} finishLine={30} trackName={trackName} dice={{
    enabled: false,
    targetValue: null,
    restingValue: 4,
    rollKey: "preview",
    autoThrow: false,
    resetKey: 0,
    activePlayerName: "玩家 1",
    onThrow: () => undefined,
    onSettled: () => undefined,
  }} />}
</section></main>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<BoardPreview />);
