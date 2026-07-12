import { describe, expect, it } from "vitest";
import { inwardThrowVelocity, isInwardDiceDrag } from "./TableDice";

describe("table dice drag", () => {
  it("accepts a deliberate drag toward the board interior", () => {
    expect(isInwardDiceDrag({ z: 3.2 }, { z: 2.4 })).toBe(true);
    expect(inwardThrowVelocity({ x: 0, z: 3.2 }, { x: 0.7, z: 2.4 })).toMatchObject({
      x: 1.75,
    });
    expect(inwardThrowVelocity({ x: 0, z: 3.2 }, { x: 0.7, z: 2.4 }).z).toBeLessThan(0);
  });

  it("rejects taps and outward drags", () => {
    expect(isInwardDiceDrag({ z: 3.2 }, { z: 3.1 })).toBe(false);
    expect(isInwardDiceDrag({ z: 3.2 }, { z: 3.6 })).toBe(false);
  });

  it("clamps extreme sideways launch velocity", () => {
    expect(inwardThrowVelocity({ x: 0, z: 3.2 }, { x: 20, z: -2 }).x).toBe(5.5);
    expect(inwardThrowVelocity({ x: 0, z: 3.2 }, { x: -20, z: -2 }).x).toBe(-5.5);
  });
});
