import { describe, expect, it } from "vitest";

import type { GameState } from "./protocol";
import { canRollRaceDice, raceDiceTurnKey } from "./raceControls";

const game = {
  phase: "RACING",
  activePlayerId: "p0",
  resolutionStatus: "WAITING_FOR_ROLL",
  pendingDecision: null,
  pendingRoll: null,
  raceNumber: 1,
  raceLog: [],
} as unknown as GameState;

describe("race dice preparation", () => {
  it("prepares a normal turn before the server creates a pending roll", () => {
    expect(canRollRaceDice(game, "p0", false)).toBe(true);
    expect(raceDiceTurnKey(game, false)).toBeDefined();
  });

  it("leaves the die alone while actions and decisions play", () => {
    expect(raceDiceTurnKey(game, true)).toBeUndefined();
    expect(raceDiceTurnKey({ ...game, resolutionStatus: "WAITING_FOR_DECISION" }, false)).toBeUndefined();
  });

  it("prepares again for a consecutive turn by the same racer", () => {
    const next = { ...game, raceLog: [{ type: "DICE_ROLLED", rollSerial: 1 }] };
    expect(raceDiceTurnKey(next, false)).not.toBe(raceDiceTurnKey(game, false));
  });

  it("prepares each participant in an ability roll", () => {
    const duel = { ...game, pendingRoll: { id: "duel", throwIndex: 0 } as NonNullable<GameState["pendingRoll"]> };
    expect(raceDiceTurnKey(duel, false)).not.toBe(raceDiceTurnKey({ ...duel,
      pendingRoll: { ...duel.pendingRoll, throwIndex: 1 } }, false));
  });
});

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

  it("hands an ability roll to the pending participant without changing the turn owner", () => {
    const duel = {
      ...game,
      pendingRoll: { nextPlayerId: "p1" } as GameState["pendingRoll"],
    };
    expect(canRollRaceDice(duel, "p0", false)).toBe(false);
    expect(canRollRaceDice(duel, "p1", false)).toBe(true);
  });
});
