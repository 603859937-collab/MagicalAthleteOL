import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { MathUtils, Plane, Quaternion, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createDiceLifecycle, syncDiceLifecycle, takeDiceResetValue } from "../../diceLifecycle";
import { targetQuaternion, throwVector } from "../../diceOrientation";
import { BOARD_SIZE } from "./trackLayout";
import { actionId } from "../../gameClient";

export type DiceThrowState = "ready" | "dragging" | "rolling" | "settling" | "settled";
export type DiceLauncher = () => boolean;

export interface TableDiceProps {
  enabled: boolean;
  targetValue: number | null;
  restingValue: number;
  rollKey: string;
  autoThrow: boolean;
  resetKey: number;
  reducedMotion: boolean;
  onThrow: (throwId: string) => void;
  onSettled: () => void;
  onStateChange: (state: DiceThrowState) => void;
  registerLauncher: (launch: DiceLauncher | null) => void;
}

const DIE_SIZE = 1.02;
const READY_POSITION = { x: 0, y: 1.05, z: BOARD_SIZE.depth / 2 - 0.34 } as const;
const DRAG_PLANE = new Plane(new Vector3(0, 1, 0), -READY_POSITION.y);
const MIN_INWARD_DRAG = 0.3;

const pipLayouts: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-0.3, 0.3], [0.3, -0.3]],
  3: [[-0.3, 0.3], [0, 0], [0.3, -0.3]],
  4: [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]],
  5: [[-0.3, -0.3], [-0.3, 0.3], [0, 0], [0.3, -0.3], [0.3, 0.3]],
  6: [[-0.3, -0.38], [-0.3, 0], [-0.3, 0.38], [0.3, -0.38], [0.3, 0], [0.3, 0.38]],
};

function Pips({ value, face }: { value: number; face: "top" | "bottom" | "front" | "back" | "right" | "left" }) {
  const surface = DIE_SIZE / 2 + 0.006;
  const pipScale = DIE_SIZE / 1.4;
  return <>{pipLayouts[value].map(([rawA, rawB], index) => {
    const a = rawA * pipScale;
    const b = rawB * pipScale;
    let position: [number, number, number] = [a, b, surface];
    let rotation: [number, number, number] = [0, 0, 0];
    if (face === "top") { position = [a, surface, b]; rotation = [-Math.PI / 2, 0, 0]; }
    if (face === "bottom") { position = [a, -surface, b]; rotation = [Math.PI / 2, 0, 0]; }
    if (face === "back") { position = [-a, b, -surface]; rotation = [0, Math.PI, 0]; }
    if (face === "right") { position = [surface, b, -a]; rotation = [0, Math.PI / 2, 0]; }
    if (face === "left") { position = [-surface, b, a]; rotation = [0, -Math.PI / 2, 0]; }
    return <mesh key={index} position={position} rotation={rotation}>
      <circleGeometry args={[0.075, 18]} />
      <meshStandardMaterial color="#171719" roughness={0.72} />
    </mesh>;
  })}</>;
}

export function inwardThrowVelocity(from: { x: number; z: number }, to: { x: number; z: number }) {
  const dx = to.x - from.x;
  const inward = Math.max(MIN_INWARD_DRAG, from.z - to.z);
  const strength = MathUtils.clamp(Math.hypot(dx, inward), MIN_INWARD_DRAG, 4.5);
  return {
    x: MathUtils.clamp(dx * 2.5, -5.5, 5.5),
    y: 3.8 + strength * 0.85,
    z: -4.4 - strength * 2.1,
  };
}

export function isInwardDiceDrag(from: { z: number }, to: { z: number }) {
  return from.z - to.z >= MIN_INWARD_DRAG;
}

