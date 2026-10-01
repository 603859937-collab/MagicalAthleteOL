import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionId } from "./gameClient";

it('keeps player and spectator reconnect identities separate', async () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key)});
  try {
    const {saveSession, loadSession, clearSession} = await import('./gameClient');
    saveSession({roomId: 'TEST', playerId: 'player', playerName: 'A', reconnectToken: 'player-token'});
    saveSession({roomId: 'TEST', playerId: 'watcher', playerName: 'A', reconnectToken: 'watcher-token', role: 'spectator'});
    expect(loadSession('TEST')?.playerId).toBe('player');
    expect(loadSession('TEST', 'spectator')?.playerId).toBe('watcher');
    expect(loadSession('OTHER', 'spectator')).toBeNull();
    clearSession('spectator');
    expect(loadSession('TEST', 'spectator')).toBeNull();
    expect(loadSession('TEST')?.playerId).toBe('player');
  } finally { vi.unstubAllGlobals(); }
});

it("generates unique UUIDs on HTTP without crypto.randomUUID", () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    const ids = Array.from({ length: 100 }, actionId);
    expect(new Set(ids).size).toBe(100);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    vi.unstubAllGlobals();
  }
});

describe("room routing", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: {
        hash: "#/room/aBcD",
        origin: "https://xeonliu.github.io",
        protocol: "https:",
      },
    });
  });

  it("reads room IDs from the Pages hash route", async () => {
    const { roomFromPath } = await import("./gameClient");
    expect(roomFromPath()).toBe("ABCD");
  });
});

it("ignores socket events after cancelling or replacing a connection", async () => {
  const sockets: MockSocket[] = [];
  class MockSocket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn();
    constructor(_url: string) { super(); sockets.push(this); }
  }
  vi.stubGlobal("WebSocket", MockSocket);
  const { GameClient } = await import("./gameClient");
  const client = new GameClient();
  const message = vi.fn();
  const status = vi.fn();
  const intent = { type: "JOIN_ROOM" as const, roomId: "ABCD", playerName: "Alice" };
  try {
    client.connect(intent, message, status);
    client.close();
    sockets[0].dispatchEvent(new Event("open"));
    sockets[0].dispatchEvent(new MessageEvent("message", { data: '{"type":"ROOM_LEFT"}' }));
    expect(sockets[0].send).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    client.connect(intent, message, status);
    sockets[1].dispatchEvent(new Event("open"));
    sockets[0].dispatchEvent(new Event("close"));
    expect(status).toHaveBeenLastCalledWith("connected");
    expect(sockets[1].send).toHaveBeenCalledWith(JSON.stringify(intent));
  } finally {
    client.close();
    vi.unstubAllGlobals();
  }
});
