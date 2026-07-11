export type GamePhase = "LOBBY" | "CHARACTER_SELECTION" | "RACING" | "FINISHED";

export interface AthleteCard {
  id: string;
  name: string;
  nameZh: string;
  abilitySummary: string;
}

export interface PlayerState {
  id: string;
  name: string;
  position: number;
  connected: boolean;
  selectionLocked: boolean;
  selectedAthlete: AthleteCard | null;
}

export interface GameState {
  phase: GamePhase;
  finishLine: number;
  players: PlayerState[];
  hand: AthleteCard[];
  activePlayerId: string | null;
  winnerId: string | null;
}

export interface RoomSnapshot {
  roomId: string;
  revision: number;
  game: GameState;
}

export type ServerMessage =
  | (RoomSnapshot & {
      type: "WELCOME";
      playerId: string;
      reconnectToken: string;
    })
  | (RoomSnapshot & {
      type: "STATE_UPDATED";
      actionId?: string;
      events: GameEvent[];
    })
  | { type: "ACTION_ACK"; actionId: string; revision: number }
  | { type: "ERROR"; code: string; message: string; actionId?: string };

export type GameEvent = {
  type: string;
  playerId?: string;
  winnerId?: string;
  value?: number;
};

export type ClientIntent =
  | {
      type: "JOIN_ROOM";
      roomId: string;
      playerName: string;
      playerId?: string;
      reconnectToken?: string;
    }
  | { type: "START_GAME"; actionId: string }
  | { type: "SELECT_ATHLETE"; actionId: string; athleteId: string }
  | { type: "ROLL_DICE"; actionId: string };
