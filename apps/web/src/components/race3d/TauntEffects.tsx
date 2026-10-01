import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Group, Vector3 } from "three";
import type { PlayerState, PropThrow } from "../../protocol";
import { assignRacerPlacements } from "./trackLayout";

function FlyingProp({ event, start, end, reducedMotion }: {
  event: PropThrow; start: Vector3; end: Vector3; reducedMotion: boolean;
}) {
  const projectile = useRef<Group>(null);
  const splash = useRef<Group>(null);
  const elapsed = useRef(0);
  const origin = useRef(start.clone());
  const target = useRef(end.clone());
  const egg = event.item === "egg";
  useFrame((_, delta) => {
    elapsed.current += delta;
    const duration = reducedMotion ? 0 : .85;
    const progress = duration ? Math.min(1, elapsed.current / duration) : 1;
    if (projectile.current) {
      projectile.current.visible = progress < 1;
      projectile.current.position.lerpVectors(origin.current, target.current, progress);
      projectile.current.position.y += Math.sin(progress * Math.PI) * 2;
      projectile.current.rotation.z = progress * Math.PI * 4;
    }
    if (splash.current) {
      const age = elapsed.current - duration;
      splash.current.visible = age >= 0 && age < .9;
      splash.current.position.copy(target.current); splash.current.position.y = .32;
      splash.current.scale.setScalar(reducedMotion ? 1 : 1 + Math.max(0, age) * .65);
    }
  });
  return <>
    <group ref={projectile}>
      <mesh scale={egg ? [.15, .21, .15] : [.19, .17, .19]}><sphereGeometry args={[1, 16, 12]} /><meshStandardMaterial color={egg ? "#fff3d4" : "#ee412d"} roughness={.65} /></mesh>
      {!egg && <mesh position={[0, .18, 0]}><coneGeometry args={[.11, .12, 5]} /><meshStandardMaterial color="#3d873c" /></mesh>}
    </group>
    <group ref={splash} visible={false}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.28, 20]} /><meshBasicMaterial color={egg ? "#fff5dd" : "#ef442f"} transparent opacity={.9} depthWrite={false} /></mesh>
      {egg && <mesh position={[0, .005, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.12, 16]} /><meshBasicMaterial color="#f4bb2c" /></mesh>}
      {Array.from({length: 7}, (_, i) => { const angle=i * Math.PI * 2 / 7; return <mesh key={i} position={[Math.cos(angle) * .38, .01, Math.sin(angle) * .38]} scale={[.08, .02, .1]}><sphereGeometry args={[1, 8, 6]} /><meshBasicMaterial color={egg ? "#fff3cf" : "#ed442e"} /></mesh>; })}
    </group>
  </>;
}

export function TauntEffects({ events, players, finishLine, reducedMotion }: {
  events: PropThrow[]; players: PlayerState[]; finishLine: number; reducedMotion: boolean;
}) {
  const positions = useMemo(() => assignRacerPlacements(players.flatMap((p, playerIndex) => p.activeRacers.map(r => ({...r, athleteId:r.id, playerIndex}))), finishLine), [players, finishLine]);
  return <>{events.map(event => {
    const target = positions.find(p => players[p.playerIndex].id === event.targetPlayerId);
    if (!target) return null;
    const source = positions.find(p => players[p.playerIndex].id === event.actorId);
    const end = new Vector3(target.world.x, .8, target.world.z);
    const start = source ? new Vector3(source.world.x, .8, source.world.z) : end.clone().add(new Vector3(-2, 0, 2));
    return <FlyingProp key={event.id} event={event} start={start} end={end} reducedMotion={reducedMotion} />;
  })}</>;
}
