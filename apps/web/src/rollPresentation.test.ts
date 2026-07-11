import { describe, expect, it } from "vitest";
import type { DiceRollResult, GameEvent, RoomSnapshot } from "./protocol";
import { collectUnseenRollValues, latestAuthoritativeRollValue } from "./rollPresentation";

function update(revision: number, rollSerial: number, value: number, events: GameEvent[] = []): RoomSnapshot & { events: GameEvent[] } {
  return {
    roomId: "TEST",
    revision,
    events,
    game: {
      raceNumber: 1,
      pendingDecision: {
        id: `decision-${rollSerial}`,
        playerId: "p0",
        athleteId: "magician",
        athleteName: "魔术师",
        abilityName: "MagicalReroll",
        prompt: "是否重投？",
        choiceType: "BOOLEAN",
        options: [],
        rollPreview: { rollSerial, value, baseValue: value, finalValue: value },
      },
    } as unknown as RoomSnapshot["game"],
  };
}

describe("collectUnseenRollValues", () => {
  it("uses globally identified server results as the authoritative source", () => {
    const shown = new Set<string>();
    const message = update(8, 4, 6);
    const rollResults: DiceRollResult[] = [{
      id: "race:1:serial:4", playerId: "p0", values: [6], rollSerial: 4,
    }];

    expect(collectUnseenRollValues({ ...message, rollResults }, shown)).toEqual([6]);
    expect(collectUnseenRollValues({ ...message, rollResults }, shown)).toEqual([]);
  });

  it("shows each reroll preview once and suppresses its matching final event", () => {
    const shown = new Set<string>();

    expect(collectUnseenRollValues(update(1, 1, 2), shown)).toEqual([2]);
    expect(collectUnseenRollValues(update(2, 3, 5), shown)).toEqual([5]);

    const final = update(3, 3, 5, [{ type: "DICE_ROLLED", value: 5, rollSerial: 3 }]);
    final.game.pendingDecision = null;
    expect(collectUnseenRollValues(final, shown)).toEqual([]);
  });

  it("still animates an ordinary final roll without a preview", () => {
    const shown = new Set<string>();
    const message = update(1, 1, 4, [{ type: "DICE_ROLLED", value: 4, rollSerial: 1 }]);
    message.game.pendingDecision = null;

    expect(collectUnseenRollValues(message, shown)).toEqual([4]);
  });
});

describe("latestAuthoritativeRollValue", () => {
  it("restores the latest completed roll from an authoritative snapshot", () => {
    const message = update(4, 3, 2);
    message.game.pendingDecision = null;
    message.game.raceLog = [
      { type: "DICE_ROLLED", value: 3, rollSerial: 2 },
      { type: "DICE_ROLLED", value: 6, rollSerial: 3 },
    ];

    expect(latestAuthoritativeRollValue(message)).toBe(6);
  });

  it("prefers an in-progress roll preview over the completed race log", () => {
    const message = update(5, 4, 2);
    message.game.raceLog = [{ type: "DICE_ROLLED", value: 6, rollSerial: 3 }];

    expect(latestAuthoritativeRollValue(message)).toBe(2);
  });
});
