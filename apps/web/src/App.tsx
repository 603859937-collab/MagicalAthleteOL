import { useEffect, useMemo, useRef, useState } from "react";
import { RaceTrack } from "./components/RaceTrack";
import { actionId, GameClient, loadSession, roomFromPath, saveSession } from "./gameClient";
import type { GameEvent, RoomSnapshot, ServerMessage } from "./protocol";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

function eventText(event: GameEvent, players: RoomSnapshot["game"]["players"]): string {
  const player = players.find((item) => item.id === (event.playerId ?? event.winnerId));
  if (event.type === "DICE_ROLLED") return `${player?.name ?? "玩家"} 掷出了 ${event.value}`;
  if (event.type === "GAME_STARTED") return "比赛开始";
  if (event.type === "ATHLETES_DEALT") return "角色牌已经发放";
  if (event.type === "ATHLETE_SELECTION_LOCKED") return `${player?.name ?? "玩家"} 已锁定角色`;
  if (event.type === "ATHLETES_REVEALED") return "所有角色已揭示";
  if (event.type === "RACE_FINISHED") return `${player?.name ?? "玩家"} 获胜`;
  if (event.type === "PLAYER_JOINED") return `${player?.name ?? "新玩家"} 加入房间`;
  if (event.type === "PLAYER_DISCONNECTED") return `${player?.name ?? "玩家"} 暂时离线`;
  return "";
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
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const client = useRef(new GameClient());

  useEffect(() => () => client.current.close(), []);

  const me = snapshot?.game.players.find((player) => player.id === playerId);
  const isHost = snapshot?.game.players[0]?.id === playerId;
  const canStart = snapshot?.game.phase === "LOBBY" && isHost && snapshot.game.players.length >= 2;
  const canRoll = snapshot?.game.phase === "RACING" && snapshot.game.activePlayerId === playerId;
  const winner = snapshot?.game.players.find((player) => player.id === snapshot.game.winnerId);
  const statusText = useMemo(
    () => ({ connecting: "连接中", connected: "已连接", disconnected: "未连接" })[status],
    [status],
  );

  async function createRoom() {
    setError("");
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) {
      setError("创建房间失败");
      return;
    }
    const data = (await response.json()) as { roomId: string };
    window.history.pushState({}, "", `/room/${data.roomId}`);
    setRoomId(data.roomId);
  }

  function joinRoom() {
    const normalizedRoomId = roomId.trim().toUpperCase();
    const normalizedName = playerName.trim();
    if (!normalizedRoomId || !normalizedName) {
      setError("请输入房间号和玩家名称");
      return;
    }
    setError("");
    const session = loadSession(normalizedRoomId);
    client.current.connect(
      {
        type: "JOIN_ROOM",
        roomId: normalizedRoomId,
        playerName: normalizedName,
        playerId: session?.playerId,
        reconnectToken: session?.reconnectToken,
      },
      handleMessage,
      setStatus,
    );
  }

  function handleMessage(message: ServerMessage) {
    if (message.type === "ERROR") {
      setError(message.message);
      return;
    }
    if (message.type === "ACTION_ACK") return;
    setSnapshot(message);
    if (message.type === "WELCOME") {
      setPlayerId(message.playerId);
      saveSession({
        roomId: message.roomId,
        playerId: message.playerId,
        reconnectToken: message.reconnectToken,
        playerName: playerName.trim(),
      });
    }
    if (message.type === "STATE_UPDATED") {
      const lines = message.events.map((event) => eventText(event, message.game.players)).filter(Boolean);
      setFeed((current) => [...lines, ...current].slice(0, 8));
    }
  }

  function send(type: "START_GAME" | "ROLL_DICE") {
    try {
      client.current.send({ type, actionId: actionId() });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送行动失败");
    }
  }

  function lockAthlete() {
    if (!selectedAthleteId) return;
    try {
      client.current.send({
        type: "SELECT_ATHLETE",
        actionId: actionId(),
        athleteId: selectedAthleteId,
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "锁定角色失败");
    }
  }

  if (!snapshot) {
    return (
      <main className="landing shell">
        <section className="hero">
          <p className="eyebrow">ONLINE BOARD GAME</p>
          <h1>Magical Athlete</h1>
          <p className="subtitle">召集朋友，分享房间号，然后让骰子决定赛场上的魔法。</p>
        </section>
        <section className="join-card panel">
          <label>玩家名称<input value={playerName} maxLength={24} onChange={(event) => setPlayerName(event.target.value)} placeholder="例如：Alice" /></label>
          <label>房间号<input value={roomId} maxLength={8} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="ABCD" /></label>
          <button className="primary" onClick={joinRoom}>加入房间</button>
          <button className="secondary" onClick={createRoom}>创建新房间</button>
          <p className={`connection ${status}`}>{statusText}</p>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="game shell">
      <header className="topbar">
        <div><p className="eyebrow">ROOM</p><h1>{snapshot.roomId}</h1></div>
        <div className={`connection ${status}`}>{statusText} · 修订 {snapshot.revision}</div>
      </header>
      {snapshot.game.phase === "CHARACTER_SELECTION" ? (
        <section className="selection-stage">
          <div className="selection-heading">
            <div><p className="eyebrow">RACE ONE</p><h2>秘密选择你的出场角色</h2></div>
            <p>{me?.selectionLocked ? "角色已锁定，等待其他玩家。" : "其他玩家看不到你的手牌和选择。"}</p>
          </div>
          <div className="athlete-grid">
            {snapshot.game.hand.map((athlete) => (
              <button
                className={`athlete-card ${selectedAthleteId === athlete.id ? "selected" : ""}`}
                disabled={me?.selectionLocked}
                key={athlete.id}
                onClick={() => setSelectedAthleteId(athlete.id)}
              >
                <span className="card-number">MA · {athlete.id.slice(0, 2).toUpperCase()}</span>
                <span className="card-mark" aria-hidden="true">✦</span>
                <strong>{athlete.nameZh}</strong>
                <span className="english-name">{athlete.name}</span>
                <span className="ability-copy">{athlete.abilitySummary}</span>
              </button>
            ))}
          </div>
          <button className="primary lock-button" disabled={!selectedAthleteId || me?.selectionLocked} onClick={lockAthlete}>
            {me?.selectionLocked ? "已锁定" : "确认并锁定角色"}
          </button>
        </section>
      ) : snapshot.game.phase === "RACING" || snapshot.game.phase === "FINISHED" ? (
        <section className="track panel reveal"><RaceTrack players={snapshot.game.players} finishLine={snapshot.game.finishLine} /></section>
      ) : null}
      <section className="dashboard">
        <div className="panel players">
          <h2>参赛者</h2>
          {snapshot.game.players.map((player, index) => (
            <div className={`player ${snapshot.game.activePlayerId === player.id ? "active" : ""}`} key={player.id}>
              <span>{index + 1}. {player.name}{player.id === playerId ? "（你）" : ""}</span>
              <strong>
                {snapshot.game.phase === "CHARACTER_SELECTION"
                  ? player.selectionLocked ? "已准备" : "选择中"
                  : player.selectedAthlete?.nameZh ?? `${player.position} / ${snapshot.game.finishLine}`}
              </strong>
            </div>
          ))}
        </div>
        <div className="panel controls">
          <h2>{winner ? `${winner.name} 获胜！` : canRoll ? "轮到你了" : snapshot.game.phase === "LOBBY" ? "等待开赛" : snapshot.game.phase === "CHARACTER_SELECTION" ? "等待角色锁定" : "等待其他玩家"}</h2>
          <p>{snapshot.game.phase === "RACING" && me ? `你的${me.selectedAthlete?.nameZh ?? "运动员"}位于第 ${me.position} 格。` : ""}</p>
          {snapshot.game.phase === "LOBBY" && <button className="primary" disabled={!canStart} onClick={() => send("START_GAME")}>{isHost ? "开始比赛" : "等待房主开始"}</button>}
          {snapshot.game.phase === "RACING" && <button className="dice" disabled={!canRoll} onClick={() => send("ROLL_DICE")}>掷骰子</button>}
          {error && <p className="error">{error}</p>}
        </div>
        <div className="panel feed"><h2>赛场动态</h2>{feed.length ? feed.map((line, index) => <p key={`${line}-${index}`}>{line}</p>) : <p>等待第一声发令枪……</p>}</div>
      </section>
    </main>
  );
}
