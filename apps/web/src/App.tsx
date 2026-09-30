import { SelectionCard } from "./components/SelectionCard";
import { useBackgroundMusic } from "./useBackgroundMusic";
import { AthleteRules } from "./components/AthleteRules";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { decisionTitle, decisionPrompt, decisionOptionLabel } from "./decisionPresentation";
import { ActionMoment } from "./components/ActionMoment";
import { actionMoment, eventText, isRedundantAbilityEvent, rollOffPresentation, type ActionMoment as Moment } from "./eventPresentation";
import { RaceTrack } from "./components/RaceTrack";
import { actionId, clearSession, GameClient, loadSession, roomFromPath, saveSession } from "./gameClient";
import type { ActiveRacer, AthleteCard, ClientIntent, GameEvent, PlayerState, RoomSnapshot, ServerMessage } from "./protocol";
import { collectUnseenRollValues, latestAuthoritativeRollValue } from "./rollPresentation";
import { canRollRaceDice, raceDiceTurnKey } from "./raceControls";
import { apiUrl, assetUrl } from "./runtimeConfig";
import { scoreLabel } from "./scorePresentation";
import { playCharacterScoreSound, playMoveSound, playFireworkSound, unlockGameAudio } from "./gameAudio";

type ConnectionStatus = "connecting" | "connected" | "disconnected";
type GameAction = Exclude<ClientIntent, { type: "JOIN_ROOM" }>;
type WithoutActionId<T> = T extends { actionId: string } ? Omit<T, "actionId"> : never;
type GameActionInput = WithoutActionId<GameAction>;
type RollAnimation = { revision: number; values: number[]; index: number; autoThrow: boolean; throwKey: string };
type RacePlayback = {
  revision: number;
  values: number[];
  events: GameEvent[];
  finalSnapshot: RoomSnapshot;
  autoThrow: boolean;
  throwKey: string;
};
type ViewState = {
  authoritative: RoomSnapshot | null;
  display: RoomSnapshot | null;
  playbackBusy: boolean;
};

const RaceTableScene = lazy(() => import("./components/race3d/RaceTableScene").then((module) => ({ default: module.RaceTableScene })));
const use3DRaceTable = new URLSearchParams(window.location.search).get("race3d") !== "false";

const playerColors = ["red", "blue", "yellow", "green", "pink", "purple"];
const tracks = ["Mild Mile", "Mild Mile", "Wild Wilds", "Wild Wilds"];
const cardAccents: Record<string, string> = {
  alchemist: "#f6d51f", baba_yaga: "#68aeda", banana: "#d965ab", blimp: "#68aeda",
  centaur: "#b88ac8", cheerleader: "#68aeda", coach: "#b88ac8", copycat: "#ef432d",
  dicemonger: "#f6d51f", duelist: "#d965ab", egg: "#319a55", flip_flop: "#ef432d",
  genius: "#f6d51f", gunk: "#ef7f2b", hare: "#68aeda", heckler: "#319a55",
  huge_baby: "#319a55", hypnotist: "#f6d51f", inchworm: "#ef432d", lackey: "#ef432d",
  leaptoad: "#ef7f2b", legs: "#319a55", lovable_loser: "#ef7f2b", magician: "#ef7f2b",
  mastermind: "#d965ab", mouth: "#319a55", party_animal: "#ef432d", romantic: "#b88ac8",
  rocket_scientist: "#d965ab", scoocher: "#d965ab", sisyphus: "#e8e4dc", skipper: "#b88ac8",
  stickler: "#68aeda", suckerfish: "#68aeda", third_wheel: "#319a55", twin: "#68aeda",
};

function RacerCard({ athlete, selected, disabled, used, compact, status, onClick }: {
  athlete: AthleteCard; selected?: boolean; disabled?: boolean; used?: boolean; compact?: boolean;
  status?: ReactNode; onClick?: () => void;
}) {
  const className = `racer-card ${selected ? "selected" : ""} ${used ? "used" : ""} ${compact ? "compact" : ""}`;
  const style = { "--card-accent": cardAccents[athlete.id] ?? "#f2bd27" } as CSSProperties;
  const face = <>
    <span className="racer-portrait">
      <img src={assetUrl(`assets/racers/${athlete.id}.webp`)} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
      <strong className="racer-name">{athlete.nameZh}</strong>
    </span>
    <span className="ability-panel">{athlete.abilitySummary}</span>
    <strong className="ability-title">{athlete.abilityTitleZh}</strong>
    {used && <span className="used-stamp">已退场</span>}
    {status && <span className="racer-status">{status}</span>}
  </>;
  return <AthleteRules athlete={athlete}>{onClick
    ? <button className={className} style={style} disabled={disabled || used} onClick={onClick}>{face}</button>
    : <article className={className} style={style}>{face}</article>}
  </AthleteRules>;
}

function racerStatus(racer: ActiveRacer): string | null {
  if (racer.eliminated) return "已淘汰";
  if (racer.finished) return racer.finishPosition ? `第 ${racer.finishPosition} 名` : "已完赛";
  if (racer.tripped) return "已绊倒";
  return null;
}

