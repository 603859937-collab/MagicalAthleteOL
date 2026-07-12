import { Canvas, useThree } from "@react-three/fiber";
import { CuboidCollider, Physics, RigidBody } from "@react-three/rapier";
import { Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CanvasTexture, DoubleSide, PCFSoftShadowMap, SRGBColorSpace, TextureLoader } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { PlayerState } from "../../protocol";
import { assetUrl } from "../../runtimeConfig";
import {
  assignRacerPlacements,
  BOARD_SIZE,
  FINISH_BADGE_RECT,
  RACER_PIECE_DIMENSIONS,
  racerPieceScale,
  trackPose,
} from "./trackLayout";

interface RaceTableSceneProps {
  players: PlayerState[];
  finishLine: number;
  trackName: "Standard" | "WildWilds";
}

const TILE_COLORS = ["#ba64af", "#efbd27", "#4b8c46", "#568bd1", "#e2503b"];
const PLAYER_COLORS = ["#e8422e", "#4386c6", "#efbd25", "#43a45c", "#d45f9d", "#855ab0"];
const INK = "#171719";
const PAPER = "#f7f4e9";
const ARTBOARD = { width: 1200, height: 360 } as const;
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
    const horizontalFovSlope = Math.tan((30 * Math.PI) / 360);
    const desiredHalfWidth = aspect < 1.7 ? 14.5 : 13.25;
    const distance = Math.max(15, desiredHalfWidth / (horizontalFovSlope * aspect));
    const elevation = Math.PI * (66 / 180);
    camera.position.set(0, Math.sin(elevation) * distance, Math.cos(elevation) * distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);
  return null;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function fillRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, color: string, stroke = INK) {
  roundedRect(context, x, y, width, height, radius);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 3;
  context.stroke();
}

function drawTile(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string) {
  context.fillStyle = color;
  context.fillRect(x, y, width, height);
  context.strokeStyle = INK;
  context.lineWidth = 3;
  context.strokeRect(x + 1.5, y + 1.5, width - 3, height - 3);
}

function drawFinishPodium(context: CanvasRenderingContext2D) {
  const { x, y, width, height } = FINISH_BADGE_RECT;
  fillRoundedRect(context, x, y, width, height, 24, PAPER);
  fillRoundedRect(context, x + 8, y + 8, width - 16, height - 16, 14, INK, PAPER);
  context.fillStyle = "#f2bd27";
  context.beginPath();
  context.arc(x + width / 2, y + 35, 18, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = PAPER;
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = "#4f83ce";
  context.beginPath();
  context.arc(x + width / 2, y + 79, 17, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = PAPER;
  context.stroke();
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      context.fillStyle = (row + column) % 2 === 0 ? PAPER : INK;
      context.fillRect(x + 14 + column * 9, y + height - 19 + row * 7, 9, 7);
    }
  }
  context.fillStyle = INK;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "900 17px Impact, Arial Black, sans-serif";
  context.fillText("1", x + width / 2, y + 35);
  context.font = "900 20px Impact, Arial Black, sans-serif";
  context.fillText("2", x + width / 2, y + 79);
}

