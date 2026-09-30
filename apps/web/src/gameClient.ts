import i18n from "./i18n";
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

export function clearSession(): void {
  localStorage.removeItem(storageKey);
}

export function roomFromPath(): string {
  const match = window.location.hash.match(/^#\/room\/([A-Za-z]{4,8})\/?$/);
  return match?.[1]?.toUpperCase() ?? "";
}

export function actionId(): string {
  // randomUUID is restricted to secure contexts; getRandomValues also works over HTTP.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
    const socket = new WebSocket(websocketUrl(intent.roomId));
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      onStatus("connected");
      this.send(intent);
    });
    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) return;
      onMessage(JSON.parse(event.data) as ServerMessage);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) onStatus("disconnected");
    });
  }

  send(intent: ClientIntent): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error(i18n.t("app:errors.notConnected"));
    }
    this.socket.send(JSON.stringify(intent));
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
