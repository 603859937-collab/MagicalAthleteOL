import { Canvas, useThree } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody } from "@react-three/rapier";
import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CanvasTexture, DoubleSide, SRGBColorSpace, TextureLoader } from "three";
import type { PlayerState } from "../../protocol";
import { assignRacerPlacements, BOARD_SIZE, TRACK_LENGTH, trackPose } from "./trackLayout";

interface RaceTableSceneProps {
  players: PlayerState[];
  finishLine: number;
  trackName: "Standard" | "WildWilds";
}

const TILE_COLORS = ["#b652a1", "#efbd25", "#39804a", "#4a83c5", "#e34a32"];
const PLAYER_COLORS = ["#e8422e", "#4386c6", "#efbd25", "#43a45c", "#d45f9d", "#855ab0"];
const WILD_TILES: Record<number, { label: string; color: string }> = {
  1: { label: "1", color: "#efbd25" }, 5: { label: "!", color: "#e4482c" },
  7: { label: "+3", color: "#4f7fb9" }, 11: { label: "+1", color: "#4f7fb9" },
  13: { label: "1", color: "#efbd25" }, 16: { label: "-4", color: "#4f7fb9" },
  17: { label: "!", color: "#e4482c" }, 23: { label: "+2", color: "#4f7fb9" },
  24: { label: "-2", color: "#4f7fb9" }, 26: { label: "!", color: "#e4482c" },
};

function FixedCameraRig() {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    const distance = aspect < 1.2 ? 32 : aspect < 1.7 ? 23 : 19;
    camera.position.set(0, distance, distance * 0.92);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);
  return null;
}

