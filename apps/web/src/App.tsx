import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { SelectionCard } from "./components/SelectionCard";
import { athleteText } from "./i18n/athletes";
import { useBackgroundMusic } from "./useBackgroundMusic";
import { AthleteRules } from "./components/AthleteRules";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { decisionResolution, decisionTitle, decisionPrompt, decisionOptionLabel, type DecisionOutcome } from "./decisionPresentation";
import { ActionMoment } from "./components/ActionMoment";
import { actionMoment, eventText, isRedundantAbilityEvent, rollOffPresentation, type ActionMoment as Moment } from "./eventPresentation";
import { RaceTrack } from "./components/RaceTrack";
import { actionId, clearSession, GameClient, loadSession, roomFromPath, saveSession } from "./gameClient";
import type { ActiveRacer, AthleteCard, ClientIntent, GameEvent, PendingDecision, PlayerState, RoomSnapshot, ServerMessage } from "./protocol";
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
type DecisionReplay = {
  decision: PendingDecision;
  outcome: DecisionOutcome;
  playerName: string;
  chosenLabel: string;
};
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
  const { t } = useTranslation();
  const card = athleteText(t, athlete);
  const className = `racer-card ${selected ? "selected" : ""} ${used ? "used" : ""} ${compact ? "compact" : ""}`;
  const style = { "--card-accent": cardAccents[athlete.id] ?? "#f2bd27" } as CSSProperties;
  const face = <>
    <span className="racer-portrait">
      <img src={assetUrl(`assets/racers/${athlete.id}.webp`)} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
      <strong className="racer-name">{card.name}</strong>
    </span>
    <span className="ability-panel">{card.summary}</span>
    <strong className="ability-title">{card.abilityTitle}</strong>
    {used && <span className="used-stamp">{t("racer.retired")}</span>}
    {status && <span className="racer-status">{status}</span>}
  </>;
  return <AthleteRules athlete={athlete}>{onClick
    ? <button className={className} style={style} disabled={disabled || used} onClick={onClick}>{face}</button>
    : <article className={className} style={style}>{face}</article>}
  </AthleteRules>;
}

function racerStatus(racer: ActiveRacer, t: TFunction): string | null {
  if (racer.eliminated) return t("racer.eliminated");
  if (racer.finished) {
    return racer.finishPosition ? t("racer.finishPosition", { position: racer.finishPosition }) : t("racer.finished");
  }
  if (racer.tripped) return t("racer.tripped");
  return null;
}

/** Server errors carry a stable code, so the sentence stays in the UI language. */
function errorText(t: TFunction, code: string, message: string): string {
  return t(`serverErrors.${code}`, { defaultValue: message });
}

