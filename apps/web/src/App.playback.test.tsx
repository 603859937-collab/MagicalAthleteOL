import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { GameState, PendingDecision, ServerMessage } from "./protocol";
import type { RaceTableSceneProps } from "./components/race3d/RaceTableScene";
import { AthleteSkill } from "./components/AthleteSkill";
import { RaceLeaderboard } from "./components/RaceLeaderboard";

const connection = vi.hoisted(() => ({ receive: (_message: ServerMessage) => {}, send: vi.fn() }));
vi.mock("./gameClient", () => ({
  GameClient: class {
    connect(_intent: unknown, receive: typeof connection.receive, status: (value: string) => void) {
      connection.receive = receive;
      status("connected");
    }
    send = connection.send;
    close() {}
  },
  loadSession: () => null, saveSession: vi.fn(), clearSession: vi.fn(),
  roomFromPath: () => "TEST", actionId: () => "local-roll",
}));
vi.mock("./useBackgroundMusic", () => ({ useBackgroundMusic: () => null }));
vi.mock("./gameAudio", () => ({
  playCharacterScoreSound: vi.fn(), playMoveSound: vi.fn(), playFireworkSound: vi.fn(), unlockGameAudio: vi.fn(),
}));
vi.mock("./components/race3d/RaceTableScene", () => ({ RaceTableScene: (_props: RaceTableSceneProps) => null }));

let App: typeof import("./App").default;
let Scene: typeof import("./components/race3d/RaceTableScene").RaceTableScene;
let view: ReactTestRenderer;
const decision: PendingDecision = {
  id: "d1", playerId: "bot", athleteId: "legs", athleteName: "Legs", abilityName: "LongLegs",
  prompt: "Jog?", choiceType: "BOOLEAN", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
};
function game(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: "RACING", finishLine: 30, activePlayerId: "human", activeAthleteId: "banana",
    players: ["human", "bot"].map((id) => ({
      id, name: id, connected: true, isBot: id === "bot", position: 0, score: 0,
      selectionLocked: true, selectedAthlete: null, team: [], usedAthleteIds: [], rollValues: null,
      activeRacers: (id === "human" ? ["banana", "skipper"] : ["legs", "coach"]).map((id) => ({
        id, name: id, position: 0, points: 0, finished: false, finishPosition: null, eliminated: false, tripped: false,
      })),
    })),
    hand: [], winnerId: null, winnerIds: [], raceNumber: 1, trackName: "Standard", raceRewards: [2, 1],
    doubleRacerVariant: true, autoDeal: false, cardsPerPlayer: 8, selectionCount: 2,
    draftPool: [], draftRound: 0, draftRoundCount: 0, rollCandidateIds: [], raceResults: [],
    pendingDecision: null, pendingRoll: null, raceLog: [], resolutionStatus: "WAITING_FOR_ROLL", ...overrides,
  };
}
const scene = () => view.root.findByType(Scene).props as RaceTableSceneProps;
const dialogs = () => view.root.findAllByProps({ role: "dialog" });
async function receive(message: ServerMessage) { await act(async () => connection.receive(message)); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function join(state: GameState) {
  await act(async () => { view = create(<App />); });
  await act(async () => view.root.findAllByType("input")[0].props.onChange({ target: { value: "human" } }));
  await act(async () => view.root.findAllByType("button").find((button) => button.props.children === "加入房间")!.props.onClick());
  await receive({ type: "WELCOME", roomId: "TEST", revision: 1, playerId: "human", reconnectToken: "token", game: state });
}

beforeAll(async () => {
  vi.stubGlobal("window", {
    location: { search: "", hash: "", protocol: "http:" },
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  });
  App = (await import("./App")).default;
  Scene = (await import("./components/race3d/RaceTableScene")).RaceTableScene;
});
beforeEach(() => { vi.useFakeTimers(); connection.send.mockClear(); });
afterEach(() => { act(() => view?.unmount()); vi.useRealTimers(); });

it("shows copy candidate skills and the Twin's copied skill during the race", async () => {
  const twinDecision = { ...decision, athleteId: "twin", athleteName: "Twin", abilityName: "TwinCopy", choiceType: "RACER" as const,
    options: [{ id: "0", label: "Legs", athlete: { id: "legs", name: "Legs" } }] };
  await join(game({ pendingDecision: twinDecision, resolutionStatus: "WAITING_FOR_DECISION" }));
  expect(dialogs()[0].findByType(AthleteSkill).props.athlete.id).toBe("legs");
  expect(dialogs()[0].findAllByType("strong").some((node) => node.children.includes("慢跑"))).toBe(true);
  const racing = game();
  racing.players[0].activeRacers[0] = { ...racing.players[0].activeRacers[0], id: "twin", name: "Twin", copiedAthlete: { id: "legs", name: "Legs" } };
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 2, game: racing, rollResults: [], events: [] });
  await advance(5000);
  expect(view.root.findByProps({ className: "copied-from" }).children.join("")).toContain("已复制：长腿");
});

