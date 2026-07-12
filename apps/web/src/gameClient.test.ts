import { beforeEach, describe, expect, it, vi } from "vitest";

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
