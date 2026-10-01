import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { RigidBody, useBeforePhysicsStep, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { MathUtils, Plane, Quaternion, Raycaster, Vector2, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { createDiceLifecycle, syncDiceLifecycle, takeDiceResetValue } from "../../diceLifecycle";
import { targetQuaternion, throwVector } from "../../diceOrientation";
import { BOARD_SIZE } from "./trackLayout";
import { actionId } from "../../gameClient";
import { playDiceImpactSound } from "../../gameAudio";

export type DiceThrowState = "preparing" | "ready" | "dragging" | "rolling" | "settling" | "settled";
export type DiceLauncher = (throwId: string) => boolean;

export interface TableDiceProps {
  turnKey?: string;
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
  const handPosition = useRef(new Vector3(READY_POSITION.x, READY_POSITION.y, READY_POSITION.z));
  const preparedTurn = useRef<string>();
  const preparation = useRef({ elapsed: 0, stable: 0, progress: 0, captured: false,
    cameraPosition: new Vector3(), cameraRotation: new Quaternion(), from: new Vector3(), to: new Vector3() });
  const placementRay = useMemo(() => new Raycaster(), []);
  const grip = useRef<RapierRigidBody>(null);
  const { world, rapier } = useRapier();
  const gripJoint = useRef<ReturnType<typeof world.createImpulseJoint> | null>(null);
  const gripStart = useRef(new Vector3());
  const gripTarget = useRef(new Vector3());
  const releaseGrip = useCallback(() => {
    if (gripJoint.current?.isValid()) world.removeImpulseJoint(gripJoint.current, true);
    gripJoint.current = null;
  }, [world]);
  const state = useRef<DiceThrowState>("ready");
  const drag = useRef({ pointerId: -1, start: new Vector3(), current: new Vector3() });
  const rollingSince = useRef(0);
  const impactPlayed = useRef(false);
  const fallingSpeed = useRef(0);
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

  const reset = useCallback((value: number, returnToHand = false) => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    releaseGrip();
    rigidBody.setAngularDamping(0.18);
    rigidBody.setGravityScale(0, true);
    if (returnToHand) rigidBody.setTranslation(handPosition.current, true);
    rigidBody.setRotation(targetQuaternion(value), true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    setState(returnToHand || props.turnKey === preparedTurn.current && !!props.turnKey ? "ready" : "settled");
  }, [releaseGrip, setState, props.turnKey]);

  const launch = useCallback((from: { x: number; z: number }, to: { x: number; z: number }) => {
    const rigidBody = body.current;
    if (!rigidBody || state.current === "rolling" || state.current === "settling") return false;
    const wasDragging = state.current === "dragging";
    const swingVelocity = rigidBody.linvel();
    const velocity = inwardThrowVelocity(from, to);
    releaseGrip();
    if (wasDragging) {
      velocity.x += MathUtils.clamp(swingVelocity.x, -3, 3);
      velocity.y += MathUtils.clamp(swingVelocity.y, -2, 2);
      velocity.z += MathUtils.clamp(swingVelocity.z, -3, 3);
    }
    rigidBody.setAngularDamping(0.18);
    rigidBody.setGravityScale(1, true);
    rigidBody.setLinvel(velocity, true);
    if (!wasDragging) rigidBody.setAngvel({ x: 8 + Math.abs(velocity.z), y: 5 + velocity.x, z: 7 - velocity.x }, true);
    rollingSince.current = performance.now();
    impactPlayed.current = false;
    fallingSpeed.current = 0;
    setState("rolling");
    return true;
  }, [releaseGrip, setState]);

  const launchFromKey = useCallback(() => {
    const [dragX, dragY] = throwVector(props.rollKey);
    const from = body.current?.translation() ?? handPosition.current;
    const to = {
      x: from.x + MathUtils.clamp(dragX * 0.018, -2.4, 2.4),
      z: from.z + MathUtils.clamp(dragY * 0.018, -3.2, -0.8),
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
    props.registerLauncher((throwId) => {
      if (!launchFromKey()) return false;
      launchedRollKey.current = `start-${throwId}`;
      return true;
    });
    return () => props.registerLauncher(null);
  }, [launchFromKey, props.registerLauncher]);

  useEffect(() => {
    if (!props.enabled && state.current === "dragging") reset(lifecycle.current.restingValue, true);
  }, [props.enabled, reset]);

  useEffect(() => {
    if (!props.turnKey || props.turnKey === preparedTurn.current) return;
    if (launchedRollKey.current === props.rollKey && props.targetValue !== null) return;
    preparedTurn.current = props.turnKey;
    preparation.current.elapsed = 0;
    preparation.current.stable = 0;
    preparation.current.progress = 0;
    preparation.current.captured = false;
    setState("preparing");
  }, [props.turnKey, props.rollKey, props.targetValue, setState]);

  useFrame(({ camera }, delta) => {
    const rigidBody = body.current;
    if (!rigidBody || state.current !== "preparing") return;
    if (!props.turnKey) {
      setState("settled");
      return;
    }
    const prep = preparation.current;
    if (!prep.captured) {
      // Wait for the character camera to arrive, then choose one fixed destination.
      prep.elapsed += delta;
      const still = prep.cameraPosition.distanceToSquared(camera.position) < 0.0001
        && prep.cameraRotation.angleTo(camera.quaternion) < 0.001;
      prep.stable = still ? prep.stable + delta : 0;
      prep.cameraPosition.copy(camera.position);
      prep.cameraRotation.copy(camera.quaternion);
      if (!props.reducedMotion && prep.stable < 0.15 && prep.elapsed < 2.5) return;
      placementRay.setFromCamera(new Vector2(0, -0.42), camera);
      if (!placementRay.ray.intersectPlane(DRAG_PLANE, prep.to)) prep.to.copy(handPosition.current);
      handPosition.current.copy(prep.to);
      prep.from.copy(rigidBody.translation());
      prep.captured = true;
      rigidBody.setGravityScale(0, true);
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    prep.progress = Math.min(1, prep.progress + delta / (props.reducedMotion ? 0.1 : 0.55));
    const eased = prep.progress * prep.progress * (3 - 2 * prep.progress);
    rigidBody.setTranslation(new Vector3().lerpVectors(prep.from, prep.to, eased), true);
    if (prep.progress === 1) setState("ready");
  }, -1);

  useFrame(() => {
    // Remote throws must wait for both the camera and the die's hand placement.
    // Retry every frame so an early result cannot launch midway through preparation.
    if ((!props.autoThrow && props.targetValue === null) || launchedRollKey.current === props.rollKey) return;
    if (state.current !== "ready" && state.current !== "settled") return;
    if (props.turnKey && preparedTurn.current !== props.turnKey) return;
    if (launchFromKey()) launchedRollKey.current = props.rollKey;
  });

  useBeforePhysicsStep(() => {
    fallingSpeed.current = body.current?.linvel().y ?? 0;
    if (state.current !== "dragging" || !grip.current) return;
    // Move the hand, leaving gravity and the corner joint to rotate the die.
    const position = new Vector3().copy(grip.current.translation());
    position.lerp(gripTarget.current, 1 - Math.exp(-8 * world.timestep));
    grip.current.setNextKinematicTranslation(position);
  });

  useFrame(() => {
    const rigidBody = body.current;
    if (!rigidBody || lifecycle.current.targetValue === null || state.current !== "rolling") return;
    const elapsed = performance.now() - rollingSince.current;
    const translation = rigidBody.translation();
    const outOfBounds = elapsed > 600 && (Math.abs(translation.x) > 12.4 || Math.abs(translation.z) > 3.9 || translation.y < -1);
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
    if (!props.enabled || state.current !== "ready" || !body.current || !grip.current) return;
    const point = pointOnDragPlane(event);
    if (!point) return;
    event.stopPropagation();
    drag.current = { pointerId: event.pointerId, start: point.clone(), current: point.clone() };
    const rotation = new Quaternion().copy(body.current.rotation());
    const center = new Vector3().copy(body.current.translation());
    const localHit = event.point.clone().sub(center).applyQuaternion(rotation.clone().invert());
    // Rounded geometry: keep the attachment slightly inside the nearest corner.
    const cornerCoordinate = (value: number) => (value < 0 ? -1 : 1) * (DIE_SIZE / 2 - 0.07);
    const corner = new Vector3(cornerCoordinate(localHit.x), cornerCoordinate(localHit.y), cornerCoordinate(localHit.z));
    gripStart.current.copy(corner).applyQuaternion(rotation).add(center);
    gripTarget.current.copy(gripStart.current);
    gripTarget.current.y = Math.max(2.5, gripStart.current.y + 1);
    grip.current.setTranslation(gripStart.current, true);
    grip.current.setNextKinematicTranslation(gripStart.current);
    releaseGrip();
    gripJoint.current = world.createImpulseJoint(
      rapier.JointData.spherical({ x: 0, y: 0, z: 0 }, corner), grip.current, body.current, true,
    );
    body.current.setAngularDamping(props.reducedMotion ? 5 : 1.8);
    body.current.setGravityScale(1, true);
    setState("dragging");
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    if (state.current !== "dragging" || event.pointerId !== drag.current.pointerId || !body.current) return;
    const point = pointOnDragPlane(event);
    if (!point) return;
    event.stopPropagation();
    drag.current.current.copy(point);
    gripTarget.current.x = MathUtils.clamp(gripStart.current.x + point.x - drag.current.start.x, -10.8, 10.8);
    gripTarget.current.z = MathUtils.clamp(gripStart.current.z + point.z - drag.current.start.z, -2.6, Math.max(gripStart.current.z, READY_POSITION.z));
  }

  function handlePointerUp(event: ThreeEvent<PointerEvent>) {
    if (state.current !== "dragging" || event.pointerId !== drag.current.pointerId) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    if (!isInwardDiceDrag(drag.current.start, drag.current.current)) {
      reset(lifecycle.current.restingValue, true);
      return;
    }
    const throwId = actionId();
    if (launch(drag.current.start, drag.current.current)) {
      launchedRollKey.current = `start-${throwId}`;
      props.onThrow(throwId);
    }
  }

  function cancelDrag() {
    if (state.current === "dragging") reset(lifecycle.current.restingValue, true);
  }

  return <>
    <RigidBody ref={grip} type="kinematicPosition" colliders={false} />
    <RigidBody ref={body} additionalSolverIterations={8} colliders="cuboid" restitution={0.62} friction={0.72}
    onCollisionEnter={({ other, manifold }) => {
      if (state.current !== "rolling" || impactPlayed.current || fallingSpeed.current > -0.5
        || !other.rigidBody?.isFixed() || Math.abs(manifold.normal().y) < 0.5) return;
      impactPlayed.current = true;
      playDiceImpactSound();
    }}
    linearDamping={0.14} angularDamping={0.18} position={[READY_POSITION.x, READY_POSITION.y, READY_POSITION.z]}>
    <mesh geometry={geometry} castShadow receiveShadow
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
      onPointerCancel={cancelDrag}>
      <meshStandardMaterial color="#f7f2e7" roughness={0.5} metalness={0.02} />
      <Pips value={1} face="top" /><Pips value={6} face="bottom" />
      <Pips value={2} face="front" /><Pips value={5} face="back" />
      <Pips value={3} face="right" /><Pips value={4} face="left" />
    </mesh>
  </RigidBody></>;
}
