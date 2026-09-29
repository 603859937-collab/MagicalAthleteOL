import { expect, it } from "vitest";
import { decisionOptionLabel, decisionPrompt, decisionTitle } from "./decisionPresentation";
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
