import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { DICE_FACE_NORMALS, targetQuaternion, throwVector } from "./diceOrientation";

describe("targetQuaternion", () => {
  it.each([1, 2, 3, 4, 5, 6])("turns face %i upward", (value) => {
    const upwardNormal = DICE_FACE_NORMALS[value].clone().applyQuaternion(targetQuaternion(value));

    expect(upwardNormal.distanceTo(new Vector3(0, 1, 0))).toBeLessThan(0.000001);
  });

  it("falls back to face 1 for an invalid value", () => {
    expect(targetQuaternion(0).angleTo(targetQuaternion(1))).toBeLessThan(0.000001);
  });
});

describe("throwVector", () => {
  it("returns the same launch vector for the same throw", () => {
    expect(throwVector("start-roll-1")).toEqual(throwVector("start-roll-1"));
    expect(throwVector("start-roll-1")).not.toEqual(throwVector("start-roll-2"));
  });
});
