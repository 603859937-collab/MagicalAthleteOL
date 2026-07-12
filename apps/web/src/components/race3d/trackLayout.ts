export type WorldPoint = { x: number; z: number };

export interface TrackPose {
  position: WorldPoint;
  tangent: WorldPoint;
  size: readonly [number, number];
}

export interface RacerPlacementInput {
  athleteId: string;
  playerIndex: number;
  position: number;
  finished: boolean;
  finishPosition: number | null;
  eliminated: boolean;
}

export interface RacerPlacement extends RacerPlacementInput {
  world: WorldPoint;
  slotIndex: number;
  slotCount: number;
  tangent: WorldPoint;
}

export const TRACK_LENGTH = 30;

// Keep the 3D board on the exact 1200 x 360 grid used by RaceTrack.tsx.
// A uniform scale preserves every cell's proportions and shared edges.
export const BOARD_SIZE = { width: 24, depth: 7.2 } as const;
export const RACER_PIECE_DIMENSIONS = {
  baseRadius: 0.28,
  portraitWidth: 0.62,
  portraitHeight: 0.9,
} as const;
export const FINISH_BADGE_RECT = { x: 38, y: 120, width: 85, height: 120 } as const;

const REFERENCE_BOARD = { width: 1200, height: 360 } as const;
const WORLD_SCALE = BOARD_SIZE.width / REFERENCE_BOARD.width;
export const TRACK_GRID_GAP = 0.06;
const SLOT_EDGE_CLEARANCE = 0.05;

type ReferenceRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  tangent: WorldPoint;
};

function referenceRectToPose(rect: ReferenceRect): TrackPose {
  return {
    position: {
      x: (rect.x + rect.width / 2 - REFERENCE_BOARD.width / 2) * WORLD_SCALE,
      z: (rect.y + rect.height / 2 - REFERENCE_BOARD.height / 2) * WORLD_SCALE,
    },
    tangent: rect.tangent,
    size: [
      Math.max(0, rect.width * WORLD_SCALE - TRACK_GRID_GAP),
      Math.max(0, rect.height * WORLD_SCALE - TRACK_GRID_GAP),
    ],
  };
}

function referenceRectForStep(step: number): ReferenceRect {
  if (step === 0) {
    return { x: 29, y: 28, width: 205, height: 78, tangent: { x: 1, z: 0 } };
  }
  if (step <= 12) {
    return {
      x: 234 + (step - 1) * (871 / 12), y: 28, width: 871 / 12, height: 78,
      tangent: { x: 1, z: 0 },
    };
  }
  if (step <= 14) {
    return { x: 1105, y: 106 + (step - 13) * 74, width: 66, height: 74, tangent: { x: 0, z: 1 } };
  }
  if (step <= 29) {
    return { x: 1105 - (step - 15) * 70, y: 254, width: 70, height: 78, tangent: { x: -1, z: 0 } };
  }
  return { ...FINISH_BADGE_RECT, tangent: { x: 0, z: -1 } };
}

const TRACK_POSES = Array.from(
  { length: TRACK_LENGTH + 1 },
  (_, step) => referenceRectToPose(referenceRectForStep(step)),
);

const ELIMINATED_POSE: TrackPose = {
  position: { x: 0, z: 3.8 },
  tangent: { x: 1, z: 0 },
  size: [5.6, 0.35],
};

function clampSlotCount(slotCount: number): number {
  return Math.max(1, Math.min(6, Math.round(slotCount)));
}

function slotCoordinate(slotIndex: number, slotCount: number): { along: number; across: number } {
  const index = Math.max(0, Math.min(slotIndex, slotCount - 1));
  const slots = {
    1: [{ along: 0, across: 0 }],
    2: [{ along: -0.5, across: 0 }, { along: 0.5, across: 0 }],
    3: [{ along: -1, across: 0 }, { along: 0, across: 0 }, { along: 1, across: 0 }],
    4: [
      { along: -0.5, across: -0.5 }, { along: 0.5, across: -0.5 },
      { along: -0.5, across: 0.5 }, { along: 0.5, across: 0.5 },
    ],
    5: [
      { along: -1, across: -0.5 }, { along: 0, across: -0.5 }, { along: 1, across: -0.5 },
      { along: -0.5, across: 0.5 }, { along: 0.5, across: 0.5 },
    ],
    6: [
      { along: -1, across: -0.5 }, { along: 0, across: -0.5 }, { along: 1, across: -0.5 },
      { along: -1, across: 0.5 }, { along: 0, across: 0.5 }, { along: 1, across: 0.5 },
    ],
  } as const;
  return slots[slotCount as keyof typeof slots][index];
}