it("updates standings alongside movement playback", async () => {
  await join(game());
  const moved = game();
  moved.players[1].activeRacers[0].position = 5;
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 2, game: moved, rollResults: [], events: [
    { type: "RACER_MOVED", playerId: "bot", athleteId: "legs", from: 0, to: 5 },
  ] });
  await advance(300);
  const leaderboard = view.root.findByType(RaceLeaderboard);
  expect(leaderboard.props.players).toEqual(scene().players);
  await advance(5000);
  expect(view.root.findByType(RaceLeaderboard).props.players[1].activeRacers[0].position).toBe(5);
});

it("highlights the same waiting dialog before movement, then closes it", async () => {
  await join(game({ pendingDecision: decision, resolutionStatus: "WAITING_FOR_DECISION" }));
  const original = dialogs()[0];
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 2, game: game(), rollResults: [], events: [
    { type: "DECISION_RESOLVED", decisionId: "d1", playerId: "bot", optionId: "yes" },
    { type: "RACER_MOVED", playerId: "bot", athleteId: "legs", from: 0, to: 5 },
  ] });
  expect(dialogs()).toHaveLength(1);
  expect(dialogs()[0]).toBe(original);
  expect(original.findAllByType("button")[0].props.className).toContain("decision-chosen");
  expect(scene().players[1].activeRacers[0].position).toBe(0);
  await advance(1200);
  expect(dialogs()).toHaveLength(0);
});

it("does not reopen the choosing player's dialog after submission", async () => {
  await join(game({ pendingDecision: { ...decision, playerId: "human" }, resolutionStatus: "WAITING_FOR_DECISION" }));
  await act(async () => dialogs()[0].findAllByType("button")[0].props.onClick());
  expect(connection.send).toHaveBeenCalledWith(expect.objectContaining({ type: "RESOLVE_DECISION", optionId: "yes" }));
  expect(dialogs()).toHaveLength(0);
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 2, game: game(), rollResults: [], events: [
    { type: "DECISION_RESOLVED", decisionId: "d1", playerId: "human", optionId: "yes" },
  ] });
  expect(dialogs()).toHaveLength(0);
  await advance(5000);
  expect(dialogs()).toHaveLength(0);
});

it("queues Bot starts and results behind human movement and focuses the actual second racer", async () => {
  await join(game());
  const botTurn = game({ activePlayerId: "bot", activeAthleteId: "coach" });
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 2, game: botTurn, rollResults: [], events: [
    { type: "RACER_MOVED", playerId: "human", athleteId: "banana", from: 0, to: 3 },
  ] });
  await receive({ type: "ROLL_STARTED", roomId: "TEST", revision: 2, game: botTurn, actionId: "bot-roll", playerId: "bot" });
  expect(scene().dice.autoThrow).toBe(false);
  expect(scene().focus?.athleteId).toBe("banana");
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 3, game: game(), actionId: "bot-roll",
    rollResults: [{ id: "r1", values: [4] }], events: [] });
  expect(scene().dice.targetValue).toBeNull();
  expect(scene().focus?.athleteId).toBe("banana");
  await advance(5000);
  expect(scene().dice.targetValue).toBe(4);
  expect(scene().dice.autoThrow).toBe(true);
  expect(scene().focus).toEqual({ playerId: "bot", athleteId: "coach", close: true });
  expect(scene().turnKey).toBe("playback-3-0");
});

it("keeps a queued Bot throw automatic even while the local throw is settling", async () => {
  await join(game());
  await act(async () => scene().dice.onThrow("local-roll"));
  const botTurn = game({ activePlayerId: "bot", activeAthleteId: "legs" });
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 2, game: botTurn, actionId: "local-roll",
    rollResults: [{ id: "r1", values: [2] }], events: [] });
  expect(scene().dice.autoThrow).toBe(false);
  await receive({ type: "ROLL_STARTED", roomId: "TEST", revision: 2, game: botTurn, actionId: "bot-roll", playerId: "bot" });
  await receive({ type: "STATE_UPDATED", roomId: "TEST", revision: 3, game: game(), actionId: "bot-roll",
    rollResults: [{ id: "r2", values: [6] }], events: [] });
  expect(scene().dice.targetValue).toBe(2);
  await act(async () => scene().dice.onSettled());
  await advance(700);
  expect(scene().dice.restingValue).toBe(2);
  expect(scene().dice.targetValue).toBe(6);
  expect(scene().dice.autoThrow).toBe(true);
  expect(scene().focus?.athleteId).toBe("legs");
});
