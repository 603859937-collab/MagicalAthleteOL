import { describe, expect, it } from "vitest";

import type { GameState } from "./protocol";
import { canRollRaceDice } from "./raceControls";

const game = {
  phase: "RACING",
  activePlayerId: "p0",
  resolutionStatus: "WAITING_FOR_ROLL",
  pendingDecision: null,
} as GameState;

describe("canRollRaceDice", () => {
  it("only enables the current player at the roll pause", () => {
    expect(canRollRaceDice(game, "p0", false)).toBe(true);
    expect(canRollRaceDice(game, "p1", false)).toBe(false);
    expect(canRollRaceDice({ ...game, resolutionStatus: "IDLE" }, "p0", false)).toBe(false);
    expect(canRollRaceDice({ ...game, resolutionStatus: "WAITING_FOR_DECISION" }, "p0", false)).toBe(false);
  });

  it("stays disabled during decisions and animation playback", () => {
    expect(canRollRaceDice({ ...game, pendingDecision: {} as GameState["pendingDecision"] }, "p0", false)).toBe(false);
    expect(canRollRaceDice(game, "p0", true)).toBe(false);
  });
});