export function racerPieceScale(slotCount: number): number {
  switch (clampSlotCount(slotCount)) {
    case 1: return 1;
    case 2: return 0.82;
    case 3: return 0.64;
    case 4: return 0.57;
    case 5: return 0.52;
    default: return 0.5;
  }
}

export function normalizedTrackStep(position: number, finishLine = TRACK_LENGTH): number {
  const safeFinishLine = Number.isFinite(finishLine) ? Math.max(1, finishLine) : TRACK_LENGTH;
  const safePosition = Number.isFinite(position) ? Math.max(0, Math.min(position, safeFinishLine)) : 0;
  return Math.max(0, Math.min(TRACK_LENGTH, Math.round((safePosition / safeFinishLine) * TRACK_LENGTH)));
}

export function trackPose(position: number, finishLine = TRACK_LENGTH): TrackPose {
  return TRACK_POSES[normalizedTrackStep(position, finishLine)];
}

export function slotWorldPosition(pose: TrackPose, slotIndex: number, slotCount = 6): WorldPoint {
  const count = clampSlotCount(slotCount);
  const coordinate = slotCoordinate(slotIndex, count);
  const scale = racerPieceScale(count);
  const footprint = (RACER_PIECE_DIMENSIONS.portraitWidth * scale) / 2;
  const alongSize = Math.abs(pose.tangent.x) > 0 ? pose.size[0] : pose.size[1];
  const acrossSize = Math.abs(pose.tangent.x) > 0 ? pose.size[1] : pose.size[0];
  const alongMax = count <= 2 ? 0.5 : 1;
  const acrossMax = count <= 3 ? 0 : 0.5;
  const alongStep = Math.max(0, (alongSize - 2 * (footprint + SLOT_EDGE_CLEARANCE)) / (2 * alongMax));
  const acrossStep = acrossMax === 0 ? 0 : Math.max(0, (acrossSize - 2 * (footprint + SLOT_EDGE_CLEARANCE)) / (2 * acrossMax));
  const normal = { x: -pose.tangent.z, z: pose.tangent.x };
  const alongOffset = coordinate.along * alongStep;
  const acrossOffset = coordinate.across * acrossStep;
  return {
    x: pose.position.x + pose.tangent.x * alongOffset + normal.x * acrossOffset,
    z: pose.position.z + pose.tangent.z * alongOffset + normal.z * acrossOffset,
  };
}

export function assignRacerPlacements(racers: readonly RacerPlacementInput[], finishLine = TRACK_LENGTH): RacerPlacement[] {
  const sorted = [...racers].sort((a, b) => a.playerIndex - b.playerIndex || a.athleteId.localeCompare(b.athleteId));
  const candidates = sorted.map((racer) => {
    if (racer.eliminated) return { racer, pose: ELIMINATED_POSE, bucket: "eliminated" };
    const step = racer.finished ? TRACK_LENGTH : normalizedTrackStep(racer.position, finishLine);
    return { racer, pose: TRACK_POSES[step], bucket: `track:${step}` };
  });
  const slotCounts = new Map<string, number>();
  for (const { bucket } of candidates) slotCounts.set(bucket, (slotCounts.get(bucket) ?? 0) + 1);
  const occupied = new Map<string, number>();

  return candidates.map(({ racer, pose, bucket }) => {
    const slotIndex = occupied.get(bucket) ?? 0;
    occupied.set(bucket, slotIndex + 1);
    const slotCount = slotCounts.get(bucket) ?? 1;
    return {
      ...racer,
      slotIndex,
      slotCount,
      world: slotWorldPosition(pose, slotIndex, slotCount),
      tangent: pose.tangent,
    };
  });
}

export function pathBetween(from: number, to: number): number[] {
  if (from === to) return [];
  const direction = to > from ? 1 : -1;
  const path: number[] = [];
  for (let step = from + direction; direction > 0 ? step <= to : step >= to; step += direction) path.push(step);
  return path;
}