export default function App() {
  const initialRoomId = roomFromPath();
  const [roomId, setRoomId] = useState(initialRoomId);
  const [playerName, setPlayerName] = useState(loadSession(initialRoomId)?.playerName ?? "");
  const [playerId, setPlayerId] = useState("");
  const [viewState, setViewState] = useState<ViewState>({ authoritative: null, display: null, playbackBusy: false });
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [error, setError] = useState("");
  const [feed, setFeed] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rollAnimation, setRollAnimation] = useState<RollAnimation | null>(null);
  const [localRollPending, setLocalRollPending] = useState(false);
  const [rollingPlayerId, setRollingPlayerId] = useState<string | null>(null);
  const [rollingActionId, setRollingActionId] = useState<string | null>(null);
  const [diceResetKey, setDiceResetKey] = useState(0);
  const musicToggle = useBackgroundMusic();
  const [restingDiceValue, setRestingDiceValue] = useState(1);
  const [cameraFocus, setCameraFocus] = useState<{ athleteId: string; playerId?: string; close: boolean } | null>(null);
  const [raceDetailsOpen, setRaceDetailsOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [moment, setMoment] = useState<Moment | null>(null);
  const [rollOffResult, setRollOffResult] = useState<{ outcome: string; winnerId?: string } | null>(null);
  const [decisionSeconds, setDecisionSeconds] = useState(0);
  const [resolvingDecisionId, setResolvingDecisionId] = useState<string | null>(null);
  const client = useRef(new GameClient());
  const visibleSnapshot = useRef<RoomSnapshot | null>(null);
  const authoritativeSnapshot = useRef<RoomSnapshot | null>(null);
  const latestAuthoritativeDiceValue = useRef<number | null>(null);
  const localRollPendingRef = useRef(false);
  const rollAnimationRef = useRef<RollAnimation | null>(null);
  const rollingPlayerRef = useRef<string | null>(null);
  const rollingActionRef = useRef<string | null>(null);
  const shownRolls = useRef(new Set<string>());
  const playbackQueue = useRef<RacePlayback[]>([]);
  const activePlayback = useRef<RacePlayback | null>(null);
  const eventPlaybackActive = useRef(false);
  const finishingRollKey = useRef<string | null>(null);
  const revealTimer = useRef<number | null>(null);
  const playbackId = useRef(0);

  useEffect(() => {
    window.addEventListener("pointerdown", unlockGameAudio);
    window.addEventListener("keydown", unlockGameAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockGameAudio);
      window.removeEventListener("keydown", unlockGameAudio);
    };
  }, []);

  useEffect(() => () => {
    client.current.close();
    playbackId.current += 1;
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
  }, []);

  const snapshot = viewState.display;
  const controlSnapshot = viewState.authoritative;
  const playbackBusy = viewState.playbackBusy;
  const game = snapshot?.game;
  const controlGame = controlSnapshot?.game ?? game;
  const me = game?.players.find((player) => player.id === playerId);
  const controlMe = controlGame?.players.find((player) => player.id === playerId);
  const isHost = controlGame?.players[0]?.id === playerId;
  const canStart = controlGame?.phase === "LOBBY" && isHost && controlGame.players.length >= 2;
  const canRollOff = !!controlGame && ["DRAFT_ROLL", "RACE_ROLL"].includes(controlGame.phase)
    && game?.phase === controlGame.phase && !playbackBusy && !rollOffResult
    && status === "connected" && controlGame.rollCandidateIds.includes(playerId) && !controlMe?.rollValues;
  const statusText = useMemo(
    () => ({ connecting: "连接中", connected: "在线", disconnected: "已断开" })[status], [status],
  );
  useEffect(() => setSelectedIds([]), [snapshot?.game.raceNumber, snapshot?.game.phase]);

  useEffect(() => {
    const deadline = controlGame?.pendingDecision?.deadlineAt;
    if (!deadline) return setDecisionSeconds(0);
    const update = () => setDecisionSeconds(Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [controlGame?.pendingDecision?.deadlineAt]);

  useEffect(() => {
    if (resolvingDecisionId && controlGame?.pendingDecision?.id !== resolvingDecisionId) {
      setResolvingDecisionId(null);
    }
  }, [controlGame?.pendingDecision?.id, resolvingDecisionId]);

  async function createRoom() {
    setError("");
    try {
      const response = await fetch(apiUrl("/api/rooms"), { method: "POST" });
      if (!response.ok) return setError("创建房间失败");
      const data = (await response.json()) as { roomId: string };
      window.location.hash = `/room/${data.roomId}`;
      setRoomId(data.roomId);
    } catch {
      setError("无法连接服务器，请稍后重试");
    }
  }

  function returnToEntry() {
    client.current.close();
    setStatus("disconnected");
    visibleSnapshot.current = null;
    authoritativeSnapshot.current = null;
    setViewState({ authoritative: null, display: null, playbackBusy: false });
    setPlayerId("");
    setRoomId("");
    setFeed([]);
    setError("");
    window.location.hash = "";
  }

  function exitRoom() {
    if (status === "connected") send({ type: "LEAVE_ROOM" });
    else if (!snapshot) returnToEntry();
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

  function rememberAuthoritativeSnapshot(next: RoomSnapshot) {
    authoritativeSnapshot.current = next;
    const latestDiceValue = latestAuthoritativeRollValue(next);
    if (latestDiceValue !== null) latestAuthoritativeDiceValue.current = latestDiceValue;
    setViewState((current) => ({
      ...current,
      authoritative: next,
      display: current.display ?? next,
    }));
  }

  function publishSnapshot(next: RoomSnapshot) {
    visibleSnapshot.current = next;
    setViewState((current) => ({ ...current, display: next }));
  }

  function setPlaybackBusyState(next: boolean) {
    setViewState((current) => ({ ...current, playbackBusy: next }));
  }

  function hasRaceAnimationEvents(events: GameEvent[]) {
    return events.some((event) => ["RACER_MOVED", "RACER_WARPED", "RACER_TRIPPED", "RACER_FINISHED", "ABILITY_TRIGGERED"].includes(event.type));
  }

  function isRacePlaybackSnapshot(message: RoomSnapshot) {
    return visibleSnapshot.current?.game.phase === "RACING"
      || ["RACING", "RACE_RESULTS", "FINISHED"].includes(message.game.phase);
  }

  function enqueueRacePlayback(item: RacePlayback) {
    playbackQueue.current.push(item);
    setPlaybackBusyState(true);
    void drainPlaybackQueue();
  }

  async function drainPlaybackQueue() {
    if (activePlayback.current || eventPlaybackActive.current) return;
    const item = playbackQueue.current.shift();
    if (!item) {
      const latest = authoritativeSnapshot.current;
      const latestDiceValue = latestAuthoritativeDiceValue.current;
      if (latestDiceValue !== null) setRestingDiceValue(latestDiceValue);
      if (latest && (visibleSnapshot.current?.revision ?? -1) < latest.revision) {
        publishSnapshot(latest);
      }
      setPlaybackBusyState(false);
      return;
    }

    setPlaybackBusyState(true);
    if (item.values.length > 0) {
      activePlayback.current = item;
      setRestingDiceValue(item.values[0]);
      const animation = {
        revision: item.revision,
        values: item.values,
        index: 0,
        autoThrow: item.autoThrow,
        throwKey: item.throwKey,
      };
      rollAnimationRef.current = animation;
      setRollAnimation(animation);
      return;
    }

    eventPlaybackActive.current = true;
    const playbackRunId = ++playbackId.current;
    try {
      await playRaceEvents(item.events, item.finalSnapshot, playbackRunId);
    } finally {
      if (playbackRunId !== playbackId.current) return;
      eventPlaybackActive.current = false;
      void drainPlaybackQueue();
    }
  }

  function resetPlaybackForWelcome(message: Extract<ServerMessage, { type: "WELCOME" }>) {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    revealTimer.current = null;
    finishingRollKey.current = null;
    playbackId.current += 1;
    setCameraFocus(null);
    setRaceDetailsOpen(false);
    playbackQueue.current = [];
    activePlayback.current = null;
    eventPlaybackActive.current = false;
    rollAnimationRef.current = null;
    rollingPlayerRef.current = null;
    rollingActionRef.current = null;
    localRollPendingRef.current = false;
    latestAuthoritativeDiceValue.current = null;

    const restoredRolls = new Set<string>();
    const raceKey = message.game.raceNumber - 1;
    for (const event of message.game.raceLog) {
      if (event.rollResultId) restoredRolls.add(event.rollResultId);
      if (event.type === "DICE_ROLLED" && typeof event.rollSerial === "number") {
        restoredRolls.add(`race:${raceKey}:serial:${event.rollSerial}`);
      }
    }
    const preview = message.game.pendingDecision?.rollPreview;
    if (preview) restoredRolls.add(`race:${raceKey}:serial:${preview.rollSerial}`);
    shownRolls.current = restoredRolls;

    setRollAnimation(null);
    setRollingPlayerId(null);
    setRollingActionId(null);
    setLocalRollPending(false);
    setPlaybackBusyState(false);
    setMoment(null);
    setRollOffResult(null);
    setResolvingDecisionId(null);
    setDiceResetKey((value) => value + 1);
  }

  function handleMessage(message: ServerMessage) {
    if (message.type === "KICKED") {
      clearSession();
      returnToEntry();
      setError("你已被房主移出房间");
      return;
    }
    if (message.type === "ROOM_LEFT") {
      clearSession();
      return returnToEntry();
    }
    if (message.type === "ERROR") {
      setResolvingDecisionId(null);
      if (localRollPendingRef.current) {
        localRollPendingRef.current = false;
        setLocalRollPending(false);
        setDiceResetKey((value) => value + 1);
      }
      return setError(message.message);
    }
    if (message.type === "ACTION_ACK") return;
    if (message.type === "WELCOME") {
      resetPlaybackForWelcome(message);
      rememberAuthoritativeSnapshot(message);
      setRestingDiceValue(latestAuthoritativeDiceValue.current ?? 1);
      publishSnapshot(message);
      setPlayerId(message.playerId);
      window.location.hash = `/room/${message.roomId}`;
      setRoomId(message.roomId);
      saveSession({ roomId: message.roomId, playerId: message.playerId,
        reconnectToken: message.reconnectToken, playerName: playerName.trim() });
      setError("");
      return;
    }
    rememberAuthoritativeSnapshot(message);
    if (message.type === "ROLL_STARTED") {
      rollingPlayerRef.current = message.playerId;
      rollingActionRef.current = message.actionId;
      setRollingPlayerId(message.playerId);
      setRollingActionId(message.actionId);
      setError("");
      return;
    }
    if (message.type === "STATE_UPDATED") {
      const lines = message.events.map((event) => eventText(event, message.game.players, message.events)).filter(Boolean);
      setFeed((current) => [...lines, ...current].slice(0, 300));
      const nextShownRolls = new Set(shownRolls.current);
      let diceValues = collectUnseenRollValues(message, nextShownRolls);
      if (diceValues.length === 0 && localRollPendingRef.current) {
        diceValues = message.events.flatMap((event) => event.type === "DICE_ROLLED" && typeof event.value === "number" ? [event.value] : []);
      }
      if (diceValues.length === 0 && (localRollPendingRef.current || rollingPlayerRef.current !== null)) {
        localRollPendingRef.current = false;
        rollingPlayerRef.current = null;
        rollingActionRef.current = null;
        setLocalRollPending(false);
        setRollingPlayerId(null);
        setRollingActionId(null);
        setDiceResetKey((value) => value + 1);
      }
      if (message.events.some((event) => event.type === "START_DICE_ROLLED")) {
        enqueueRacePlayback({ revision: message.revision, values: [], events: message.events,
          finalSnapshot: message, autoThrow: false, throwKey: `rolloff-${message.revision}` });
      } else if (isRacePlaybackSnapshot(message) && diceValues.length > 0) {
        shownRolls.current = nextShownRolls;
        const throwKey = rollingActionRef.current ? `start-${rollingActionRef.current}` : `result-${message.revision}-0`;
        const playback = {
          revision: message.revision,
          values: diceValues,
          events: message.events,
          finalSnapshot: message,
          // A repeated launch with the same key is ignored by the table dice. Keeping this true
          // gives remote clients a result-time retry if the start signal arrived before
          // their WebGL scene was ready.
          autoThrow: !localRollPendingRef.current,
          throwKey,
        };
        rollingPlayerRef.current = null;
        rollingActionRef.current = null;
        setRollingPlayerId(null);
        setRollingActionId(null);
        enqueueRacePlayback(playback);
      } else if (isRacePlaybackSnapshot(message) && hasRaceAnimationEvents(message.events)) {
        enqueueRacePlayback({
          revision: message.revision,
          values: [],
          events: message.events,
          finalSnapshot: message,
          autoThrow: false,
          throwKey: `events-${message.revision}`,
        });
      } else if (playbackBusy || activePlayback.current || eventPlaybackActive.current || playbackQueue.current.length > 0) {
        // Keep display state stable while queued race playback is catching up.
      } else {
        const latestDiceValue = latestAuthoritativeDiceValue.current;
        if (latestDiceValue !== null) setRestingDiceValue(latestDiceValue);
        publishSnapshot(message);
      }
    }
    setError("");
  }

  function send(intent: GameActionInput, suppliedActionId = actionId()): boolean {
    try {
      client.current.send({ ...intent, actionId: suppliedActionId } as GameAction);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发送行动失败");
      return false;
    }
  }

  function resolveDecision(decisionId: string, optionId: string) {
    setResolvingDecisionId(decisionId);
    if (!send({ type: "RESOLVE_DECISION", decisionId, optionId })) {
      setResolvingDecisionId(null);
    }
  }

  function toggleRacer(id: string) {
    if (!game) return;
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < game.selectionCount ? [...current, id] : current);
  }

  function throwRaceDice(throwId: string) {
    if (localRollPendingRef.current || rollAnimation) return;
    localRollPendingRef.current = true;
    setLocalRollPending(true);
    if (!send({ type: "ROLL_DICE" }, throwId)) {
      localRollPendingRef.current = false;
      setLocalRollPending(false);
      setDiceResetKey((value) => value + 1);
    }
  }

  function finishDiceAnimation(expectedKey: string) {
    const current = rollAnimationRef.current;
    if (!current || `${current.revision}-${current.index}` !== expectedKey) return;
    if (current.index + 1 < current.values.length) {
      const nextIndex = current.index + 1;
      const next = { ...current, index: nextIndex, autoThrow: true, throwKey: `result-${current.revision}-${nextIndex}` };
      setRestingDiceValue(next.values[nextIndex]);
      rollAnimationRef.current = next;
      setRollAnimation(next);
      return;
    }

    if (finishingRollKey.current === expectedKey) return;
    finishingRollKey.current = expectedKey;
    const playback = activePlayback.current;
    const revealDelay = playback?.finalSnapshot.game.pendingDecision?.rollPreview ? 600 : 0;
    revealTimer.current = window.setTimeout(() => completeDiceAnimation(), revealDelay);
  }

  function completeDiceAnimation() {
    const playback = activePlayback.current;
    revealTimer.current = null;
    finishingRollKey.current = null;
    activePlayback.current = null;
    rollAnimationRef.current = null;
    rollingPlayerRef.current = null;
    rollingActionRef.current = null;
    localRollPendingRef.current = false;
    setRollAnimation(null);
    setRollingPlayerId(null);
    setRollingActionId(null);
    setLocalRollPending(false);
    setDiceResetKey((value) => value + 1);
    if (!playback) {
      void drainPlaybackQueue();
      return;
    }
    eventPlaybackActive.current = true;
    const playbackRunId = ++playbackId.current;
    void playRaceEvents(playback.events, playback.finalSnapshot, playbackRunId).finally(() => {
      if (playbackRunId !== playbackId.current) return;
      eventPlaybackActive.current = false;
      void drainPlaybackQueue();
    });
  }

  async function playRaceEvents(events: GameEvent[], finalSnapshot: RoomSnapshot, playbackRunId: number) {
    let working = structuredClone(visibleSnapshot.current ?? finalSnapshot);
    const cancelled = () => playbackRunId !== playbackId.current;
    const publish = () => {
      if (cancelled()) return false;
      const next = structuredClone(working);
      publishSnapshot(next);
      return true;
    };
    const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const celebrate = (event: GameEvent) => {
      const racer = working.game.players.find((p) => p.id === event.playerId)?.activeRacers.find((r) => r.id === event.athleteId);
      if (!racer || racer.finished) return;
      racer.finished = true;
      racer.finishPosition = event.finishPosition ?? null;
      racer.position = working.game.finishLine;
      publish();
      if (event.finishPosition === 1 || event.finishPosition === 2) playFireworkSound(event.finishPosition);
      else playCharacterScoreSound();
    };
    if (events.some((event) => event.type === "START_DICE_ROLLED")) {
      const result = rollOffPresentation(working, finalSnapshot, events);
      publishSnapshot(result.display);
      setRollOffResult(result);
      await pause(result.outcome ? 3600 : 900);
      if (cancelled()) return;
      setRollOffResult(null);
      publishSnapshot(finalSnapshot);
      return;
    }
    for (const event of events) {
      if (cancelled()) return;
      if (event.type === "RACER_FINISHED") {
        celebrate(event);
        if (event.finishPosition === 1 || event.finishPosition === 2) await pause(3400);
        continue;
      }
      // Some engine notifications follow their effect. Do not replay them as a second action.
      if (isRedundantAbilityEvent(event, events)) continue;
      const currentMoment = actionMoment(event, working.game.players, events);
      setMoment(currentMoment);
      const focusId = event.type === "ABILITY_TRIGGERED" ? event.sourceAthleteId ?? event.athleteId : event.athleteId;
      if (focusId && ["ABILITY_TRIGGERED", "RACER_MOVED", "RACER_WARPED", "RACER_TRIPPED", "RACER_FINISHED"].includes(event.type)) {
        setCameraFocus({ athleteId: focusId, playerId: event.type === "ABILITY_TRIGGERED" ? event.sourcePlayerId ?? event.playerId : event.playerId, close: true });
        if (use3DRaceTable) await pause(650);
        if (cancelled()) return;
      }
      if (currentMoment) {
        await pause(event.type === "ABILITY_TRIGGERED" ? 2000 : 1000);
        if (cancelled()) return;
      }
      if (["RACER_MOVED", "RACER_WARPED"].includes(event.type) && event.athleteId && typeof event.to === "number") {
        const racer = working.game.players.find((player) => player.id === event.playerId)?.activeRacers.find((item) => item.id === event.athleteId);
        if (racer) {
          if (event.type === "RACER_WARPED") {
            await pause(180);
            if (cancelled()) return;
            racer.position = event.to;
            if (racer.position >= working.game.finishLine) {
              const finish = events.find((e) => e.type === "RACER_FINISHED" && e.playerId === event.playerId && e.athleteId === event.athleteId);
              if (finish) celebrate(finish);
            }
            if (!publish()) return;
            playMoveSound();
            await pause(320);
            if (cancelled()) return;
          } else {
            const start = typeof event.from === "number" ? event.from : racer.position;
            const direction = event.to >= start ? 1 : -1;
            for (let position = start + direction; direction > 0 ? position <= event.to : position >= event.to; position += direction) {
              if (cancelled()) return;
              racer.position = position;
              if (position >= working.game.finishLine) {
                const finish = events.find((e) => e.type === "RACER_FINISHED" && e.playerId === event.playerId && e.athleteId === event.athleteId);
                if (finish) celebrate(finish);
              }
              if (!publish()) return;
              playMoveSound();
              await pause(use3DRaceTable ? 340 : 220);
            }
          }
        }
      }
      if (event.type === "RACER_TRIPPED" && event.athleteId) {
        const racer = working.game.players.find((player) => player.id === event.playerId)?.activeRacers.find((item) => item.id === event.athleteId);
        if (racer) racer.tripped = true;
        if (!publish()) return;
        await pause(900);
      }
      if (currentMoment) await pause(700);
    }
    if (cancelled()) return;
    if (use3DRaceTable) await pause(650);
    if (cancelled()) return;
    setCameraFocus(null);
    setMoment(null);
    publishSnapshot(finalSnapshot);
  }

  useEffect(() => {
    if (!rollAnimation) return;
    const key = `${rollAnimation.revision}-${rollAnimation.index}`;
    const timer = window.setTimeout(() => finishDiceAnimation(key), 1800);
    return () => window.clearTimeout(timer);
  }, [rollAnimation]);

  if (!snapshot) {
    return (
      <main className="entry">
        <div className="entry-shade" />
        {musicToggle}
        <section className="entry-brand"><p className="kicker">THE MAGICAL RACE IS ON</p><h1>MAGICAL<br />ATHLETE</h1></section>
        <section className="join-dock" aria-label="加入游戏">
          <label><span>玩家名称</span><input value={playerName} maxLength={24} onChange={(event) => setPlayerName(event.target.value)} placeholder="你的名字" /></label>
          <label><span>房间号</span><input value={roomId} maxLength={8} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder="ABCD" /></label>
          <button className="command primary" onClick={status === "disconnected" ? joinRoom : exitRoom}>{status === "disconnected" ? "加入房间" : "取消加入"}</button>
          <button className="command secondary" disabled={status !== "disconnected"} onClick={createRoom}>创建房间</button>
          <span className={`connection ${status}`}>{statusText}</span>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const immersiveRace = game!.phase === "RACING" && use3DRaceTable;
  const feedLines = (game!.raceLog.length
    ? game!.raceLog.slice().reverse().map((event) => eventText(event, game!.players, game!.raceLog)).filter(Boolean)
    : feed).slice(0, 300);
  const feedCount = game!.raceLog.length || feed.length;

  return (
    <main className={`table ${game?.phase === "CHARACTER_SELECTION" ? "selection-view" : ""} ${immersiveRace ? "immersive-race" : ""} ${raceDetailsOpen ? "race-details-open" : ""} ${immersiveRace && feedOpen ? "feed-sidebar-open" : ""}`}>
      <header className="topbar">
        <div className="wordmark">MAGICAL ATHLETE</div>
        <div className="race-progress">
          {tracks.map((track, index) => <div key={`${track}-${index}`} className={`${index + 1 === game!.raceNumber ? "current" : ""} ${index + 1 < game!.raceNumber ? "done" : ""}`}>
            <span>{index + 1}</span><small>{track}</small>
          </div>)}
        </div>
        <div className="room-code">{musicToggle}
          {immersiveRace && <button className="feed-toggle" aria-expanded={feedOpen} aria-controls="race-feed" onClick={() => setFeedOpen(!feedOpen)}>赛场动态<span className="event-feed-count">{feedCount}</span></button>}
          <small>房间</small><strong>{snapshot.roomId}</strong><span className={`status-dot ${status}`} /></div>
      </header>

      {game!.phase === "LOBBY" && (
        <section className="lobby-stage stage">
          <div className="stage-title"><p className="kicker">2–6 PLAYERS</p><h2>等待选手入场</h2><p>房间号 <strong>{snapshot.roomId}</strong></p></div>
          <div className="lobby-players">
            {game!.players.map((player, index) => <div className={`seat ${playerColors[index]}`} key={player.id}>
              <span>{index + 1}</span><strong>{player.name}</strong>
              <small>{player.id === playerId ? "你" : player.connected ? "已连接" : "离线"}</small>
              {isHost && player.id !== playerId && <button className="seat-kick" disabled={status !== "connected"} onClick={() => send({ type: "KICK_PLAYER", targetPlayerId: player.id })}>移出房间</button>}
            </div>)}
            {Array.from({ length: Math.max(0, 4 - game!.players.length) }).map((_, index) => <div className="seat empty" key={index}><span>+</span><strong>空位</strong><small>分享房间号</small></div>)}
          </div>
          {game!.players.length === 3 && <div className="variant-control" role="group" aria-label="三人游戏模式">
            <button className={!game!.doubleRacerVariant ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_VARIANT", doubleRacer: false })}>标准 · 每场 1 名</button>
            <button className={game!.doubleRacerVariant ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_VARIANT", doubleRacer: true })}>双赛车手 · 每场 2 名</button>
          </div>}
          <button className="command secondary" disabled={status !== "connected"} onClick={exitRoom}>退出房间</button>
          <button className="command primary big" disabled={!canStart} onClick={() => send({ type: "START_GAME" })}>{isHost ? "开始游戏" : "等待房主"}</button>
        </section>
      )}

      {(game!.phase === "DRAFT_ROLL" || game!.phase === "RACE_ROLL") && (
        <section className="rolloff-stage stage">
          <div className="stage-title"><p className="kicker">{game!.phase === "DRAFT_ROLL" ? "DRAFT ORDER" : `RACE ${game!.raceNumber}`}</p>
            <h2>{game!.phase === "DRAFT_ROLL" ? "决定首位招募玩家" : "掷骰决定本场先手"}</h2></div>
          <div className="dice-table">
            {game!.players.map((player, index) => <div className={`roll-seat ${rollOffResult?.winnerId === player.id ? "roll-winner" : ""} ${playerColors[index]} ${game!.rollCandidateIds.includes(player.id) ? "candidate" : ""}`} key={player.id}>
              <span className="avatar">{player.name.slice(0, 1)}</span><strong>{player.name}</strong>
              <div className="dice-pair">{player.rollValues ? player.rollValues.map((die, dieIndex) => <span key={dieIndex}>{die}</span>) : <span className="waiting">?</span>}</div>
            </div>)}
          </div>
          <p className="rolloff-rule">两颗骰子先比较较大点数，再比较较小点数；完全相同则重掷。</p>
          {rollOffResult?.outcome && <div className="rolloff-result" role="status"><strong>{rollOffResult.outcome}</strong><small>结果展示后继续</small></div>}
          <button className="command dice-command" disabled={!canRollOff} onClick={() => send({ type: "ROLL_START" })}><span aria-hidden="true">⚄</span>{playbackBusy ? "正在展示掷骰结果…" : me?.rollValues ? "等待其他玩家" : "掷两颗骰子"}</button>
        </section>
      )}

      {game!.phase === "DRAFTING" && (
        <section className="draft-stage stage">
          <div className="stage-title row"><div><p className="kicker">DRAFT {game!.draftRound} / {game!.draftRoundCount}</p><h2>{game!.activePlayerId === playerId ? "轮到你招募" : `等待 ${game!.players.find((p) => p.id === game!.activePlayerId)?.name} 选择`}</h2></div><p>公开招募区 · 蛇形顺序</p></div>
          <div className="draft-layout">
            <div className="draft-pool">{game!.draftPool.map((athlete) => <SelectionCard key={athlete.id} athlete={athlete} accent={cardAccents[athlete.id] ?? "#f2bd27"} recruit disabled={game!.activePlayerId !== playerId || status !== "connected"} reason="等待轮到你招募" onChoose={() => send({ type: "DRAFT_ATHLETE", athleteId: athlete.id })} />)}</div>
            <aside className="team-board"><h3>队伍</h3>{game!.players.map((player, index) => <div className="team-row" key={player.id}><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong><div>{player.team.map((athlete) => <span title={athlete.nameZh} key={athlete.id}>{athlete.nameZh.slice(0, 1)}</span>)}</div><small>{player.team.length} / {game!.doubleRacerVariant ? 8 : 4}</small></div>)}</aside>
          </div>
        </section>
      )}

      {game!.phase === "CHARACTER_SELECTION" && (
        <section className="selection-stage stage">
          <div className="selection-heading"><p className="kicker">RACE {game!.raceNumber} · {tracks[game!.raceNumber - 1]}</p><h2>选好角色，准备上场</h2><p>选择 {game!.selectionCount} 名赛车手，其他玩家不会看到你的阵容。</p></div>
          <div className="selection-meta"><strong>你的队伍 · {me?.team.length ?? 0} 名</strong><span>本场奖励 ① {game!.raceRewards[0]} 分 · ② {game!.raceRewards[1]} 分</span></div>
          <div className="my-team">{me?.team.map((athlete) => <SelectionCard key={athlete.id} athlete={athlete} accent={cardAccents[athlete.id] ?? "#f2bd27"} used={me.usedAthleteIds.includes(athlete.id)} selected={selectedIds.includes(athlete.id)} disabled={me.selectionLocked || (!selectedIds.includes(athlete.id) && selectedIds.length >= game!.selectionCount)} reason={me.selectionLocked ? "阵容已锁定" : `已选满 ${game!.selectionCount} 名，请先取消一名角色`} onChoose={() => toggleRacer(athlete.id)} />)}</div>
          <div className="selection-dock"><div className="selection-dock-inner"><div className="selection-chosen" aria-live="polite"><strong>{me?.team.filter((athlete) => selectedIds.includes(athlete.id)).map((athlete) => athlete.nameZh).join(" · ") || "还未选择角色"}</strong><span>{selectedIds.length} / {game!.selectionCount}</span></div><button className="selection-confirm" disabled={selectedIds.length !== game!.selectionCount || me?.selectionLocked || status !== "connected"} onClick={() => send({ type: "SELECT_RACERS", athleteIds: selectedIds })}>{me?.selectionLocked ? "阵容已锁定" : status !== "connected" ? "等待重新连接" : "确认上场"}</button><p className="selection-ready">{game!.players.filter((player) => player.selectionLocked).length} / {game!.players.length} 位玩家已准备</p></div></div>
        </section>
      )}

      {game!.phase === "RACING" && (
        <section className="race-stage stage">
          <div className="race-heading"><div><p className="kicker">RACE {game!.raceNumber} / 4</p><h2>{tracks[game!.raceNumber - 1]}</h2></div><div className="reward"><span>🏆 {game!.raceRewards[0]}</span><span>◉ {game!.raceRewards[1]}</span></div></div>
          {use3DRaceTable ? <Suspense fallback={<div className="race-table-loading" aria-label="正在加载 3D 比赛桌" />}>
            <RaceTableScene turnKey={raceDiceTurnKey(game!, playbackBusy)} moment={moment} focus={cameraFocus ?? (game!.pendingDecision ? { athleteId: game!.pendingDecision.athleteId, playerId: game!.pendingDecision.playerId, close: true } : game!.pendingRoll ? { athleteId: game!.pendingRoll.nextAthleteId, playerId: game!.pendingRoll.nextPlayerId, close: true } : null)} activePlayerId={game!.activePlayerId} players={game!.players} finishLine={game!.finishLine} trackName={game!.trackName} dice={{
              playbackBusy,
              enabled: canRollRaceDice(
                controlGame,
                playerId,
                localRollPending || playbackBusy || !!rollAnimation || status !== "connected",
              ),
              targetValue: rollAnimation?.values[rollAnimation.index] ?? null,
              restingValue: restingDiceValue,
              rollKey: rollAnimation?.throwKey ?? (rollingActionId ? `start-${rollingActionId}` : `idle-${game!.raceNumber}`),
              autoThrow: rollAnimation?.autoThrow ?? (rollingPlayerId !== null && !localRollPending),
              resetKey: diceResetKey,
              activePlayerName: game!.players.find((player) => player.id === (game!.pendingRoll?.nextPlayerId ?? game!.activePlayerId))?.name ?? "其他玩家",
              onThrow: throwRaceDice,
              onSettled: () => finishDiceAnimation(`${rollAnimation?.revision}-${rollAnimation?.index}`),
            }} />
          </Suspense> : <div className="track-wrap"><RaceTrack moment={moment} players={game!.players} finishLine={game!.finishLine} trackName={game!.trackName} /></div>}
          <div className="race-console">
            <div className="score-strip">{game!.players.map((player, index) => <div className={game!.activePlayerId === player.id ? "active" : ""} key={player.id}><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong><small>{scoreLabel(player, game!.phase)}</small></div>)}</div>
            {!use3DRaceTable && <button className="command dice-command" disabled={!canRollRaceDice(
              controlGame,
              playerId,
              localRollPending || playbackBusy || !!rollAnimation || status !== "connected",
            )} onClick={() => throwRaceDice(actionId())}>掷骰</button>}
          </div>
          {use3DRaceTable && <button className="race-details-toggle" aria-expanded={raceDetailsOpen} aria-controls="race-roster" onClick={() => setRaceDetailsOpen(!raceDetailsOpen)}>{raceDetailsOpen ? "收起角色" : "角色与技能"}</button>}
          <section id="race-roster" className="race-roster" aria-label="本场角色卡牌">
            <div className="race-roster-heading"><p className="kicker">RACERS IN PLAY</p><h3>本场角色</h3></div>
            <div className="race-roster-scroll">
              {game!.players.map((player, index) => <article className={`racer-owner ${game!.activePlayerId === player.id ? "active" : ""}`} key={player.id}>
                <header><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong>{player.id === playerId && <small>你</small>}</header>
                <div>{player.activeRacers.map((racer) => <RacerCard key={racer.id} athlete={racer} compact status={racerStatus(racer)} />)}</div>
              </article>)}
            </div>
          </section>
        </section>
      )}

      {moment && <ActionMoment moment={moment} />}
      {controlGame?.pendingDecision && !playbackBusy && !rollAnimation && resolvingDecisionId !== controlGame.pendingDecision.id && <div className="decision-backdrop">
        <section className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title">
          <header><div><small>{controlGame.pendingDecision.athleteName}</small><h2 id="decision-title">{decisionTitle(controlGame.pendingDecision)}</h2></div><strong>{decisionSeconds}s</strong></header>
          {controlGame.pendingDecision.rollPreview && <p className="decision-roll">本次掷出 <strong>{controlGame.pendingDecision.rollPreview.value}</strong>{controlGame.pendingDecision.rollPreview.finalValue !== controlGame.pendingDecision.rollPreview.value && <small>最终移动 {controlGame.pendingDecision.rollPreview.finalValue}</small>}</p>}
          <p>{decisionPrompt(controlGame.pendingDecision)}</p>
          <div className="decision-options">{controlGame.pendingDecision.options.map((option) => <button className="command secondary" key={option.id}
            disabled={controlGame.pendingDecision?.playerId !== playerId || status !== "connected"}
            onClick={() => resolveDecision(controlGame.pendingDecision!.id, option.id)}>{decisionOptionLabel(option.label)}{option.description && <small className="decision-option-detail">{option.description}</small>}</button>)}</div>
          {controlGame.pendingDecision.playerId !== playerId && <small>等待 {controlGame.players.find((player) => player.id === controlGame.pendingDecision?.playerId)?.name} 选择</small>}
        </section>
      </div>}

      {(game!.phase === "RACE_RESULTS" || game!.phase === "FINISHED") && (
        <section className="results-stage stage">
          <div className="stage-title"><p className="kicker">{game!.phase === "FINISHED" ? "FINAL SCORE" : `RACE ${game!.raceNumber} COMPLETE`}</p><h2>{game!.phase === "FINISHED" ? (game!.winnerIds.length > 1 ? "并列冠军" : `${game!.players.find((p) => p.id === game!.winnerIds[0])?.name} 获胜`) : "本场成绩"}</h2></div>
          <div className="podium-celebration" aria-hidden="true"><i className="confetti confetti-one">✦</i><i className="confetti confetti-two">✧</i><i className="firework firework-one">✹</i><i className="firework firework-two">✺</i></div>
          <div className="podium-list">{game!.players.slice().sort((a, b) => b.score - a.score).map((player, index) => <div key={player.id} className={index === 0 ? "leader" : index === 1 ? "second" : ""}><span>{index + 1}</span><strong>{player.name}</strong><div className="result-racers">{game!.raceResults.filter((result) => result.playerId === player.id).map((result) => <small key={result.athlete.id}>{result.athlete.nameZh} +{result.points}</small>)}</div><b>{player.score} 分</b></div>)}</div>
          {game!.phase === "RACE_RESULTS" && <button className="command primary big" disabled={!isHost} onClick={() => send({ type: "ADVANCE_RACE" })}>{isHost ? "进入下一场" : "等待房主继续"}</button>}
        </section>
      )}

      {game!.phase !== "LOBBY" && (immersiveRace
        ? <aside id="race-feed" className={`race-feed ${feedOpen ? "open" : ""}`} aria-label="赛场动态" aria-hidden={!feedOpen}>
          <header>
            <strong>赛场动态</strong><span className="event-feed-count">{feedCount}</span>
            <button className="race-feed-close" aria-label="关闭赛场动态" onClick={() => setFeedOpen(false)}>×</button>
          </header>
          <div className="event-feed-list" aria-live="polite">
            {feedLines.length
              ? feedLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)
              : <span className="event-feed-empty">本场还没有记录</span>}
          </div>
        </aside>
        : <details className={`event-feed ${game!.phase === "RACING" ? "racing" : ""}`} open>
          <summary><strong>赛场动态</strong><span className="event-feed-count">{feedCount}</span></summary>
          <div className="event-feed-list">
            {feedLines.length
              ? feedLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)
              : <span className="event-feed-empty">本场还没有记录</span>}
          </div>
        </details>)}
      {error && <div className="toast" role="alert">{error}<button aria-label="关闭" onClick={() => setError("")}>×</button></div>}
    </main>
  );
}
