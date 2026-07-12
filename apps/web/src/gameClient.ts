import type { ClientIntent, ServerMessage } from "./protocol";
import { websocketUrl } from "./runtimeConfig";

export interface SessionIdentity {
  roomId: string;
  playerId: string;
  reconnectToken: string;
  playerName: string;
}

const storageKey = "magical-athlete-session";

export function loadSession(roomId: string): SessionIdentity | null {
  const value = localStorage.getItem(storageKey);
  if (!value) return null;
  try {
    const session = JSON.parse(value) as SessionIdentity;
    return session.roomId === roomId ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionIdentity): void {
  localStorage.setItem(storageKey, JSON.stringify(session));
}

export function roomFromPath(): string {
  const match = window.location.hash.match(/^#\/room\/([A-Za-z]{4,8})\/?$/);
  return match?.[1]?.toUpperCase() ?? "";
}

export function actionId(): string {
  return crypto.randomUUID();
}

export class GameClient {
  private socket: WebSocket | null = null;

  connect(
    intent: Extract<ClientIntent, { type: "JOIN_ROOM" }>,
    onMessage: (message: ServerMessage) => void,
    onStatus: (status: "connecting" | "connected" | "disconnected") => void,
  ): void {
    this.close();
    onStatus("connecting");
    this.socket = new WebSocket(websocketUrl(intent.roomId));
    this.socket.addEventListener("open", () => {
      onStatus("connected");
      this.send(intent);
    });
    this.socket.addEventListener("message", (event) => {
      onMessage(JSON.parse(event.data) as ServerMessage);
    });
    this.socket.addEventListener("close", () => onStatus("disconnected"));
  }

  send(intent: ClientIntent): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error("尚未连接到房间");
    }
    this.socket.send(JSON.stringify(intent));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
