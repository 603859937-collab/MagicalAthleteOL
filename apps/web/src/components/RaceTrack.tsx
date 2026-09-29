import { Container, Graphics, Sprite, Stage, Text } from "@pixi/react";
import { useEffect, useMemo, useState } from "react";
import { Assets, ColorMatrixFilter, TextStyle, Texture } from "pixi.js";
import type { ActionMoment } from "../eventPresentation";
import type { PlayerState } from "../protocol";
import { assetUrl } from "../runtimeConfig";
import { createBoardCanvas, drawBoardArtwork, loadBoardAtlas } from "./race3d/boardArtwork";
import { assignRacerPlacements, BOARD_SIZE } from "./race3d/trackLayout";

interface RaceTrackProps {
  moment?: ActionMoment | null;
  players: PlayerState[];
  finishLine: number;
  trackName: "Standard" | "WildWilds";
}

const WIDTH = 1200;
const HEIGHT = 360;
const ink = 0x171719;
const paper = 0xf7f4e9;
const playerColors = [0xeb3e27, 0x4b8bd2, 0xf2bd27, 0x48a657, 0xd968a9, 0x8b5eb2];
const outlineOffsets = [
  [-2, -2], [0, -3], [2, -2], [3, 0],
  [2, 2], [0, 3], [-2, 2], [-3, 0],
] as const;

function FallbackToken({ name, color, finished }: { name: string; color: number; finished: boolean }) {
  return <>
    <Graphics draw={(g) => {
      g.clear(); g.beginFill(paper); g.lineStyle(3, ink); g.drawCircle(0, 0, finished ? 18 : 15); g.endFill();
      g.beginFill(color); g.drawCircle(0, 0, finished ? 13 : 10); g.endFill();
    }} />
    <Text text={name.slice(0, 1)} x={0} y={-1} anchor={0.5}
      style={new TextStyle({ fill: ink, fontSize: 11, fontWeight: "900" })} />
  </>;
}

function RacerToken({ id, name, color, finished }: { id: string; name: string; color: number; finished: boolean }) {
  const [texture, setTexture] = useState<Texture | null>(null);
  const [failed, setFailed] = useState(false);
  const size = finished ? 48 : 42;
  const outlineFilter = useMemo(() => {
    const filter = new ColorMatrixFilter();
    const red = ((color >> 16) & 0xff) / 255;
    const green = ((color >> 8) & 0xff) / 255;
    const blue = (color & 0xff) / 255;
    filter.matrix = [
      0, 0, 0, 0, red,
      0, 0, 0, 0, green,
      0, 0, 0, 0, blue,
      0, 0, 0, 1, 0,
    ];
    return filter;
  }, [color]);

  useEffect(() => {
    let active = true;
    setTexture(null);
    setFailed(false);
    Assets.load<Texture>(assetUrl(`assets/racer-tokens/${id}.webp`))
      .then((loaded) => { if (active) setTexture(loaded); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id]);

  if (!texture || failed) return <FallbackToken name={name} color={color} finished={finished} />;
  return <>
    {outlineOffsets.map(([x, y]) => (
      <Sprite key={`${x}-${y}`} texture={texture} x={x} y={y} width={size} height={size}
        anchor={0.5} filters={[outlineFilter]} />
    ))}
    <Sprite texture={texture} width={size} height={size} anchor={0.5} />
  </>;
}

export function RaceTrack({ players, finishLine, trackName, moment }: RaceTrackProps) {
  // Keep the Sprite's texture alive across map changes: Pixi applies prop
  // updates after React effects, so disposing the previous map here is unsafe.
  const [{ canvas, board }] = useState(() => {
    const canvas = createBoardCanvas(trackName);
    return { canvas, board: Texture.from(canvas) };
  });
  useEffect(() => {
    let active = true;
    const context = canvas.getContext("2d");
    if (context) {
      drawBoardArtwork(context, trackName);
      board.baseTexture.update();
    }
    loadBoardAtlas().then((image) => {
      if (!active) return;
      if (context) {
        drawBoardArtwork(context, trackName, image);
        board.baseTexture.update();
      }
    }).catch(() => { /* Keep the drawn course visible if artwork is unavailable. */ });
    return () => { active = false; };
  }, [board, canvas, trackName]);
  useEffect(() => () => board.destroy(true), [board]);
  const racers = assignRacerPlacements(players.flatMap((player, playerIndex) =>
    player.activeRacers.map((racer) => ({ ...racer, athleteId: racer.id, playerIndex })),
  ), finishLine);

  return <Stage width={WIDTH} height={HEIGHT} style={{ width: "100%", height: "auto" }}
    options={{ backgroundAlpha: 0, antialias: true }}>
    {board && <Sprite texture={board} width={WIDTH} height={HEIGHT} />}
    {racers.map((placement) => {
      const player = players[placement.playerIndex];
      const racer = player.activeRacers.find((item) => item.id === placement.athleteId)!;
      return <Container key={`${player.id}-${racer.id}`}
        x={(placement.world.x / BOARD_SIZE.width + .5) * WIDTH}
        y={(placement.world.z / BOARD_SIZE.depth + .5) * HEIGHT}
        scale={placement.slotCount > 3 ? .7 : 1} alpha={racer.eliminated ? .4 : 1}>
        {(moment?.target.playerId === player.id && moment.target.athleteId === racer.id
          || moment?.source.playerId === player.id && moment.source.athleteId === racer.id) && <Graphics draw={(g) => {
          const target = moment?.target.playerId === player.id && moment.target.athleteId === racer.id;
          g.clear(); g.lineStyle(4, target ? 0xff9247 : 0x37d7ec); g.drawCircle(0, 0, 29);
        }} />}
        <RacerToken id={racer.id} name={racer.nameZh} color={playerColors[placement.playerIndex % playerColors.length]}
          finished={racer.finished} />
        {(racer.tripped || racer.finished) && <Text text={racer.tripped ? "×" : "★"} x={15} y={-23} anchor={.5}
          style={new TextStyle({ fill: racer.tripped ? 0xe63a24 : 0xf2bd27, fontSize: 16, fontWeight: "900", stroke: ink, strokeThickness: 2 })} />}
      </Container>;
    })}
  </Stage>;
}