function useLabelTexture(label: string, color = "#171719", fontSize = 72, background = "") {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (background) {
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.fillStyle = color;
      context.font = `900 ${fontSize}px "Arial Black", "PingFang SC", Arial`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, canvas.width / 2, canvas.height / 2);
    }
    const next = new CanvasTexture(canvas);
    next.colorSpace = SRGBColorSpace;
    return next;
  }, [background, color, fontSize, label]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function TrackTile({ step, wild }: { step: number; wild: boolean }) {
  const pose = trackPose(step);
  const feature = wild ? WILD_TILES[step] : undefined;
  const label = feature?.label ?? (!wild && step < TRACK_LENGTH && step % 5 === 0 ? String(step) : "");
  const texture = useLabelTexture(label, "#171719", feature ? 108 : 116);
  return <group position={[pose.position.x, 0.34, pose.position.z]}>
    <mesh castShadow receiveShadow>
      <boxGeometry args={[pose.size[0], 0.2, pose.size[1]]} />
      <meshStandardMaterial color={feature?.color ?? TILE_COLORS[(step - 1) % TILE_COLORS.length]} roughness={0.72} />
    </mesh>
    {label && <mesh position={[0, 0.106, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[Math.min(1.12, pose.size[0] * 0.86), 0.56]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>}
  </group>;
}

function ThemeTitle({ text }: { text: string }) {
  const texture = useLabelTexture(text, "#f8f7f1", 76);
  return <mesh position={[0, 0.39, 0]} rotation={[-Math.PI / 2, 0, 0]}>
    <planeGeometry args={[9.5, 2.35]} />
    <meshBasicMaterial map={texture} transparent depthWrite={false} />
  </mesh>;
}

function Flower({ x, z, color, scale = 1 }: { x: number; z: number; color: string; scale?: number }) {
  return <group position={[x, 0.4, z]} scale={scale}>
    <mesh position={[0, 0.35, 0]}><cylinderGeometry args={[0.035, 0.045, 0.7, 10]} /><meshStandardMaterial color="#3c944b" /></mesh>
    {Array.from({ length: 6 }, (_, index) => {
      const angle = index * Math.PI / 3;
      return <mesh key={index} position={[Math.cos(angle) * 0.2, 0.76, Math.sin(angle) * 0.2]} castShadow>
        <sphereGeometry args={[0.16, 12, 8]} /><meshStandardMaterial color={color} roughness={0.72} />
      </mesh>;
    })}
    <mesh position={[0, 0.77, 0]}><sphereGeometry args={[0.12, 12, 8]} /><meshStandardMaterial color="#efbd25" /></mesh>
  </group>;
}

function Pine({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return <group position={[x, 0.35, z]} scale={scale}>
    <mesh position={[0, 0.38, 0]}><cylinderGeometry args={[0.09, 0.13, 0.76, 8]} /><meshStandardMaterial color="#755133" /></mesh>
    <mesh position={[0, 0.76, 0]} castShadow><coneGeometry args={[0.48, 0.9, 10]} /><meshStandardMaterial color="#247044" roughness={0.86} /></mesh>
    <mesh position={[0, 1.12, 0]} castShadow><coneGeometry args={[0.36, 0.74, 10]} /><meshStandardMaterial color="#318452" roughness={0.86} /></mesh>
  </group>;
}

function CenterTheme({ wild }: { wild: boolean }) {
  return <group>
    <mesh position={[0, 0.255, 0]} receiveShadow>
      <boxGeometry args={[12.2, 0.06, 3.75]} />
      <meshStandardMaterial color="#161619" roughness={0.9} />
    </mesh>
    <mesh position={[0, 0.292, 0]} receiveShadow>
      <boxGeometry args={[11.75, 0.025, 3.28]} />
      <meshStandardMaterial color={wild ? "#563071" : "#5eaa62"} roughness={0.92} />
    </mesh>
    <ThemeTitle text={wild ? "WILD WILDS" : "MILD MILE"} />
    {wild ? <>
      <Pine x={-4.8} z={0.7} scale={0.92} /><Pine x={-4} z={0.48} scale={0.7} />
      <Pine x={4.65} z={0.6} scale={0.95} /><Pine x={3.85} z={0.45} scale={0.68} />
      <mesh position={[-4.35, 0.43, -0.75]} castShadow><dodecahedronGeometry args={[0.35]} /><meshStandardMaterial color="#a7a49b" roughness={1} /></mesh>
      <group position={[4.5, 0.32, -0.78]}>
        <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.1, 0.14, 0.5, 12]} /><meshStandardMaterial color="#eee4cb" /></mesh>
        <mesh position={[0, 0.55, 0]} castShadow><sphereGeometry args={[0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#e34832" /></mesh>
      </group>
    </> : <>
      <Flower x={-4.75} z={0.45} color="#d45f9d" scale={0.85} />
      <Flower x={4.75} z={0.45} color="#e34832" scale={0.9} />
      <Flower x={-4.1} z={-0.65} color="#f7f4e9" scale={0.62} />
      <mesh position={[-4.8, 0.47, -0.7]} castShadow><sphereGeometry args={[0.5, 16, 10]} /><meshStandardMaterial color="#4386c6" roughness={0.84} /></mesh>
      <mesh position={[4.15, 0.43, -0.72]} castShadow><sphereGeometry args={[0.42, 16, 10]} /><meshStandardMaterial color="#efbd25" roughness={0.84} /></mesh>
    </>}
  </group>;
}

function StartAndFinish() {
  const startTexture = useLabelTexture("起点", "#e34832", 108);
  const finishTexture = useLabelTexture("终点  FINISH", "#f8f7f1", 82, "#e34832");
  return <group>
    <mesh position={[-10.45, 0.33, -3.25]} receiveShadow>
      <boxGeometry args={[1.35, 0.18, 1.45]} /><meshStandardMaterial color="#4a83c5" roughness={0.78} />
    </mesh>
    <mesh position={[-10.45, 0.43, -3.25]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.28, 0.58]} /><meshBasicMaterial map={startTexture} transparent depthWrite={false} />
    </mesh>
    {[-0.34, 0.34].flatMap((xOffset) => [-0.34, 0.34].map((zOffset, index) => <mesh key={`${xOffset}:${zOffset}`} position={[-10.45 + xOffset, 0.43, 3.25 + zOffset]}>
      <boxGeometry args={[0.67, 0.2, 0.72]} /><meshStandardMaterial color={(xOffset > 0) === (index > 0) ? "#f8f7f1" : "#171719"} />
    </mesh>))}
    <mesh position={[-11.25, 1.12, 3.25]}><cylinderGeometry args={[0.07, 0.09, 1.65, 10]} /><meshStandardMaterial color="#f8f7f1" /></mesh>
    <mesh position={[-9.65, 1.12, 3.25]}><cylinderGeometry args={[0.07, 0.09, 1.65, 10]} /><meshStandardMaterial color="#f8f7f1" /></mesh>
    <mesh position={[-10.45, 1.62, 3.3]}>
      <planeGeometry args={[1.72, 0.58]} /><meshBasicMaterial map={finishTexture} side={DoubleSide} />
    </mesh>
  </group>;
}

function TrackBoard({ trackName }: Pick<RaceTableSceneProps, "trackName">) {
  const wild = trackName === "WildWilds";
  return <RigidBody type="fixed" colliders={false} friction={0.9} restitution={0.25}>
    <mesh receiveShadow position={[0, 0.08, 0]}>
      <boxGeometry args={[BOARD_SIZE.width, 0.34, BOARD_SIZE.depth]} />
      <meshStandardMaterial color={wild ? "#dce9d8" : "#f4edda"} roughness={0.88} />
    </mesh>
    <CuboidCollider args={[BOARD_SIZE.width / 2, 0.17, BOARD_SIZE.depth / 2]} position={[0, 0.08, 0]} />
    {Array.from({ length: TRACK_LENGTH }, (_, index) => <TrackTile key={index + 1} step={index + 1} wild={wild} />)}
    <StartAndFinish />
    <CenterTheme wild={wild} />
  </RigidBody>;
}

function RacerPiece({ athleteId, name, color, world, tripped, finished, eliminated }: {
  athleteId: string; name: string; color: string; world: { x: number; z: number };
  tripped: boolean; finished: boolean; eliminated: boolean;
}) {
  const texture = useMemo(() => {
    const next = new TextureLoader().load(`/assets/racer-tokens/${athleteId}.webp`);
    next.colorSpace = SRGBColorSpace;
    return next;
  }, [athleteId]);
  const lean = tripped ? -Math.PI / 2 : 0;
  return <RigidBody type="kinematicPosition" colliders={false} position={[world.x, 0.39, world.z]}>
    <CuboidCollider args={[0.3, 0.55, 0.1]} position={[0, 0.55, 0]} friction={0.7} restitution={0.45} />
    <group rotation={[lean, 0, 0]} position={[0, tripped ? 0.14 : 0, 0]}>
      <mesh castShadow receiveShadow position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.42, 0.48, 0.22, 24]} />
        <meshStandardMaterial color={eliminated ? "#777777" : color} roughness={0.62} />
      </mesh>
      <mesh castShadow position={[0, 0.82, 0]}>
        <planeGeometry args={[0.92, 1.35]} />
        <meshStandardMaterial map={texture} transparent alphaTest={0.08} side={DoubleSide} roughness={0.7} opacity={eliminated ? 0.55 : 1} />
      </mesh>
      {finished && <mesh position={[0, 0.18, 0.46]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.25, 0.34, 24]} /><meshBasicMaterial color="#efbd25" />
      </mesh>}
    </group>
    <mesh visible={false} name={name} />
  </RigidBody>;
}

