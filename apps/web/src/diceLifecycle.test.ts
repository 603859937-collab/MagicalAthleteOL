import { describe, expect, it } from "vitest";
import { createDiceLifecycle, syncDiceLifecycle, takeDiceResetValue } from "./diceLifecycle";

describe("dice lifecycle", () => {
  it("preserves an authoritative target through the initial reset", () => {
    const lifecycle = createDiceLifecycle(5, 5);

    expect(takeDiceResetValue(lifecycle, 0)).toBe(5);
    expect(lifecycle.targetValue).toBe(5);
  });

  it("does not replay the same reset during StrictMode effect replay", () => {
    const lifecycle = createDiceLifecycle(4, 4);

    expect(takeDiceResetValue(lifecycle, 0)).toBe(4);
    expect(takeDiceResetValue(lifecycle, 0)).toBeUndefined();
  });

  it("retains the authoritative resting face after an animation timeout", () => {
    const lifecycle = createDiceLifecycle(6, 6);

    syncDiceLifecycle(lifecycle, null, 6);

    expect(takeDiceResetValue(lifecycle, 1)).toBe(6);
    expect(lifecycle.targetValue).toBeNull();
  });
});
