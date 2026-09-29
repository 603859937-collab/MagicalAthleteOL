import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionId } from "./gameClient";

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
