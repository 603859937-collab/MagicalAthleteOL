import { Quaternion, Vector3 } from "three";

export const DICE_FACE_NORMALS: Record<number, Vector3> = {
  1: new Vector3(0, 1, 0),
  2: new Vector3(0, 0, 1),
  3: new Vector3(1, 0, 0),
  4: new Vector3(-1, 0, 0),
  5: new Vector3(0, 0, -1),
  6: new Vector3(0, -1, 0),
};

const UP = new Vector3(0, 1, 0);

export function targetQuaternion(value: number): Quaternion {
  const faceNormal = DICE_FACE_NORMALS[value] ?? DICE_FACE_NORMALS[1];
  return new Quaternion().setFromUnitVectors(faceNormal, UP);
}

export function throwVector(key: string): [number, number] {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const horizontal = ((hash >>> 0) / 0xffffffff - 0.5) * 100;
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  const vertical = -70 - ((hash >>> 0) / 0xffffffff) * 90;
  return [horizontal, vertical];
}
