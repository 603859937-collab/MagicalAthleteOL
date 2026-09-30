import { expect, it } from "vitest";
import { decisionOptionLabel, decisionPrompt, decisionResolution, decisionTitle } from "./decisionPresentation";
import type { PendingDecision } from "./protocol";

it("localizes copied skill choices without changing numeric choices", () => {
  const decision = { abilityName: "TwinCopy", athleteName: "双胞胎", choiceType: "RACER" } as PendingDecision;
  expect(decisionTitle(decision)).toBe("双倍下注");
  expect(decisionPrompt(decision)).toBe("选择本次复制的角色能力");
  expect(decisionOptionLabel("Legs")).toBe("长腿");
  expect(decisionOptionLabel("6")).toBe("6");
});

it("distinguishes predicting a future roll from selecting a die already rolled", () => {
  const prediction = { abilityName: "GeniusPrediction", choiceType: "DIE" } as PendingDecision;
  const selection = { abilityName: "LongLegs", choiceType: "DIE" } as PendingDecision;
  expect(decisionPrompt(prediction)).toContain("预测");
  expect(decisionPrompt(selection)).toBe("选择本次使用的骰点");
});

it("explains the swap cost and optional decline", () => {
  const decision = { abilityName: "FlipFlopSwap", choiceType: "RACER" } as PendingDecision;
  expect(decisionPrompt(decision)).toContain("跳过本回合的正常移动");
  expect(decisionPrompt(decision)).toContain("不使用");
});

it("shows who the suckerfish will follow and its destination before movement commits", () => {
  const decision = { abilityName: "SuckerfishRide", choiceType: "BOOLEAN",
    effectPreview: { athleteName: "教练", from: 8, to: 3 } } as PendingDecision;
  expect(decisionPrompt(decision)).toBe("是否跟随教练，从第 8 格移动到第 3 格？");
});

it("reports the picked option so every table can replay the closed dialog", () => {
  const decision = { id: "d1", playerId: "p1", abilityName: "FlipFlopSwap" } as PendingDecision;
  expect(decisionResolution(decision, [
    { type: "DECISION_RESOLVED", decisionId: "d1", playerId: "p2", optionId: "2", automatic: false },
  ])).toEqual({ optionId: "2", automatic: false, playerId: "p2" });
  expect(decisionResolution(decision, [
    { type: "DECISION_TIMED_OUT", decisionId: "d1", playerId: "p1", optionId: "", automatic: true },
  ])).toEqual({ optionId: null, automatic: true, playerId: "p1" });
});

it("ignores resolutions of another decision or an unrelated event", () => {
  const decision = { id: "d1", playerId: "p1", abilityName: "FlipFlopSwap" } as PendingDecision;
  expect(decisionResolution(decision, [{ type: "DECISION_RESOLVED", decisionId: "d2", optionId: "1" }])).toBeNull();
  expect(decisionResolution(decision, [{ type: "DIE_ROLLED", value: 3 }])).toBeNull();
  expect(decisionResolution(null, [{ type: "DECISION_RESOLVED", decisionId: "d1", optionId: "1" }])).toBeNull();
});
