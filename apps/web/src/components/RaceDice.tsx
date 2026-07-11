import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MathUtils, Quaternion, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

type ThrowState = "ready" | "dragging" | "rolling" | "settling" | "settled";

interface RaceDiceProps {
  enabled: boolean;
  targetValue: number | null;
  rollKey: string;
  autoThrow: boolean;
  resetKey: number;
  activePlayerName: string;
  onThrow: () => void;
  onSettled: () => void;
}

const pipLayouts: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-0.3, 0.3], [0.3, -0.3]],
  3: [[-0.3, 0.3], [0, 0], [0.3, -0.3]],
  4: [[-0.3, -0.3], [-0.3, 0.3], [0.3, -0.3], [0.3, 0.3]],
  5: [[-0.3, -0.3], [-0.3, 0.3], [0, 0], [0.3, -0.3], [0.3, 0.3]],
  6: [[-0.3, -0.38], [-0.3, 0], [-0.3, 0.38], [0.3, -0.38], [0.3, 0], [0.3, 0.38]],
};

function targetQuaternion(value: number): Quaternion {
  const quaternion = new Quaternion();
  if (value === 2) return quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  if (value === 3) return quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  if (value === 4) return quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
  if (value === 5) return quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
  if (value === 6) return quaternion.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
  return quaternion;
}

function Pips({ value, face }: { value: number; face: "top" | "bottom" | "front" | "back" | "right" | "left" }) {
  return <>{pipLayouts[value].map(([a, b], index) => {
    let position: [number, number, number] = [a, b, 0.706];
    let rotation: [number, number, number] = [0, 0, 0];
    if (face === "top") { position = [a, 0.706, b]; rotation = [-Math.PI / 2, 0, 0]; }
    if (face === "bottom") { position = [a, -0.706, b]; rotation = [Math.PI / 2, 0, 0]; }
    if (face === "back") { position = [-a, b, -0.706]; rotation = [0, Math.PI, 0]; }
    if (face === "right") { position = [0.706, b, -a]; rotation = [0, Math.PI / 2, 0]; }
    if (face === "left") { position = [-0.706, b, a]; rotation = [0, -Math.PI / 2, 0]; }
    return <mesh key={index} position={position} rotation={rotation}>
      <circleGeometry args={[0.105, 20]} />
      <meshStandardMaterial color="#171719" roughness={0.72} />
    </mesh>;
  })}</>;
}

