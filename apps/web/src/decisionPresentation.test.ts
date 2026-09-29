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