function RacerFleet({ players, finishLine }: Pick<RaceTableSceneProps, "players" | "finishLine">) {
  const racers = players.flatMap((player, playerIndex) => player.activeRacers.map((racer) => ({
    athleteId: racer.id,
    playerIndex,
    position: racer.position,
    finished: racer.finished,
    finishPosition: racer.finishPosition,
    eliminated: racer.eliminated,
  })));
  const placements = assignRacerPlacements(racers, finishLine);
  return <>{placements.map((placement) => {
    const player = players[placement.playerIndex];
    const racer = player.activeRacers.find((item) => item.id === placement.athleteId)!;
    return <RacerPiece key={`${player.id}:${racer.id}`} athleteId={racer.id} name={racer.nameZh}
      color={PLAYER_COLORS[placement.playerIndex]} world={placement.world} tripped={racer.tripped}
      finished={racer.finished} eliminated={racer.eliminated} />;
  })}</>;
}

function TableAndBounds() {
  return <RigidBody type="fixed" colliders={false}>
    <mesh receiveShadow position={[0, -0.23, 0]}>
      <boxGeometry args={[26, 0.34, 11]} />
      <meshStandardMaterial color="#242326" roughness={0.86} />
    </mesh>
    <CuboidCollider args={[13, 0.17, 5.5]} position={[0, -0.23, 0]} />
    <CuboidCollider args={[13, 0.8, 0.12]} position={[0, 0.4, -5.5]} />
    <CuboidCollider args={[13, 0.8, 0.12]} position={[0, 0.4, 5.5]} />
    <CuboidCollider args={[0.12, 0.8, 5.5]} position={[-13, 0.4, 0]} />
    <CuboidCollider args={[0.12, 0.8, 5.5]} position={[13, 0.4, 0]} />
  </RigidBody>;
}

function Scene({ players, finishLine, trackName }: RaceTableSceneProps) {
  return <>
    <FixedCameraRig />
    <color attach="background" args={["#242326"]} />
    <hemisphereLight intensity={1.15} color="#fff9e9" groundColor="#4b5052" />
    <directionalLight castShadow position={[-8, 15, 10]} intensity={2.6} shadow-mapSize={[1536, 1536]}
      shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={9} shadow-camera-bottom={-9} />
    <Physics gravity={[0, -12, 0]}>
      <TableAndBounds />
      <TrackBoard trackName={trackName} />
      <Suspense fallback={null}><RacerFleet players={players} finishLine={finishLine} /></Suspense>
    </Physics>
  </>;
}

function HtmlFallback({ players, finishLine }: Pick<RaceTableSceneProps, "players" | "finishLine">) {
  return <div className="race-table-fallback" role="img" aria-label="比赛位置">
    {players.flatMap((player) => player.activeRacers.map((racer) => <div key={`${player.id}:${racer.id}`}>
      <strong>{racer.nameZh}</strong>
      <span>{racer.eliminated ? "已淘汰" : racer.finished ? "已完赛" : `${racer.position} / ${finishLine}`}{racer.tripped ? " · 已绊倒" : ""}</span>
    </div>))}
  </div>;
}

export function RaceTableScene(props: RaceTableSceneProps) {
  const [webglAvailable] = useState(() => {
    try {
      const canvas = document.createElement("canvas");
      return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch { return false; }
  });
  if (!webglAvailable) return <HtmlFallback players={props.players} finishLine={props.finishLine} />;
  return <section className="race-table-3d" aria-label="3D 比赛桌">
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 19, 18], fov: 42, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}>
      <Scene {...props} />
    </Canvas>
  </section>;
}