function DiceBody({ enabled, targetValue, rollKey, autoThrow, resetKey, onThrow, onSettled, onStateChange, manualThrowKey }: Omit<RaceDiceProps, "activePlayerName"> & { onStateChange: (state: ThrowState) => void; manualThrowKey: number }) {
  const body = useRef<RapierRigidBody>(null);
  const pointer = useRef({ id: -1, x: 0, y: 0, lastX: 0, lastY: 0, time: 0 });
  const rollingSince = useRef(0);
  const settleSince = useRef(0);
  const settleStart = useRef(new Quaternion());
  const lastSettledValue = useRef(1);
  const target = useRef<number | null>(targetValue);
  const state = useRef<ThrowState>("ready");
  const geometry = useMemo(() => new RoundedBoxGeometry(1.4, 1.4, 1.4, 5, 0.16), []);

  const setState = useCallback((next: ThrowState) => {
    state.current = next;
    onStateChange(next);
  }, [onStateChange]);

  const reset = useCallback(() => {
    const rigidBody = body.current;
    if (!rigidBody) return;
    rigidBody.setGravityScale(1, true);
    rigidBody.setTranslation({ x: 0, y: 0.86, z: 1.15 }, true);
    rigidBody.setRotation(targetQuaternion(lastSettledValue.current), true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    target.current = null;
    setState("ready");
  }, [setState]);

  const launch = useCallback((dragX = 0, dragY = -80) => {
    const rigidBody = body.current;
    if (!rigidBody || state.current === "rolling" || state.current === "settling") return;
    const strength = MathUtils.clamp(Math.hypot(dragX, dragY), 45, 220);
    rigidBody.setGravityScale(1, true);
    rigidBody.setTranslation({ x: MathUtils.clamp(dragX * 0.006, -0.9, 0.9), y: 1.15, z: 1.55 }, true);
    rigidBody.setLinvel({
      x: MathUtils.clamp(dragX * 0.018, -3.2, 3.2),
      y: 3.8 + strength * 0.012,
      z: -4.8 - strength * 0.012,
    }, true);
    rigidBody.setAngvel({
      x: 7 + Math.abs(dragY) * 0.035,
      y: 5 + dragX * 0.035,
      z: 6 - dragX * 0.025,
    }, true);
    rollingSince.current = performance.now();
    setState("rolling");
  }, [setState]);

  useEffect(() => { target.current = targetValue; }, [targetValue]);
  useEffect(() => { reset(); }, [reset, resetKey]);
  useEffect(() => {
    if (autoThrow) launch((Math.random() - 0.5) * 100, -70 - Math.random() * 90);
  }, [autoThrow, launch, rollKey, targetValue]);
  const lastManualThrow = useRef(manualThrowKey);
  useEffect(() => {
    if (manualThrowKey === lastManualThrow.current) return;
    lastManualThrow.current = manualThrowKey;
    launch(0, -105);
  }, [launch, manualThrowKey]);

  useFrame(() => {
    const rigidBody = body.current;
    if (!rigidBody || target.current === null || state.current !== "rolling") return;
    if (performance.now() - rollingSince.current < 850) return;
    const current = rigidBody.rotation();
    settleStart.current.set(current.x, current.y, current.z, current.w);
    settleSince.current = performance.now();
    rigidBody.setGravityScale(0, true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    setState("settling");
  });

  useFrame(() => {
    const rigidBody = body.current;
    if (!rigidBody || target.current === null || state.current !== "settling") return;
    const progress = MathUtils.clamp((performance.now() - settleSince.current) / 420, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const rotation = settleStart.current.clone().slerp(targetQuaternion(target.current), eased);
    const translation = rigidBody.translation();
    rigidBody.setRotation(rotation, true);
    rigidBody.setTranslation({
      x: MathUtils.lerp(translation.x, 0, 0.12),
      y: MathUtils.lerp(translation.y, 0.74, 0.16),
      z: MathUtils.lerp(translation.z, 0, 0.12),
    }, true);
    if (progress < 1) return;
    rigidBody.setTranslation({ x: 0, y: 0.72, z: 0 }, true);
    lastSettledValue.current = target.current;
    setState("settled");
    onSettled();
  });

  function handlePointerDown(event: ThreeEvent<PointerEvent>) {
    if (!enabled || state.current !== "ready") return;
    event.stopPropagation();
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, time: performance.now() };
    body.current?.setGravityScale(0, true);
    body.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    setState("dragging");
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ThreeEvent<PointerEvent>) {
    if (state.current !== "dragging" || event.pointerId !== pointer.current.id || !body.current) return;
    event.stopPropagation();
    pointer.current.lastX = event.clientX;
    pointer.current.lastY = event.clientY;
    const dx = event.clientX - pointer.current.x;
    const dy = event.clientY - pointer.current.y;
    body.current.setTranslation({
      x: MathUtils.clamp(dx * 0.009, -1.4, 1.4),
      y: 1.05 + MathUtils.clamp(-dy * 0.006, -0.2, 1.1),
      z: 1.15 + MathUtils.clamp(dy * 0.006, -0.7, 0.8),
    }, true);
    body.current.setRotation(targetQuaternion(((Math.floor(Math.abs(dx + dy) / 35) % 6) + 1)), true);
  }

  function handlePointerUp(event: ThreeEvent<PointerEvent>) {
    if (state.current !== "dragging" || event.pointerId !== pointer.current.id) return;
    event.stopPropagation();
    const dx = event.clientX - pointer.current.x;
    const dy = event.clientY - pointer.current.y;
    launch(dx, dy);
    onThrow();
  }

  return <RigidBody ref={body} colliders="cuboid" restitution={0.58} friction={0.72} linearDamping={0.15} angularDamping={0.18} position={[0, 0.86, 1.15]}>
    <mesh geometry={geometry} castShadow receiveShadow onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>
      <meshStandardMaterial color="#f7f2e7" roughness={0.52} metalness={0.02} />
      <Pips value={1} face="top" /><Pips value={6} face="bottom" />
      <Pips value={2} face="front" /><Pips value={5} face="back" />
      <Pips value={3} face="right" /><Pips value={4} face="left" />
    </mesh>
  </RigidBody>;
}

function DiceScene(props: RaceDiceProps & { onStateChange: (state: ThrowState) => void; manualThrowKey: number }) {
  return <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 4.5, 6.8], fov: 36 }} gl={{ antialias: true, alpha: false }}>
    <color attach="background" args={["#1d1d20"]} />
    <ambientLight intensity={1.4} />
    <directionalLight castShadow position={[-3, 7, 4]} intensity={3.2} shadow-mapSize={[1024, 1024]} />
    <pointLight position={[4, 3, 2]} intensity={12} color="#f2bd27" distance={10} />
    <Physics gravity={[0, -12, 0]}>
      <DiceBody {...props} />
      <RigidBody type="fixed" restitution={0.35} friction={0.9}>
        <mesh receiveShadow position={[0, -0.16, 0]}>
          <boxGeometry args={[7, 0.3, 5.4]} />
          <meshStandardMaterial color="#287fc2" roughness={0.82} />
        </mesh>
        <CuboidCollider args={[3.5, 0.15, 2.7]} position={[0, -0.16, 0]} />
        <CuboidCollider args={[3.5, 1, 0.12]} position={[0, 0.65, -2.7]} />
        <CuboidCollider args={[0.12, 1, 2.7]} position={[-3.5, 0.65, 0]} />
        <CuboidCollider args={[0.12, 1, 2.7]} position={[3.5, 0.65, 0]} />
      </RigidBody>
    </Physics>
  </Canvas>;
}

