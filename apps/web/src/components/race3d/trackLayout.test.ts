import { describe, expect, it } from "vitest";
import { assignRacerPlacements, pathBetween, slotWorldPosition, trackPose } from "./trackLayout";

describe("track layout", () => {
  it("maps the start, corners, and finish to the fixed course", () => {
    expect(trackPose(0).position).toEqual({ x: -10.45, z: -3.25 });
    expect(trackPose(12).tangent).toEqual({ x: 1, z: 0 });
    expect(trackPose(13).tangent).toEqual({ x: 0, z: 1 });
    expect(trackPose(16).tangent).toEqual({ x: -1, z: 0 });
    expect(trackPose(30).position).toEqual({ x: -10.45, z: 3.25 });
    expect(trackPose(999).position).toEqual(trackPose(30).position);
  });

  it("provides six distinct slots without changing the authority tile", () => {
    const pose = trackPose(8);
    const slots = Array.from({ length: 6 }, (_, index) => slotWorldPosition(pose, index));
    expect(new Set(slots.map((slot) => `${slot.x}:${slot.z}`))).toHaveLength(6);
    expect(slots.every((slot) => Math.abs(slot.x - pose.position.x) <= 0.340001)).toBe(true);
  });

  it("assigns shared slots deterministically by player order and athlete id", () => {
    const racers = [
      { athleteId: "z", playerIndex: 1, position: 4, finished: false, finishPosition: null, eliminated: false },
      { athleteId: "b", playerIndex: 0, position: 4, finished: false, finishPosition: null, eliminated: false },
      { athleteId: "a", playerIndex: 0, position: 4, finished: false, finishPosition: null, eliminated: false },
    ];
    const first = assignRacerPlacements(racers);
    const reconnect = assignRacerPlacements([...racers].reverse());
    expect(first.map(({ athleteId, slotIndex }) => [athleteId, slotIndex])).toEqual([["a", 0], ["b", 1], ["z", 2]]);
    expect(reconnect).toEqual(first);
  });

  it("keeps finish and elimination slots separate from track zero", () => {
    const placements = assignRacerPlacements([
      { athleteId: "start", playerIndex: 0, position: 0, finished: false, finishPosition: null, eliminated: false },
      { athleteId: "done", playerIndex: 1, position: 30, finished: true, finishPosition: 1, eliminated: false },
      { athleteId: "out", playerIndex: 2, position: 0, finished: false, finishPosition: null, eliminated: true },
    ]);
    expect(new Set(placements.map(({ world }) => `${world.x}:${world.z}`)).size).toBe(3);
  });

  it("builds forward and backward step paths", () => {
    expect(pathBetween(2, 5)).toEqual([3, 4, 5]);
    expect(pathBetween(5, 2)).toEqual([4, 3, 2]);
    expect(pathBetween(3, 3)).toEqual([]);
  });
});
