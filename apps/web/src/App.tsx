import { useEffect, useMemo, useRef, useState } from "react";
import { RaceTrack } from "./components/RaceTrack";
import { actionId, GameClient, loadSession, roomFromPath, saveSession } from "./gameClient";
import type { AthleteCard, ClientIntent, GameEvent, PlayerState, RoomSnapshot, ServerMessage } from "./protocol";

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type GameAction = Exclude<ClientIntent, { type: "JOIN_ROOM" }>;
type WithoutActionId<T> = T extends { actionId: string } ? Omit<T, "actionId"> : never;
type GameActionInput = WithoutActionId<GameAction>;

const playerColors = ["red", "blue", "yellow", "green", "pink", "purple"];
const tracks = ["Mild Mile", "Mild Mile", "Wild Wilds", "Wild Wilds"];

function eventText(event: GameEvent, players: PlayerState[]): string {
  const player = players.find((item) => item.id === event.playerId);
  if (event.type === "START_DICE_ROLLED") return `${player?.name ?? "玩家"} 掷出 ${event.values?.join(" / ")}`;
  if (event.type === "ROLL_OFF_TIED") return "最高点相同，平局玩家重新掷骰";
  if (event.type === "ATHLETE_DRAFTED") return `${player?.name ?? "玩家"} 完成一次招募`;
  if (event.type === "RACERS_LOCKED") return `${player?.name ?? "玩家"} 已锁定阵容`;
  if (event.type === "DICE_ROLLED") return `${player?.name ?? "玩家"} 掷出 ${event.value}`;
  if (event.type === "RACER_FINISHED") return `${player?.name ?? "玩家"} 的赛车手第 ${event.finishPosition} 名冲线`;
  if (event.type === "RACE_FINISHED") return `第 ${event.raceNumber} 场比赛结束`;
  if (event.type === "PLAYER_JOINED") return `${player?.name ?? "新玩家"} 加入房间`;
  if (event.type === "PLAYER_DISCONNECTED") return `${player?.name ?? "玩家"} 暂时离线`;
  return "";
}

function RacerCard({ athlete, selected, disabled, used, onClick }: {
  athlete: AthleteCard; selected?: boolean; disabled?: boolean; used?: boolean; onClick?: () => void;
}) {
  return (
    <button className={`racer-card ${selected ? "selected" : ""} ${used ? "used" : ""}`}
      disabled={disabled || used} onClick={onClick}>
      <span className="racer-stripe" />
      <span className="racer-art" aria-hidden="true">{athlete.name.slice(0, 1)}</span>
      <span className="racer-copy"><strong>{athlete.nameZh}</strong><small>{athlete.name}</small></span>
      <span className="ability">{athlete.abilitySummary}</span>
      {used && <span className="used-stamp">已退场</span>}
    </button>
  );
}