function drawBoardArtwork(context: CanvasRenderingContext2D, trackName: RaceTableSceneProps["trackName"]) {
  const wild = trackName === "WildWilds";
  context.clearRect(0, 0, ARTBOARD.width, ARTBOARD.height);

  roundedRect(context, 4, 4, 1192, 352, 42); context.fillStyle = INK; context.fill();
  roundedRect(context, 12, 12, 1176, 336, 34); context.fillStyle = PAPER; context.fill();
  roundedRect(context, 20, 20, 1160, 320, 28); context.fillStyle = INK; context.fill();

  fillRoundedRect(context, 29, 28, 205, 78, 28, "#5b8fda");
  context.fillStyle = "#e34a32";
  context.strokeStyle = INK;
  context.lineWidth = 3;
  context.font = "900 34px Impact, Arial Black, PingFang SC, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeText("起点", 132, 67);
  context.fillText("起点", 132, 67);

  for (let step = 1; step <= 13; step += 1) {
    const feature = wild ? WILD_TILES[step] : undefined;
    drawTile(context, 234 + (step - 1) * (937 / 13), 28, 937 / 13, 78, feature?.color ?? TILE_COLORS[(step - 1) % TILE_COLORS.length]);
  }
  for (let step = 14; step <= 15; step += 1) {
    const feature = wild ? WILD_TILES[step] : undefined;
    drawTile(context, 1105, 106 + (step - 14) * 74, 66, 74, feature?.color ?? TILE_COLORS[(step - 1) % TILE_COLORS.length]);
  }
  for (let step = 16; step <= 29; step += 1) {
    const feature = wild ? WILD_TILES[step] : undefined;
    const width = 1046 / 14;
    drawTile(context, 1171 - (step - 15) * width, 254, width, 78, feature?.color ?? TILE_COLORS[(step - 1) % TILE_COLORS.length]);
  }

  context.fillStyle = "#111116";
  context.fillRect(78, 113, 1027, 134);
  context.strokeStyle = PAPER;
  context.lineWidth = 3;
  context.strokeRect(78, 113, 1027, 134);
  context.fillStyle = wild ? "#6d3d94" : "#d97825";
  context.beginPath();
  context.ellipse(600, 223, 440, 16, 0, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = PAPER;
  context.strokeStyle = INK;
  context.lineWidth = 3;
  context.font = "900 72px Impact, Arial Black, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.strokeText(wild ? "WILD WILDS" : "MILD MILE", 600, 172);
  context.fillText(wild ? "WILD WILDS" : "MILD MILE", 600, 172);

  const standardLabels = [5, 10, 15, 20, 25];
  for (const step of standardLabels) {
    const pose = trackPose(step);
    const x = (pose.position.x / BOARD_SIZE.width + 0.5) * ARTBOARD.width;
    const y = (pose.position.z / BOARD_SIZE.depth + 0.5) * ARTBOARD.height;
    context.fillStyle = INK;
    context.strokeStyle = PAPER;
    context.lineWidth = 2;
    context.font = "900 20px Impact, Arial Black, sans-serif";
    context.strokeText(String(step), x, y);
    context.fillText(String(step), x, y);
  }
  if (wild) {
    for (const [stepText, feature] of Object.entries(WILD_TILES)) {
      const pose = trackPose(Number(stepText));
      const x = (pose.position.x / BOARD_SIZE.width + 0.5) * ARTBOARD.width;
      const y = (pose.position.z / BOARD_SIZE.depth + 0.5) * ARTBOARD.height;
      context.fillStyle = feature.color === "#e4482c" ? PAPER : INK;
      context.strokeStyle = feature.color === "#e4482c" ? INK : PAPER;
      context.lineWidth = 2;
      context.font = "900 19px Impact, Arial Black, sans-serif";
      context.strokeText(feature.label, x, y);
      context.fillText(feature.label, x, y);
    }
  }
  drawFinishPodium(context);
}

function useBoardTexture(trackName: RaceTableSceneProps["trackName"]) {
  const texture = useMemo(() => {
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = ARTBOARD.width * scale;
    canvas.height = ARTBOARD.height * scale;
    const context = canvas.getContext("2d");
    if (context) {
      context.scale(scale, scale);
      drawBoardArtwork(context, trackName);
    }
    const next = new CanvasTexture(canvas);
    next.colorSpace = SRGBColorSpace;
    return next;
  }, [trackName]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

function BoardArtwork({ trackName }: Pick<RaceTableSceneProps, "trackName">) {
  const texture = useBoardTexture(trackName);
  return <mesh receiveShadow position={[0, 0.258, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
    <planeGeometry args={[BOARD_SIZE.width, BOARD_SIZE.depth]} />
    <meshStandardMaterial map={texture} transparent roughness={0.86} metalness={0} polygonOffset polygonOffsetFactor={-1} />
  </mesh>;
}

function artworkPosition(x: number, y: number): [number, number, number] {
  return [
    (x / ARTBOARD.width - 0.5) * BOARD_SIZE.width,
    0.34,
    (y / ARTBOARD.height - 0.5) * BOARD_SIZE.depth,
  ];
}

function FlowerModel({ x, y, color, scale = 1 }: { x: number; y: number; color: string; scale?: number }) {
  return <group position={artworkPosition(x, y)} scale={scale}>
    <mesh castShadow position={[-0.06, 0.035, 0.27]} rotation={[0, 0, 0.2]}>
      <boxGeometry args={[0.055, 0.055, 0.52]} />
      <meshStandardMaterial color="#347b38" roughness={0.82} />
    </mesh>
    {Array.from({ length: 6 }, (_, index) => {
      const angle = index * Math.PI / 3;
      return <mesh key={index} castShadow position={[Math.cos(angle) * 0.16, 0.075, Math.sin(angle) * 0.16]}
        scale={[0.18, 0.08, 0.12]} rotation={[0, -angle, 0]}>
        <sphereGeometry args={[1, 16, 10]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>;
    })}
    <mesh castShadow position={[0, 0.12, 0]} scale={[0.11, 0.07, 0.11]}>
      <sphereGeometry args={[1, 18, 12]} />
      <meshStandardMaterial color="#f2bd27" roughness={0.6} />
    </mesh>
  </group>;
}

function CreatureModel({ x, y, mirror = false }: { x: number; y: number; mirror?: boolean }) {
  const direction = mirror ? -1 : 1;
  return <group position={artworkPosition(x, y)} rotation={[0, mirror ? Math.PI : 0, 0]}>
    <mesh castShadow position={[0, 0.13, 0]} scale={[0.5, 0.13, 0.2]}>
      <sphereGeometry args={[1, 20, 12]} />
      <meshStandardMaterial color="#4f94d5" roughness={0.58} />
    </mesh>
    <mesh castShadow position={[0.43, 0.18, -0.05]} scale={[0.18, 0.18, 0.18]}>
      <sphereGeometry args={[1, 18, 12]} />
      <meshStandardMaterial color="#4f94d5" roughness={0.58} />
    </mesh>
    <mesh castShadow position={[0.5, 0.27, -0.11]} scale={[0.055, 0.055, 0.055]}>
      <sphereGeometry args={[1, 12, 8]} />
      <meshStandardMaterial color={PAPER} roughness={0.5} />
    </mesh>
    <mesh position={[0.515, 0.28, -0.145 * direction]} scale={[0.022, 0.022, 0.022]}>
      <sphereGeometry args={[1, 10, 8]} />
      <meshStandardMaterial color={INK} />
    </mesh>
  </group>;
}

function RaisedBoardDecor({ trackName }: Pick<RaceTableSceneProps, "trackName">) {
  const flowers = trackName === "WildWilds"
    ? [[172, 185, "#b85fc1", 0.9], [236, 172, "#e6d961", 0.78], [972, 177, "#d94b9b", 0.94], [1032, 188, "#f2f0dc", 0.74]] as const
    : [[165, 181, "#f2f0dc", 0.8], [215, 166, "#d94b9b", 1.1], [953, 175, "#e74a32", 1.2], [1019, 182, "#e4d62b", 0.85]] as const;
  return <group>
    {flowers.map(([x, y, color, scale]) => <FlowerModel key={`${x}:${y}`} x={x} y={y} color={color} scale={scale} />)}
    {trackName === "Standard" && <>
      <CreatureModel x={306} y={205} />
      <CreatureModel x={892} y={203} mirror />
    </>}
  </group>;
}

function BoardBase() {
  const geometry = useMemo(() => new RoundedBoxGeometry(BOARD_SIZE.width, 0.34, BOARD_SIZE.depth, 8, 0.72), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} receiveShadow position={[0, 0.08, 0]}>
    <meshStandardMaterial color={INK} roughness={0.9} />
  </mesh>;
}

function TrackBoard({ trackName }: Pick<RaceTableSceneProps, "trackName">) {
  return <RigidBody type="fixed" colliders={false} friction={0.9} restitution={0.25}>
    <BoardBase />
    <CuboidCollider args={[BOARD_SIZE.width / 2, 0.17, BOARD_SIZE.depth / 2]} position={[0, 0.08, 0]} />
    <BoardArtwork trackName={trackName} />
    <RaisedBoardDecor trackName={trackName} />
  </RigidBody>;
}

function RacerPiece({ athleteId, name, color, world, slotCount, tripped, finished, eliminated }: {
  athleteId: string; name: string; color: string; world: { x: number; z: number };
  slotCount: number; tripped: boolean; finished: boolean; eliminated: boolean;
}) {
  const texture = useMemo(() => {
    const next = new TextureLoader().load(assetUrl(`assets/racer-tokens/${athleteId}.webp`));
    next.colorSpace = SRGBColorSpace;
    return next;
  }, [athleteId]);
  const scale = racerPieceScale(slotCount);
  const baseHeight = 0.18 * scale;
  const baseRadius = RACER_PIECE_DIMENSIONS.baseRadius * scale;
  const portraitWidth = RACER_PIECE_DIMENSIONS.portraitWidth * scale;
  const portraitHeight = RACER_PIECE_DIMENSIONS.portraitHeight * scale;
  const lean = tripped ? -Math.PI / 2 : 0;
  return <RigidBody type="kinematicPosition" colliders={false} position={[world.x, 0.285, world.z]}>
    <CuboidCollider args={[portraitWidth / 2, (baseHeight + portraitHeight) / 2, 0.06 * scale]}
      position={[0, (baseHeight + portraitHeight) / 2, 0]} friction={0.7} restitution={0.45} />
    <group rotation={[lean, 0, 0]} position={[0, tripped ? baseHeight / 2 : 0, 0]}>
      <mesh castShadow receiveShadow position={[0, baseHeight / 2, 0]}>
        <cylinderGeometry args={[baseRadius * 0.88, baseRadius, baseHeight, 24]} />
        <meshStandardMaterial color={eliminated ? "#777777" : color} roughness={0.62} />
      </mesh>
      <mesh castShadow position={[0, baseHeight + portraitHeight / 2 - 0.035 * scale, 0]}>
        <planeGeometry args={[portraitWidth, portraitHeight]} />
        <meshStandardMaterial map={texture} transparent alphaTest={0.08} side={DoubleSide} roughness={0.7} opacity={eliminated ? 0.55 : 1} />
      </mesh>
      {finished && <mesh position={[0, baseHeight + 0.01, baseRadius * 1.1]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[baseRadius * 0.52, baseRadius * 0.72, 24]} /><meshBasicMaterial color="#efbd25" />
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
      color={PLAYER_COLORS[placement.playerIndex]} world={placement.world} slotCount={placement.slotCount} tripped={racer.tripped}
      finished={racer.finished} eliminated={racer.eliminated} />;
  })}</>;
}

function TableAndBounds() {
  return <RigidBody type="fixed" colliders={false}>
    <mesh receiveShadow position={[0, -0.12, 0]}>
      <boxGeometry args={[25.2, 0.2, 8.1]} />
      <meshStandardMaterial color="#79756d" roughness={1} />
    </mesh>
    <CuboidCollider args={[12.6, 0.1, 4.05]} position={[0, -0.12, 0]} />
    <CuboidCollider args={[12.6, 0.8, 0.1]} position={[0, 0.4, -4.05]} />
    <CuboidCollider args={[12.6, 0.8, 0.1]} position={[0, 0.4, 4.05]} />
    <CuboidCollider args={[0.1, 0.8, 4.05]} position={[-12.6, 0.4, 0]} />
    <CuboidCollider args={[0.1, 0.8, 4.05]} position={[12.6, 0.4, 0]} />
  </RigidBody>;
}

function Scene({ players, finishLine, trackName }: RaceTableSceneProps) {
  return <>
    <FixedCameraRig />
    <color attach="background" args={["#6e6b65"]} />
    <hemisphereLight intensity={0.58} color="#fff9e9" groundColor="#4b4945" />
    <directionalLight castShadow position={[-7, 14, 8]} intensity={2.65} shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.00015} shadow-normalBias={0.025} shadow-radius={4}
      shadow-camera-near={4} shadow-camera-far={32}
      shadow-camera-left={-13} shadow-camera-right={13} shadow-camera-top={6} shadow-camera-bottom={-6} />
    <directionalLight position={[9, 7, -7]} intensity={0.38} color="#dce8ff" />
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
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [0, 19, 9], fov: 30, near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => { gl.shadowMap.type = PCFSoftShadowMap; }}>
      <Scene {...props} />
    </Canvas>
  </section>;
}
