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
  tangent: WorldPoint;
}

export const TRACK_LENGTH = 30;
export const BOARD_SIZE = { width: 24, depth: 9.2 } as const;

const START: TrackPose = {
  position: { x: -10.45, z: -3.25 },
  tangent: { x: 1, z: 0 },
  size: [1.35, 1.45],
};

const SLOT_OFFSETS: readonly WorldPoint[] = [
  { x: -0.34, z: -0.23 }, { x: 0, z: -0.23 }, { x: 0.34, z: -0.23 },
  { x: -0.34, z: 0.23 }, { x: 0, z: 0.23 }, { x: 0.34, z: 0.23 },
];

export function trackPose(position: number, finishLine = TRACK_LENGTH): TrackPose {
  const normalized = Math.round((Math.max(0, Math.min(position, finishLine)) / finishLine) * TRACK_LENGTH);
  if (normalized === 0) return START;
  if (normalized <= 12) {
    return {
      position: { x: -9.15 + (normalized - 1) * 1.48, z: -3.25 },
      tangent: { x: 1, z: 0 },
      size: [1.38, 1.45],
    };
  }
  if (normalized <= 15) {
    return {
      position: { x: 8.75, z: -1.65 + (normalized - 13) * 1.65 },
      tangent: { x: 0, z: 1 },
      size: [1.5, 1.55],
    };
  }
  if (normalized <= 29) {
    return {
      position: { x: 7.95 - (normalized - 16) * 1.34, z: 3.25 },
      tangent: { x: -1, z: 0 },
      size: [1.25, 1.45],
    };
  }
  return {
    position: { x: -10.45, z: 3.25 },
    tangent: { x: -1, z: 0 },
    size: [1.35, 1.45],
  };
}

export function slotWorldPosition(pose: TrackPose, slotIndex: number): WorldPoint {
  const offset = SLOT_OFFSETS[Math.max(0, Math.min(slotIndex, SLOT_OFFSETS.length - 1))];
  return { x: pose.position.x + offset.x, z: pose.position.z + offset.z };
}

export function assignRacerPlacements(racers: readonly RacerPlacementInput[], finishLine = TRACK_LENGTH): RacerPlacement[] {
  const sorted = [...racers].sort((a, b) => a.playerIndex - b.playerIndex || a.athleteId.localeCompare(b.athleteId));
  const occupied = new Map<string, number>();

  return sorted.map((racer) => {
    let pose: TrackPose;
    let bucket: string;
    if (racer.eliminated) {
      pose = { position: { x: 10.25, z: 0 }, tangent: { x: 0, z: -1 }, size: [1, 1] };
      bucket = "eliminated";
    } else if (racer.finished) {
      pose = { position: { x: -8.7, z: 1.25 }, tangent: { x: -1, z: 0 }, size: [1, 1] };
      bucket = "finished";
    } else {
      pose = trackPose(racer.position, finishLine);
      bucket = `track:${Math.max(0, Math.min(racer.position, finishLine))}`;
    }
    const slotIndex = occupied.get(bucket) ?? 0;
    occupied.set(bucket, slotIndex + 1);
    const offset = slotWorldPosition(pose, slotIndex);
    const world = racer.finished
      ? { x: pose.position.x + slotIndex * 0.72, z: pose.position.z }
      : racer.eliminated
        ? { x: pose.position.x, z: pose.position.z + (slotIndex - (sorted.length - 1) / 2) * 0.72 }
        : offset;
    return { ...racer, slotIndex, world, tangent: pose.tangent };
  });
}

export function pathBetween(from: number, to: number): number[] {
  if (from === to) return [];
  const direction = to > from ? 1 : -1;
  const path: number[] = [];
  for (let step = from + direction; direction > 0 ? step <= to : step >= to; step += direction) path.push(step);
  return path;
}