export function RaceDice(props: RaceDiceProps) {
  const [throwState, setThrowState] = useState<ThrowState>("ready");
  const [manualThrowKey, setManualThrowKey] = useState(0);
  const [webglAvailable] = useState(() => {
    try {
      const canvas = document.createElement("canvas");
      return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch { return false; }
  });
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  useEffect(() => {
    if (webglAvailable && !reducedMotion || props.targetValue === null) return;
    const timer = window.setTimeout(props.onSettled, 450);
    return () => window.clearTimeout(timer);
  }, [props.onSettled, props.rollKey, props.targetValue, reducedMotion, webglAvailable]);

  if (!webglAvailable || reducedMotion) {
    return <div className="dice-fallback" aria-label="比赛骰子">
      <div className={props.targetValue ? "fallback-die landed" : "fallback-die"}>{props.targetValue ?? "?"}</div>
      <button className="command dice-throw-button" disabled={!props.enabled} onClick={props.onThrow}>掷骰</button>
    </div>;
  }

  const status = throwState === "settled" && props.targetValue ? `掷出 ${props.targetValue}`
    : throwState === "rolling" || throwState === "settling" ? `${props.activePlayerName} 投掷中`
      : props.enabled ? "轮到你" : `等待 ${props.activePlayerName}`;

  return <section className={`race-dice ${props.enabled ? "enabled" : ""}`} aria-label="3D 比赛骰子">
    <DiceScene {...props} onStateChange={setThrowState} manualThrowKey={manualThrowKey} />
    <div className="dice-hud" aria-live="polite"><strong>{status}</strong>
      <button className="dice-throw-button" disabled={!props.enabled || throwState !== "ready"} onClick={() => {
        setManualThrowKey((value) => value + 1);
        props.onThrow();
      }}>掷骰</button>
    </div>
  </section>;
}
