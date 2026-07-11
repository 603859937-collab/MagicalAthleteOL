export type GamePhase =
  | "LOBBY"
  | "DRAFT_ROLL"
  | "DRAFTING"
  | "RACE_ROLL"
  | "CHARACTER_SELECTION"
  | "RACING"
  | "RACE_RESULTS"
  | "FINISHED";

export interface AthleteCard {
  id: string;
  name: string;
  nameZh: string;
  abilityTitleZh: string;
  abilitySummary: string;
}

export interface ActiveRacer extends AthleteCard {
  position: number;
  points: number;
  finished: boolean;
  finishPosition: number | null;
  eliminated: boolean;
  tripped: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  position: number;
  connected: boolean;
  score: number;
  selectionLocked: boolean;
  selectedAthlete: ActiveRacer | null;
  activeRacers: ActiveRacer[];
  team: AthleteCard[];
  usedAthleteIds: string[];
  rollValues: number[] | null;
}

export interface RaceResult {
  playerId: string;
  athlete: AthleteCard;
  finishPosition: number | null;
  points: number;
  position: number | null;
  eliminated: boolean;
}

export interface DecisionOption { id: string; label: string }
export interface PendingDecision {
  id: string;
  playerId: string;
  athleteId: string;
  athleteName: string;
  abilityName: string;
  prompt: string;
  choiceType: "BOOLEAN" | "RACER" | "TILE" | "DIE";
  options: DecisionOption[];
  deadlineAt?: string;
}

export interface GameState {
  phase: GamePhase;
  finishLine: number;
  players: PlayerState[];
  hand: AthleteCard[];
  activePlayerId: string | null;
  winnerId: string | null;
  winnerIds: string[];
  raceNumber: number;
  trackName: "Standard" | "WildWilds";
  raceRewards: [number, number];
  doubleRacerVariant: boolean;
  selectionCount: number;
  draftPool: AthleteCard[];
  draftRound: number;
  draftRoundCount: number;
  rollCandidateIds: string[];
  raceResults: RaceResult[];
  pendingDecision: PendingDecision | null;
  raceLog: GameEvent[];
  resolutionStatus: "IDLE" | "ANIMATING" | "WAITING_FOR_DECISION";
}

export interface RoomSnapshot {
  roomId: string;
  revision: number;
  game: GameState;
}

export type ServerMessage =
  | (RoomSnapshot & { type: "WELCOME"; playerId: string; reconnectToken: string })
  | (RoomSnapshot & { type: "STATE_UPDATED"; actionId?: string; events: GameEvent[] })
  | (RoomSnapshot & { type: "ROLL_STARTED"; actionId: string; playerId: string })
  | { type: "ACTION_ACK"; actionId: string; revision: number }
  | { type: "ERROR"; code: string; message: string; actionId?: string };

export type GameEvent = {
  type: string;
  playerId?: string;
  playerIds?: string[];
  athleteId?: string;
  values?: number[];
  value?: number;
  baseValue?: number;
  finalValue?: number;
  finishPosition?: number;
  raceNumber?: number;
  from?: number;
  to?: number;
  movementKind?: "FORWARD" | "BACKWARD" | "WARP" | "SWAP" | "PUSH";
  source?: string;
  sourcePlayerId?: string;
  sourceAthleteId?: string;
  sourceAthleteName?: string;
  abilityName?: string;
  movementDistance?: number;
  decisionId?: string;
  optionId?: string;
  automatic?: boolean;
  sequence?: number;
};

export type ClientIntent =
  | { type: "JOIN_ROOM"; roomId: string; playerName: string; playerId?: string; reconnectToken?: string }
  | { type: "START_GAME"; actionId: string }
  | { type: "SET_VARIANT"; actionId: string; doubleRacer: boolean }
  | { type: "ROLL_START"; actionId: string }
  | { type: "DRAFT_ATHLETE"; actionId: string; athleteId: string }
  | { type: "SELECT_RACERS"; actionId: string; athleteIds: string[] }
  | { type: "ROLL_DICE"; actionId: string }
  | { type: "RESOLVE_DECISION"; actionId: string; decisionId: string; optionId: string }
  | { type: "ADVANCE_RACE"; actionId: string };
