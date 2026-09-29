import { describe, expect, it } from "vitest";
import {
  assignRacerPlacements,
  BOARD_SIZE,
  pathBetween,
  RACER_PIECE_DIMENSIONS,
  racerPieceScale,
  slotWorldPosition,
  TRACK_GRID_GAP,
  trackPose,
} from "./trackLayout";

function rawSize(pose: ReturnType<typeof trackPose>): [number, number] {
  return [pose.size[0] + TRACK_GRID_GAP, pose.size[1] + TRACK_GRID_GAP];
}

function rightEdge(pose: ReturnType<typeof trackPose>) {
  return pose.position.x + rawSize(pose)[0] / 2;
}

function leftEdge(pose: ReturnType<typeof trackPose>) {
  return pose.position.x - rawSize(pose)[0] / 2;
}

function bottomEdge(pose: ReturnType<typeof trackPose>) {
  return pose.position.z + rawSize(pose)[1] / 2;
}

function topEdge(pose: ReturnType<typeof trackPose>) {
  return pose.position.z - rawSize(pose)[1] / 2;
}

describe("track layout", () => {
  it("maps the 2D board rectangles to one proportionally scaled 3D course", () => {
    expect(BOARD_SIZE).toEqual({ width: 24, depth: 7.2 });
    expect(trackPose(0).position.x).toBeCloseTo(-9.28);
    expect(trackPose(0).position.z).toBeCloseTo(-2.4);
    expect(trackPose(0).size[0]).toBeCloseTo(4.58);
    expect(trackPose(1).position.x).toBeCloseTo(-6.18666667);
    // The photographed board has 12 top cells, then 13/14 on the right.
    expect(trackPose(12).position.x).toBeCloseTo(10.82666667);
    expect(trackPose(12).position.z).toBeCloseTo(-2.4);
    expect(trackPose(13).position.x).toBeCloseTo(10.82666667);
    expect(trackPose(13).position.z).toBeCloseTo(-.8);
    expect(trackPose(14).position.z).toBeCloseTo(.8);
    expect(trackPose(15).position.z).toBeCloseTo(2.4);
    expect(trackPose(15).tangent).toEqual({ x: -1, z: 0 });
    expect(trackPose(29).position.x).toBeCloseTo(-10.82666667);
    expect(trackPose(29).position.z).toBeCloseTo(2.4);
    expect(trackPose(30).position.x).toBeCloseTo(-10.68);
    expect(trackPose(30).position.z).toBeCloseTo(.12);
  });

  it("keeps adjacent cells aligned across both turns and the two straight rows", () => {
    expect(leftEdge(trackPose(1))).toBeCloseTo(rightEdge(trackPose(0)));
    for (let step = 1; step < 12; step += 1) {
      expect(rightEdge(trackPose(step))).toBeCloseTo(leftEdge(trackPose(step + 1)));
    }
    for (let step = 12; step < 15; step += 1) {
      expect(rightEdge(trackPose(step))).toBeCloseTo(rightEdge(trackPose(step + 1)));
      expect(bottomEdge(trackPose(step))).toBeCloseTo(topEdge(trackPose(step + 1)));
    }
    for (let step = 15; step < 29; step += 1) {
      expect(leftEdge(trackPose(step))).toBeCloseTo(rightEdge(trackPose(step + 1)));
    }
    expect(
      (trackPose(2).position.x - trackPose(2).size[0] / 2)
      - (trackPose(1).position.x + trackPose(1).size[0] / 2),
    ).toBeCloseTo(TRACK_GRID_GAP);
  });

  it("centers a single racer and keeps every six-racer slot inside each kind of cell", () => {
    const cells = Array.from({ length: 31 }, (_, step) => trackPose(step));
    const single = slotWorldPosition(trackPose(8), 0, 1);
    expect(single).toEqual(trackPose(8).position);

    for (const pose of cells) {
      const slots = Array.from({ length: 6 }, (_, index) => slotWorldPosition(pose, index, 6));
      const footprint = (RACER_PIECE_DIMENSIONS.portraitWidth * racerPieceScale(6)) / 2;
      expect(new Set(slots.map((slot) => `${slot.x}:${slot.z}`))).toHaveLength(6);
      expect(slots.every((slot) => (
        Math.abs(slot.x - pose.position.x) + footprint <= pose.size[0] / 2 + 0.000001
        && Math.abs(slot.z - pose.position.z) + footprint <= pose.size[1] / 2 + 0.000001
      ))).toBe(true);
    }
  });

  it("assigns shared slots deterministically by player order and athlete id", () => {
    const racers = [
      { athleteId: "z", playerIndex: 1, position: 4, finished: false, finishPosition: null, eliminated: false },
      { athleteId: "b", playerIndex: 0, position: 4, finished: false, finishPosition: null, eliminated: false },
      { athleteId: "a", playerIndex: 0, position: 4, finished: false, finishPosition: null, eliminated: false },
    ];
    const first = assignRacerPlacements(racers);
    const reconnect = assignRacerPlacements([...racers].reverse());
    expect(first.map(({ athleteId, slotIndex, slotCount }) => [athleteId, slotIndex, slotCount])).toEqual([
      ["a", 0, 3], ["b", 1, 3], ["z", 2, 3],
    ]);
    expect(reconnect).toEqual(first);
  });

  it("uses the start, finish podium, and off-board exit as separate authority locations", () => {
    const placements = assignRacerPlacements([
      { athleteId: "start", playerIndex: 0, position: 0, finished: false, finishPosition: null, eliminated: false },
      { athleteId: "done", playerIndex: 1, position: 30, finished: true, finishPosition: 1, eliminated: false },
      { athleteId: "out", playerIndex: 2, position: 0, finished: false, finishPosition: null, eliminated: true },
    ]);
    const start = placements.find((placement) => placement.athleteId === "start")!;
    const done = placements.find((placement) => placement.athleteId === "done")!;
    const out = placements.find((placement) => placement.athleteId === "out")!;
    expect(start.world).toEqual(trackPose(0).position);
    expect(done.world).toEqual(trackPose(30).position);
    expect(out.world.z).toBeGreaterThan(BOARD_SIZE.depth / 2);
  });

  it("builds forward and backward step paths", () => {
    expect(pathBetween(2, 5)).toEqual([3, 4, 5]);
    expect(pathBetween(5, 2)).toEqual([4, 3, 2]);
    expect(pathBetween(3, 3)).toEqual([]);
  });
});
