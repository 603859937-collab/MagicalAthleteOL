import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";
import type { TableDiceProps } from "./TableDice";

const physics = vi.hoisted(() => ({
  frames: new Map<(state: unknown, delta: number) => void, number>(),
  body: {
    translation: () => ({ x: 0, y: 1, z: 2 }), rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    linvel: () => ({ x: 0, y: 0, z: 0 }), setTranslation: vi.fn(), setNextKinematicTranslation: vi.fn(),
    setRotation: vi.fn(), setLinvel: vi.fn(), setAngvel: vi.fn(), setAngularDamping: vi.fn(), setGravityScale: vi.fn(),
  },
}));
vi.mock("@react-three/fiber", async () => {
  const { useEffect } = await import("react");
  return { useFrame: (callback: (state: unknown, delta: number) => void, priority = 0) => {
    useEffect(() => {
      physics.frames.set(callback, priority);
      return () => { physics.frames.delete(callback); };
    }, [callback, priority]);
  } };
});
vi.mock("@react-three/rapier", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    RigidBody: forwardRef((_props, ref) => { useImperativeHandle(ref, () => physics.body); return null; }),
    useRapier: () => ({ world: {}, rapier: {} }), useBeforePhysicsStep: () => {},
  };
});
vi.mock("../../gameAudio", () => ({ playDiceImpactSound: vi.fn() }));
import { TableDice } from "./TableDice";

let view: ReactTestRenderer;
let props: TableDiceProps;
let camera: PerspectiveCamera;
function tick(count: number, moving = false) {
  act(() => {
    for (let i = 0; i < count; i++) {
      if (moving) camera.position.x += 0.1;
      for (const [callback] of [...physics.frames].sort((a, b) => a[1] - b[1])) callback({ camera }, 1 / 60);
    }
  });
}
const launches = () => physics.body.setLinvel.mock.calls.filter(([velocity]) => velocity.y > 0);
beforeEach(() => {
  vi.clearAllMocks();
  camera = new PerspectiveCamera();
  props = { turnKey: "bot-1", enabled: false, targetValue: 4, restingValue: 1,
    rollKey: "roll-1", autoThrow: true, resetKey: 0, reducedMotion: false,
    onThrow: vi.fn(), onSettled: vi.fn(), onStateChange: vi.fn(), registerLauncher: vi.fn() };
  act(() => { view = create(<TableDice {...props} />); });
});
afterEach(() => { act(() => view.unmount()); });

it("waits for the moving camera and hand placement before launching a remote result", () => {
  tick(30, true);
  expect(launches()).toHaveLength(0);
  tick(15);
  expect(launches()).toHaveLength(0);
  tick(60);
  expect(launches()).toHaveLength(1);
  expect(props.onStateChange).toHaveBeenCalledWith("preparing");
  expect(props.onStateChange).toHaveBeenCalledWith("ready");
  expect(props.onStateChange).toHaveBeenLastCalledWith("rolling");
  tick(30);
  expect(launches()).toHaveLength(1);
});