export default function App() {
  const { t } = useTranslation();
  const cardName = (athlete: AthleteCard) => athleteText(t, athlete).name;
  const athleteName = (id: string, fallback: string) => athleteText(t, { id, name: fallback }).name;
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
  const [decisionReplay, setDecisionReplay] = useState<DecisionReplay | null>(null);
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
  const decisionReplayTimer = useRef<number | null>(null);
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
    if (decisionReplayTimer.current !== null) window.clearTimeout(decisionReplayTimer.current);
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
  const statusText = useMemo(() => t(`status.${status}`), [t, status]);
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

  // A new choice always replaces the lingering result of the previous one.
  useEffect(() => {
    if (controlGame?.pendingDecision) setDecisionReplay(null);
  }, [controlGame?.pendingDecision?.id]);

  function rememberDecisionResult(decision: PendingDecision | null | undefined, events: GameEvent[], players: PlayerState[]) {
    const outcome = decisionResolution(decision, events);
    if (!decision || !outcome) return;
    const chosen = decision.options.find((option) => option.id === outcome.optionId);
    setDecisionReplay({
      decision,
      outcome,
      playerName: players.find((player) => player.id === outcome.playerId)?.name ?? t("common.player"),
      chosenLabel: chosen ? decisionOptionLabel(chosen.label, t) : t("common.automatic"),
    });
    if (decisionReplayTimer.current !== null) window.clearTimeout(decisionReplayTimer.current);
    decisionReplayTimer.current = window.setTimeout(() => {
      decisionReplayTimer.current = null;
      setDecisionReplay(null);
    }, 3600);
  }

  async function createRoom() {
    setError("");
    try {
      const response = await fetch(apiUrl("/api/rooms"), { method: "POST" });
      if (!response.ok) return setError(t("errors.createRoom"));
      const data = (await response.json()) as { roomId: string };
      window.location.hash = `/room/${data.roomId}`;
      setRoomId(data.roomId);
    } catch {
      setError(t("errors.network"));
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
    if (!normalizedRoomId || !normalizedName) return setError(t("errors.missingFields"));
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
      setError(t("errors.kicked"));
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
      return setError(errorText(t, message.code, message.message));
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
    const previousDecision = authoritativeSnapshot.current?.game.pendingDecision ?? null;
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
      const lines = message.events.map((event) => eventText(event, message.game.players, message.events, t)).filter(Boolean);
      setFeed((current) => [...lines, ...current].slice(0, 300));
      rememberDecisionResult(previousDecision, message.events, message.game.players);
      const nextShownRolls = new Set(shownRolls.current);
      let diceValues = collectUnseenRollValues(message, nextShownRolls);
      if (diceValues.length === 0 && localRollPendingRef.current) {
        diceValues = message.events.flatMap((event) => event.type === "DICE_ROLLED" && !event.noDice && typeof event.value === "number" ? [event.value] : []);
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
      setError(reason instanceof Error ? reason.message : t("errors.send"));
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
      const result = rollOffPresentation(working, finalSnapshot, events, t);
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
      const currentMoment = actionMoment(event, working.game.players, t);
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
        <LanguageSwitcher />
        <section className="entry-brand"><p className="kicker">{t("entry.kicker")}</p><h1>MAGICAL<br />ATHLETE</h1></section>
        <section className="join-dock" aria-label={t("entry.joinLabel")}>
          <label><span>{t("entry.playerName")}</span><input value={playerName} maxLength={24} onChange={(event) => setPlayerName(event.target.value)} placeholder={t("entry.playerNamePlaceholder")} /></label>
          <label><span>{t("entry.roomCode")}</span><input value={roomId} maxLength={8} onChange={(event) => setRoomId(event.target.value.toUpperCase())} placeholder={t("entry.roomCodePlaceholder")} /></label>
          <button className="command primary" onClick={status === "disconnected" ? joinRoom : exitRoom}>{status === "disconnected" ? t("entry.join") : t("entry.cancelJoin")}</button>
          <button className="command secondary" disabled={status !== "disconnected"} onClick={createRoom}>{t("entry.createRoom")}</button>
          <span className={`connection ${status}`}>{statusText}</span>
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const immersiveRace = game!.phase === "RACING" && use3DRaceTable;
  const feedLines = (game!.raceLog.length
    ? game!.raceLog.slice().reverse().map((event) => eventText(event, game!.players, game!.raceLog, t)).filter(Boolean)
    : feed).slice(0, 300);
  const feedCount = game!.raceLog.length || feed.length;
  const liveDecision = controlGame?.pendingDecision && !playbackBusy && !rollAnimation
    && resolvingDecisionId !== controlGame.pendingDecision.id ? controlGame.pendingDecision : null;

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
          {immersiveRace && <button className="feed-toggle" aria-expanded={feedOpen} aria-controls="race-feed" onClick={() => setFeedOpen(!feedOpen)}>{t("topbar.feed")}<span className="event-feed-count">{feedCount}</span></button>}
          <LanguageSwitcher compact />
          <small>{t("topbar.room")}</small><strong>{snapshot.roomId}</strong><span className={`status-dot ${status}`} /></div>
      </header>

      {game!.phase === "LOBBY" && (
        <section className="lobby-stage stage">
          <div className="stage-title"><p className="kicker">2–6 PLAYERS</p><h2>{t("lobby.title")}</h2><p>{t("lobby.roomCode")} <strong>{snapshot.roomId}</strong></p></div>
          <div className="lobby-players">
            {game!.players.map((player, index) => <div className={`seat ${playerColors[index]}`} key={player.id}>
              <span>{index + 1}</span><strong>{player.name}</strong>
              <small>{player.id === playerId ? t("common.you") : player.connected ? t("lobby.connected") : t("lobby.offline")}</small>
              {isHost && player.id !== playerId && <button className="seat-kick" disabled={status !== "connected"} onClick={() => send({ type: "KICK_PLAYER", targetPlayerId: player.id })}>{t("lobby.kick")}</button>}
            </div>)}
            {Array.from({ length: Math.max(0, 4 - game!.players.length) }).map((_, index) => <div className="seat empty" key={index}><span>+</span><strong>{t("lobby.emptySeat")}</strong><small>{t("lobby.shareRoomCode")}</small></div>)}
          </div>
          {game!.players.length === 3 && <div className="variant-control" role="group" aria-label={t("lobby.threePlayerMode")}>
            <button className={!game!.doubleRacerVariant ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_VARIANT", doubleRacer: false })}>{t("lobby.standard")}</button>
            <button className={game!.doubleRacerVariant ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_VARIANT", doubleRacer: true })}>{t("lobby.doubleRacer")}</button>
          </div>}
          <div className="variant-control" role="group" aria-label={t("lobby.dealMode")}>
            <button className={!game!.autoDeal ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_AUTO_DEAL", autoDeal: false })}>{t("lobby.dealManual")}</button>
            <button className={game!.autoDeal ? "active" : ""} disabled={!isHost} onClick={() => send({ type: "SET_AUTO_DEAL", autoDeal: true })}>{t("lobby.dealAuto", { cards: game!.cardsPerPlayer })}</button>
          </div>
          <button className="command secondary" disabled={status !== "connected"} onClick={exitRoom}>{t("lobby.leave")}</button>
          <button className="command primary big" disabled={!canStart} onClick={() => send({ type: "START_GAME" })}>{isHost ? t("lobby.start") : t("lobby.waitingHost")}</button>
        </section>
      )}

      {(game!.phase === "DRAFT_ROLL" || game!.phase === "RACE_ROLL") && (
        <section className="rolloff-stage stage">
          <div className="stage-title"><p className="kicker">{game!.phase === "DRAFT_ROLL" ? "DRAFT ORDER" : `RACE ${game!.raceNumber}`}</p>
            <h2>{game!.phase === "DRAFT_ROLL" ? t("rollOff.draftTitle") : t("rollOff.raceTitle")}</h2></div>
          <div className="dice-table">
            {game!.players.map((player, index) => <div className={`roll-seat ${rollOffResult?.winnerId === player.id ? "roll-winner" : ""} ${playerColors[index]} ${game!.rollCandidateIds.includes(player.id) ? "candidate" : ""}`} key={player.id}>
              <span className="avatar">{player.name.slice(0, 1)}</span><strong>{player.name}</strong>
              <div className="dice-pair">{player.rollValues ? player.rollValues.map((die, dieIndex) => <span key={dieIndex}>{die}</span>) : <span className="waiting">?</span>}</div>
            </div>)}
          </div>
          <p className="rolloff-rule">{t("rollOff.hint")}</p>
          {rollOffResult?.outcome && <div className="rolloff-result" role="status"><strong>{rollOffResult.outcome}</strong><small>{t("rollOff.resultContinues")}</small></div>}
          <button className="command dice-command" disabled={!canRollOff} onClick={() => send({ type: "ROLL_START" })}><span aria-hidden="true">⚄</span>{playbackBusy ? t("rollOff.showing") : me?.rollValues ? t("rollOff.waiting") : t("rollOff.roll")}</button>
        </section>
      )}

      {game!.phase === "DRAFTING" && (
        <section className="draft-stage stage">
          <div className="stage-title row"><div><p className="kicker">DRAFT {game!.draftRound} / {game!.draftRoundCount}</p><h2>{game!.activePlayerId === playerId ? t("draft.yourTurn")
              : t("draft.waitingFor", { name: game!.players.find((p) => p.id === game!.activePlayerId)?.name })}</h2></div><p>{t("draft.pool")}</p></div>
          <div className="draft-layout">
            <div className="draft-pool">{game!.draftPool.map((athlete) => <SelectionCard key={athlete.id} athlete={athlete} accent={cardAccents[athlete.id] ?? "#f2bd27"} recruit disabled={game!.activePlayerId !== playerId || status !== "connected"} reason={t("draft.notYet")} onChoose={() => send({ type: "DRAFT_ATHLETE", athleteId: athlete.id })} />)}</div>
            <aside className="team-board"><h3>{t("draft.team")}</h3>{game!.players.map((player, index) => <div className="team-row" key={player.id}><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong><div>{player.team.map((athlete) => <span title={cardName(athlete)} key={athlete.id}>{cardName(athlete).slice(0, 1)}</span>)}</div><small>{player.team.length} / {game!.cardsPerPlayer}</small></div>)}</aside>
          </div>
        </section>
      )}

      {game!.phase === "CHARACTER_SELECTION" && (
        <section className="selection-stage stage">
          <div className="selection-heading"><p className="kicker">RACE {game!.raceNumber} · {tracks[game!.raceNumber - 1]}</p><h2>{t("selection.title")}</h2><p>{t(game!.selectionCount === 1 ? "selection.hintOne" : "selection.hintMany", { count: game!.selectionCount })}</p></div>
          <div className="selection-meta"><strong>{t("selection.yourTeam", { count: me?.team.length ?? 0 })}</strong><span>{t("selection.rewards", { first: game!.raceRewards[0], second: game!.raceRewards[1] })}</span></div>
          <div className="my-team">{me?.team.map((athlete) => <SelectionCard key={athlete.id} athlete={athlete} accent={cardAccents[athlete.id] ?? "#f2bd27"} used={me.usedAthleteIds.includes(athlete.id)} selected={selectedIds.includes(athlete.id)} disabled={me.selectionLocked || (!selectedIds.includes(athlete.id) && selectedIds.length >= game!.selectionCount)} reason={me.selectionLocked ? t("selection.locked") : t("selection.full", { count: game!.selectionCount })} onChoose={() => toggleRacer(athlete.id)} />)}</div>
          <div className="selection-dock"><div className="selection-dock-inner"><div className="selection-chosen" aria-live="polite"><strong>{me?.team.filter((athlete) => selectedIds.includes(athlete.id)).map((athlete) => cardName(athlete)).join(" · ") || t("selection.nothingPicked")}</strong><span>{selectedIds.length} / {game!.selectionCount}</span></div><button className="selection-confirm" disabled={selectedIds.length !== game!.selectionCount || me?.selectionLocked || status !== "connected"} onClick={() => send({ type: "SELECT_RACERS", athleteIds: selectedIds })}>{me?.selectionLocked ? t("selection.locked") : status !== "connected" ? t("selection.reconnecting") : t("selection.confirm")}</button><p className="selection-ready">{t("selection.ready", { ready: game!.players.filter((player) => player.selectionLocked).length, total: game!.players.length })}</p></div></div>
        </section>
      )}

      {game!.phase === "RACING" && (
        <section className="race-stage stage">
          <div className="race-heading"><div><p className="kicker">RACE {game!.raceNumber} / 4</p><h2>{tracks[game!.raceNumber - 1]}</h2></div><div className="reward"><span>🏆 {game!.raceRewards[0]}</span><span>◉ {game!.raceRewards[1]}</span></div></div>
          {use3DRaceTable ? <Suspense fallback={<div className="race-table-loading" aria-label={t("race.loading")} />}>
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
              activePlayerName: game!.players.find((player) => player.id === (game!.pendingRoll?.nextPlayerId ?? game!.activePlayerId))?.name ?? t("race.otherPlayers"),
              onThrow: throwRaceDice,
              onSettled: () => finishDiceAnimation(`${rollAnimation?.revision}-${rollAnimation?.index}`),
            }} />
          </Suspense> : <div className="track-wrap"><RaceTrack moment={moment} players={game!.players} finishLine={game!.finishLine} trackName={game!.trackName} /></div>}
          <div className="race-console">
            <div className="score-strip">{game!.players.map((player, index) => <div className={game!.activePlayerId === player.id ? "active" : ""} key={player.id}><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong><small>{scoreLabel(player, game!.phase, t)}</small></div>)}</div>
            {!use3DRaceTable && <button className="command dice-command" disabled={!canRollRaceDice(
              controlGame,
              playerId,
              localRollPending || playbackBusy || !!rollAnimation || status !== "connected",
            )} onClick={() => throwRaceDice(actionId())}>{t("race.roll")}</button>}
          </div>
          {use3DRaceTable && <button className="race-details-toggle" aria-expanded={raceDetailsOpen} aria-controls="race-roster" onClick={() => setRaceDetailsOpen(!raceDetailsOpen)}>{raceDetailsOpen ? t("race.hideCards") : t("race.showCards")}</button>}
          <section id="race-roster" className="race-roster" aria-label={t("race.cardsTitle")}>
            <div className="race-roster-heading"><p className="kicker">RACERS IN PLAY</p><h3>{t("race.cardsHeading")}</h3></div>
            <div className="race-roster-scroll">
              {game!.players.map((player, index) => <article className={`racer-owner ${game!.activePlayerId === player.id ? "active" : ""}`} key={player.id}>
                <header><span className={`color-chip ${playerColors[index]}`} /><strong>{player.name}</strong>{player.id === playerId && <small>{t("common.you")}</small>}</header>
                <div>{player.activeRacers.map((racer) => <RacerCard key={racer.id} athlete={racer} compact status={racerStatus(racer, t)} />)}</div>
              </article>)}
            </div>
          </section>
        </section>
      )}

      {moment && <ActionMoment moment={moment} />}
      {liveDecision && <div className="decision-backdrop">
        <section className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title">
          <header><div><small>{athleteName(liveDecision.athleteId, liveDecision.athleteName)}</small><h2 id="decision-title">{decisionTitle(liveDecision, t)}</h2></div><strong>{decisionSeconds}s</strong></header>
          {liveDecision.rollPreview && <p className="decision-roll">{t("decision.rollPreview")} <strong>{liveDecision.rollPreview.value}</strong>{liveDecision.rollPreview.finalValue !== liveDecision.rollPreview.value && <small>{t("decision.finalMove", { value: liveDecision.rollPreview.finalValue })}</small>}</p>}
          <p>{decisionPrompt(liveDecision, t)}</p>
          <div className="decision-options">{liveDecision.options.map((option) => <button className="command secondary" key={option.id}
            disabled={liveDecision.playerId !== playerId || status !== "connected"}
            onClick={() => resolveDecision(liveDecision.id, option.id)}>{decisionOptionLabel(option.label, t)}{option.ownerName != null && <small className="decision-option-detail">{t("race:decision.optionDetail", { owner: option.ownerName, position: option.position })}</small>}</button>)}</div>
          {liveDecision.playerId !== playerId && <small>{t("decision.waitingFor", { name: controlGame?.players.find((player) => player.id === liveDecision.playerId)?.name })}</small>}
        </section>
      </div>}
      {!liveDecision && decisionReplay && <div className="decision-backdrop replay">
        <section className="decision-dialog" role="status" aria-live="polite">
          <header><div><small>{athleteName(decisionReplay.decision.athleteId, decisionReplay.decision.athleteName)}</small><h2>{decisionTitle(decisionReplay.decision, t)}</h2></div><strong className="decision-replay-badge">{t("decision.replayBadge")}</strong></header>
          <p>{decisionPrompt(decisionReplay.decision, t)}</p>
          <div className="decision-options">{decisionReplay.decision.options.map((option) => <button className={`command secondary ${option.id === decisionReplay.outcome.optionId ? "decision-chosen" : ""}`} key={option.id} disabled>
            {decisionOptionLabel(option.label, t)}{option.ownerName != null && <small className="decision-option-detail">{t("race:decision.optionDetail", { owner: option.ownerName, position: option.position })}</small>}</button>)}</div>
          <small className="decision-replay-note">{decisionReplay.outcome.automatic
            ? t("decision.replayTimeout", { name: decisionReplay.playerName, label: decisionReplay.chosenLabel })
            : t("decision.replayChosen", { name: decisionReplay.playerName, label: decisionReplay.chosenLabel })}</small>
        </section>
      </div>}

      {(game!.phase === "RACE_RESULTS" || game!.phase === "FINISHED") && (
        <section className="results-stage stage">
          <div className="stage-title"><p className="kicker">{game!.phase === "FINISHED" ? t("results.finalKicker") : t("results.raceKicker", { number: game!.raceNumber })}</p><h2>{game!.phase === "FINISHED"
            ? (game!.winnerIds.length > 1
              ? t("results.jointChampions")
              : t("results.winner", { name: game!.players.find((p) => p.id === game!.winnerIds[0])?.name }))
            : t("results.raceTitle")}</h2></div>
          <div className="podium-celebration" aria-hidden="true"><i className="confetti confetti-one">✦</i><i className="confetti confetti-two">✧</i><i className="firework firework-one">✹</i><i className="firework firework-two">✺</i></div>
          <div className="podium-list">{game!.players.slice().sort((a, b) => b.score - a.score).map((player, index) => <div key={player.id} className={index === 0 ? "leader" : index === 1 ? "second" : ""}><span>{index + 1}</span><strong>{player.name}</strong><div className="result-racers">{game!.raceResults.filter((result) => result.playerId === player.id).map((result) => <small key={result.athlete.id}>{cardName(result.athlete)} +{result.points}</small>)}</div><b>{t("results.points", { score: player.score })}</b></div>)}</div>
          {game!.phase === "RACE_RESULTS" && <button className="command primary big" disabled={!isHost} onClick={() => send({ type: "ADVANCE_RACE" })}>{isHost ? t("results.next") : t("results.waitingHost")}</button>}
        </section>
      )}

      {game!.phase !== "LOBBY" && (immersiveRace
        ? <aside id="race-feed" className={`race-feed ${feedOpen ? "open" : ""}`} aria-label={t("topbar.feed")} aria-hidden={!feedOpen}>
          <header>
            <strong>{t("topbar.feed")}</strong><span className="event-feed-count">{feedCount}</span>
            <button className="race-feed-close" aria-label={t("topbar.closeFeed")} onClick={() => setFeedOpen(false)}>×</button>
          </header>
          <div className="event-feed-list" aria-live="polite">
            {feedLines.length
              ? feedLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)
              : <span className="event-feed-empty">{t("feed.empty")}</span>}
          </div>
        </aside>
        : <details className={`event-feed ${game!.phase === "RACING" ? "racing" : ""}`} open>
          <summary><strong>{t("topbar.feed")}</strong><span className="event-feed-count">{feedCount}</span></summary>
          <div className="event-feed-list">
            {feedLines.length
              ? feedLines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)
              : <span className="event-feed-empty">{t("feed.empty")}</span>}
          </div>
        </details>)}
      {error && <div className="toast" role="alert">{error}<button aria-label={t("common.close")} onClick={() => setError("")}>×</button></div>}
    </main>
  );
}