export default function App() {
  const initialRoomId = roomFromPath();
  const [roomId, setRoomId] = useState(initialRoomId);
  const [playerName, setPlayerName] = useState(loadSession(initialRoomId)?.playerName ?? "");
  const [playerId, setPlayerId] = useState("");
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState("");
  const [feed, setFeed] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const client = useRef(new GameClient());

  useEffect(() => () => client.current.close(), []);
  useEffect(() => setSelectedIds([]), [snapshot?.game.raceNumber, snapshot?.game.phase]);

  const game = snapshot?.game;
  const me = game?.players.find((player) => player.id === playerId);
  const isHost = game?.players[0]?.id === playerId;
  const canStart = game?.phase === "LOBBY" && isHost && game.players.length >= 2;
  const canRollOff = !!game && ["DRAFT_ROLL", "RACE_ROLL"].includes(game.phase)
    && game.rollCandidateIds.includes(playerId) && !me?.rollValues;
  const statusText = useMemo(
    () => ({ connecting: "连接中", connected: "在线", disconnected: "已断开" })[status], [status],
  );

  async function createRoom() {
    setError("");
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) return setError("创建房间失败");
    const data = (await response.json()) as { roomId: string };
    window.history.pushState({}, "", `/room/${data.roomId}`);
    setRoomId(data.roomId);
  }

  function joinRoom() {
    const normalizedRoomId = roomId.trim().toUpperCase();
    const normalizedName = playerName.trim();
    if (!normalizedRoomId || !normalizedName) return setError("请输入房间号和玩家名称");
    setError("");
    const session = loadSession(normalizedRoomId);
    client.current.connect({
      type: "JOIN_ROOM", roomId: normalizedRoomId, playerName: normalizedName,
      playerId: session?.playerId, reconnectToken: session?.reconnectToken,
    }, handleMessage, setStatus);
  }

  function handleMessage(message: ServerMessage) {
    if (message.type === "ERROR") return setError(message.message);
    if (message.type === "ACTION_ACK") return;
    setSnapshot(message);
    if (message.type === "WELCOME") {
      setPlayerId(message.playerId);
      saveSession({ roomId: message.roomId, playerId: message.playerId,
        reconnectToken: message.reconnectToken, playerName: playerName.trim() });
    }
    if (message.type === "STATE_UPDATED") {
      const lines = message.events.map((event) => eventText(event, message.game.players)).filter(Boolean);
      setFeed((current) => [...lines, ...current].slice(0, 10));
    }
    setError("");
  }

  function send(intent: GameActionInput) {
    try {
      client.current.send({ ...intent, actionId: actionId() } as GameAction);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送行动失败");
    }
  }

  function toggleRacer(id: string) {
    if (!game) return;
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < game.selectionCount ? [...current, id] : [...current.slice(1), id]);
  }

  if (!snapshot) {
    return (
      <main className="entry">
        <div className="entry-shade" />
        <section className="entry-brand"><p className="kicker">THE MAGICAL RACE IS ON</p><h1>MAGICAL<br />ATHLETE</h1></section>
        <section className="join-dock" aria-label="加入游戏">
          <label><span>玩家名称</span><input value={playerName} maxLength={24} onChange={(event) => setPlayerName(event.target.value)} placeholder="你的名字" /></label>
          <label><span>房间号</span><input value={roomId} maxLength={8} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="ABCD" /></label>
          <button className="command primary" onClick={joinRoom}>加入房间</button>
          <button className="command secondary" onClick={createRoom}>创建房间</button>
          <span className={`connection ${status}`}>{statusText}</span>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="table">
      <header className="topbar">
        <div className="wordmark">MAGICAL ATHLETE</div>
        <div className="race-progress">
          {tracks.map((track, index) => <div key={`${track}-${index}`} className={`${index + 1 === game!.raceNumber ? "current" : ""} ${index + 1 < game!.raceNumber ? "done" : ""}`}>
            <span>{index + 1}</span><small>{track}</small>
          </div>)}
        </div>
        <div className="room-code"><small>房间</small><strong>{snapshot.roomId}</strong><span className={`status-dot ${status}`} /></div>
      </header>

      {game!.phase === "LOBBY" && (
        <section className="lobby-stage stage">
          <div className="stage-title"><p className="kicker">2–6 PLAYERS</p><h2>等待选手入场</h2><p>房间号 <strong>{snapshot.roomId}</strong></p></div>
          <div className="lobby-players">
            {game!.players.map((player, index) => <div className={`seat ${playerColors[index]}`} key={player.id}><span>{index + 1}</span><strong>{player.name}</strong><small>{player.id === playerId ? "你" : player.connected ? "已连接" : "离线"}</small></div>)}
            {Array.from({ length: Math.max(0, 4 - game!.players.length) }).map((_, index) => <div className="seat empty" key={index}><span>+</span><strong>空位</strong><small>分享房间号</small></div>)}
          </div>
          {game!.players.length === 3 && <div className="variant-control" role="group" aria-label="三人游戏模式">
            <button className={!game!.doubleRacerVariant ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_VARIANT", doubleRacer: false })}>标准 · 每场 1 名</button>
            <button className={game!.doubleRacerVariant ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_VARIANT", doubleRacer: true })}>双赛车手 · 每场 2 名</button>
          </div>}
          <button className="command primary big" disabled={!canStart} onClick={() => send({ type: "START_GAME" })}>{isHost ? "开始游戏" : "等待房主"}</button>
        </section>
      )}

      {(game!.phase === "DRAFT_ROLL" || game!.phase === "RACE_ROLL") && (
        <section className="rolloff-stage stage">
          <div className="stage-title"><p className="kicker">{game!.phase === "DRAFT_ROLL" ? "DRAFT ORDER" : `RACE ${game!.raceNumber}`}</p>
            <h2>{game!.phase === "DRAFT_ROLL" ? "决定首位招募玩家" : "掷骰决定本场先手"}</h2></div>
          <div className="dice-table">
            {game!.players.map((player, index) => <div className={`roll-seat ${playerColors[index]} ${game!.rollCandidateIds.includes(player.id) ? "candidate" : ""}`} key={player.id}>
              <span className="avatar">{player.name.slice(0, 1)}</span><strong>{player.name}</strong>
              <div className="dice-pair">{player.rollValues ? player.rollValues.map((die, dieIndex) => <span key={dieIndex}>{die}</span>) : <span className="waiting">?</span>}</div>
            </div>)}
          </div>
          <button className="command dice-command" disabled={!canRollOff} onClick={() => send({ type: "ROLL_START" })}><span aria-hidden="true">⚄</span>{me?.rollValues ? "等待其他玩家" : "掷两颗骰子"}</button>
        </section>
      )}

      {game!.phase === "DRAFTING" && (
        <section className="draft-stage stage">
          <div className="stage-title row"><div><p className="kicker">DRAFT {game!.draftRound} / {game!.draftRoundCount}</p><h2>{game!.activePlayerId === playerId ? "轮到你招募" : `等待 ${game!.players.find((p) => p.id === game!.activePlayerId)?.name} 选择`}</h2></div><p>公开招募区 · 蛇形顺序</p></div>
          <div className="draft-layout">
            <div className="draft-pool">{game!.draftPool.map((athlete) => <RacerCard key={athlete.id} athlete={athlete} disabled={game!.activePlayerId !== playerId} onClick={() => send({ type: "DRAFT_ATHLETE", athleteId: athlete.id })} />)}</div>
            <aside className="team-board"><h3>队伍</h3>{game!.players.map((player, index) => <div className="team-row" key={player.id}><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong><div>{player.team.map((athlete) => <span title={athlete.nameZh} key={athlete.id}>{athlete.nameZh.slice(0, 1)}</span>)}</div><small>{player.team.length} / {game!.doubleRacerVariant ? 8 : 4}</small></div>)}</aside>
          </div>
        </section>
      )}

      {game!.phase === "CHARACTER_SELECTION" && (
        <section className="selection-stage stage">
          <div className="stage-title row"><div><p className="kicker">RACE {game!.raceNumber} · {tracks[game!.raceNumber - 1]}</p><h2>秘密选择本场赛车手</h2></div><div className="reward"><span>🏆 {game!.raceRewards[0]}</span><span>◉ {game!.raceRewards[1]}</span></div></div>
          <div className="my-team">{me?.team.map((athlete) => <RacerCard key={athlete.id} athlete={athlete} used={me.usedAthleteIds.includes(athlete.id)} selected={selectedIds.includes(athlete.id)} disabled={me.selectionLocked} onClick={() => toggleRacer(athlete.id)} />)}</div>
          <div className="selection-footer"><div>{game!.players.map((player) => <span key={player.id} className={player.selectionLocked ? "locked" : ""}>{player.name} {player.selectionLocked ? "✓" : "…"}</span>)}</div><button className="command primary" disabled={selectedIds.length !== game!.selectionCount || me?.selectionLocked} onClick={() => send({ type: "SELECT_RACERS", athleteIds: selectedIds })}>{me?.selectionLocked ? "阵容已锁定" : `锁定 ${game!.selectionCount} 名赛车手`}</button></div>
        </section>
      )}

      {game!.phase === "RACING" && (
        <section className="race-stage stage">
          <div className="race-heading"><div><p className="kicker">RACE {game!.raceNumber} / 4</p><h2>{tracks[game!.raceNumber - 1]}</h2></div><div className="reward"><span>🏆 {game!.raceRewards[0]}</span><span>◉ {game!.raceRewards[1]}</span></div></div>
          <div className="track-wrap"><RaceTrack players={game!.players} finishLine={game!.finishLine} trackName={game!.trackName} /></div>
          <div className="race-console">
            <div className="score-strip">{game!.players.map((player, index) => <div className={game!.activePlayerId === player.id ? "active" : ""} key={player.id}><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong><small>{player.score} 分</small></div>)}</div>
            <button className="command dice-command" disabled={game!.activePlayerId !== playerId} onClick={() => send({ type: "ROLL_DICE" })}><span aria-hidden="true">⚄</span>{game!.activePlayerId === playerId ? "掷骰并移动" : `等待 ${game!.players.find((p) => p.id === game!.activePlayerId)?.name}`}</button>
          </div>
        </section>
      )}

      {(game!.phase === "RACE_RESULTS" || game!.phase === "FINISHED") && (
        <section className="results-stage stage">
          <div className="stage-title"><p className="kicker">{game!.phase === "FINISHED" ? "FINAL SCORE" : `RACE ${game!.raceNumber} COMPLETE`}</p><h2>{game!.phase === "FINISHED" ? (game!.winnerIds.length > 1 ? "并列冠军" : `${game!.players.find((p) => p.id === game!.winnerIds[0])?.name} 获胜`) : "本场成绩"}</h2></div>
          <div className="podium-list">{game!.players.slice().sort((a, b) => b.score - a.score).map((player, index) => <div key={player.id} className={index === 0 ? "leader" : ""}><span>{index + 1}</span><strong>{player.name}</strong><div className="result-racers">{game!.raceResults.filter((result) => result.playerId === player.id).map((result) => <small key={result.athlete.id}>{result.athlete.nameZh} +{result.points}</small>)}</div><b>{player.score} 分</b></div>)}</div>
          {game!.phase === "RACE_RESULTS" && <button className="command primary big" disabled={!isHost} onClick={() => send({ type: "ADVANCE_RACE" })}>{isHost ? "进入下一场" : "等待房主继续"}</button>}
        </section>
      )}

      {game!.phase !== "LOBBY" && <aside className="event-feed"><strong>赛场动态</strong>{feed.slice(0, 3).map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</aside>}
      {error && <div className="toast" role="alert">{error}<button aria-label="关闭" onClick={() => setError("")}>×</button></div>}
    </main>
  );
}
