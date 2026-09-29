import { describe, expect, it } from "vitest";
import type { PlayerState } from "./protocol";
import { scoreLabel } from "./scorePresentation";

describe("scoreLabel", () => {
  const player = {
    score: 4,
    activeRacers: [{ points: 2 }, { points: 1 }],
  } as PlayerState;

  it("shows accumulated skill points from both racers during a race", () => {
    expect(scoreLabel(player, "RACING")).toBe("4 分 + 本场 3 分");
  });

  it("does not count race points again after settlement", () => {
    for (const phase of ["RACE_RESULTS", "FINISHED"] as const) {
      expect(scoreLabel({ ...player, score: 7 }, phase)).toBe("7 分");
    }
  });
});