export function TableDice(props: TableDiceProps) {
  const body = useRef<RapierRigidBody>(null);
  const state = useRef<DiceThrowState>("ready");
  const drag = useRef({ pointerId: -1, start: new Vector3(), current: new Vector3() });
  const rollingSince = useRef(0);
  const settleSince = useRef(0);
  const settleStart = useRef(new Quaternion());
  const settlePosition = useRef(new Vector3());
  const launchedRollKey = useRef<string | null>(null);
  const lifecycle = useRef(createDiceLifecycle(props.targetValue, props.restingValue));
  const geometry = useMemo(() => new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 5, 0.12), []);

  const setState = useCallback((next: DiceThrowState) => {
    state.current = next;
    props.onStateChange(next);
  }, [props.onStateChange]);

  const reset = useCallback((value: number) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    rigidBody.setGravityScale(0, true);
    rigidBody.setTranslation(READY_POSITION, true);
    rigidBody.setRotation(targetQuaternion(value), true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    setState("ready");
  }, [setState]);

  const launch = useCallback((from: { x: number; z: number }, to: { x: number; z: number }) => {
    const rigidBody = body.current;
    if (!rigidBody || state.current === "rolling" || state.current === "settling") return false;
    const velocity = inwardThrowVelocity(from, to);
    rigidBody.setGravityScale(1, true);
    rigidBody.setLinvel(velocity, true);
    rigidBody.setAngvel({ x: 8 + Math.abs(velocity.z), y: 5 + velocity.x, z: 7 - velocity.x }, true);
    rollingSince.current = performance.now();
    setState("rolling");
    return true;
  }, [setState]);

  const launchFromKey = useCallback(() => {
    const [dragX, dragY] = throwVector(props.rollKey);
    const from = { x: READY_POSITION.x, z: READY_POSITION.z };
    const to = {
      x: MathUtils.clamp(dragX * 0.018, -2.4, 2.4),
      z: READY_POSITION.z + MathUtils.clamp(dragY * 0.018, -3.2, -0.8),
    };
    return launch(from, to);
  }, [launch, props.rollKey]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    const restingValueChanged = lifecycle.current.restingValue !== props.restingValue;
    syncDiceLifecycle(lifecycle.current, props.targetValue, props.restingValue);
    if (restingValueChanged && props.targetValue === null) reset(props.restingValue);
  }, [props.restingValue, props.targetValue, reset]);
  useEffect(() => {
    const value = takeDiceResetValue(lifecycle.current, props.resetKey);
    if (value !== undefined) reset(value);
  }, [props.resetKey, reset]);
  useEffect(() => {
    props.registerLauncher(launchFromKey);
    return () => props.registerLauncher(null);
  }, [launchFromKey, props.registerLauncher]);
  useEffect(() => {
    if (!props.autoThrow || launchedRollKey.current === props.rollKey) return;
    const frame = window.requestAnimationFrame(() => {
      if (launchFromKey()) launchedRollKey.current = props.rollKey;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [launchFromKey, props.autoThrow, props.rollKey]);
  useEffect(() => {
    if (props.targetValue === null || launchedRollKey.current === props.rollKey) return;
    if (launchFromKey()) launchedRollKey.current = props.rollKey;
  }, [launchFromKey, props.rollKey, props.targetValue]);

  useFrame(() => {
    const rigidBody = body.current;
    if (!rigidBody || lifecycle.current.targetValue === null || state.current !== "rolling") return;
    const elapsed = performance.now() - rollingSince.current;
    const translation = rigidBody.translation();
    const outOfBounds = Math.abs(translation.x) > 12.4 || Math.abs(translation.z) > 3.9 || translation.y < -1;
    if (!outOfBounds && elapsed < (props.reducedMotion ? 80 : 1050)) return;
    const current = rigidBody.rotation();
    settleStart.current.set(current.x, current.y, current.z, current.w);
    settlePosition.current.set(
      MathUtils.clamp(translation.x, -10.8, 10.8),
      0.79,
      MathUtils.clamp(translation.z, -2.45, 2.45),
    );
    settleSince.current = performance.now();
    rigidBody.setGravityScale(0, true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    setState("settling");
  });

  useFrame(() => {
    const rigidBody = body.current;
    const value = lifecycle.current.targetValue;
    if (!rigidBody || value === null || state.current !== "settling") return;
    const duration = props.reducedMotion ? 100 : 420;
    const progress = MathUtils.clamp((performance.now() - settleSince.current) / duration, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const rotation = settleStart.current.clone().slerp(targetQuaternion(value), eased);
    const translation = rigidBody.translation();
    rigidBody.setRotation(rotation, true);
    rigidBody.setTranslation({
      x: MathUtils.lerp(translation.x, settlePosition.current.x, 0.18),
      y: MathUtils.lerp(translation.y, settlePosition.current.y, 0.2),
      z: MathUtils.lerp(translation.z, settlePosition.current.z, 0.18),
    }, true);
    if (progress < 1) return;
    rigidBody.setTranslation(settlePosition.current, true);
    setState("settled");
    props.onSettled();
  });

  function pointOnDragPlane(event: ThreeEvent<PointerEvent>) {
    return event.ray.intersectPlane(DRAG_PLANE, new Vector3());
  }

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    if (!props.enabled || state.current !== "ready") return;
    const point = pointOnDragPlane(event);
    if (!point) return;
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, start: point.clone(), current: point.clone() };
    body.current?.setGravityScale(0, true);
    body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    setState("dragging");
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    if (state.current !== "dragging" || event.pointerId !== drag.current.pointerId || !body.current) return;
    const point = pointOnDragPlane(event);
    if (!point) return;
    event.stopPropagation();
    drag.current.current.copy(point);
    body.current.setTranslation({
      x: MathUtils.clamp(READY_POSITION.x + point.x - drag.current.start.x, -10.8, 10.8),
      y: READY_POSITION.y,
      z: MathUtils.clamp(READY_POSITION.z + point.z - drag.current.start.z, -2.6, READY_POSITION.z),
    }, true);
    body.current.setRotation(targetQuaternion((Math.floor(point.distanceTo(drag.current.start) * 2.5) % 6) + 1), true);
  }

  function handlePointerUp(event: ThreeEvent<PointerEvent>) {
    if (state.current !== "dragging" || event.pointerId !== drag.current.pointerId) return;
    event.stopPropagation();
    if (!isInwardDiceDrag(drag.current.start, drag.current.current)) {
      reset(lifecycle.current.restingValue);
      return;
    }
    const throwId = actionId();
    if (launch(drag.current.start, drag.current.current)) {
      launchedRollKey.current = `start-${throwId}`;
      props.onThrow(throwId);
    }
  }

  return <RigidBody ref={body} colliders="cuboid" restitution={0.62} friction={0.72}
    linearDamping={0.14} angularDamping={0.18} position={[READY_POSITION.x, READY_POSITION.y, READY_POSITION.z]}>
    <mesh geometry={geometry} castShadow receiveShadow
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
      <meshStandardMaterial color="#f7f2e7" roughness={0.5} metalness={0.02} />
      <Pips value={1} face="top" /><Pips value={6} face="bottom" />
      <Pips value={2} face="front" /><Pips value={5} face="back" />
      <Pips value={3} face="right" /><Pips value={4} face="left" />
    </mesh>
  </RigidBody>;
}
