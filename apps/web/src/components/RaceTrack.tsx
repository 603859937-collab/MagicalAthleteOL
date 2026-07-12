import { Container, Graphics, Sprite, Stage, Text } from "@pixi/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Assets, ColorMatrixFilter, TextStyle, Texture, type Graphics as PixiGraphics } from "pixi.js";
import type { PlayerState } from "../protocol";
import { assetUrl } from "../runtimeConfig";

interface RaceTrackProps {
  players: PlayerState[];
  finishLine: number;
  trackName: "Standard" | "WildWilds";
}

type Point = { x: number; y: number };

const WIDTH = 1200;
const HEIGHT = 360;
const ink = 0x171719;
const paper = 0xf7f4e9;
const tileColors = [0xad5aa5, 0xf2b91b, 0x387b38, 0x4f83ce, 0xe63a24];
const playerColors = [0xeb3e27, 0x4b8bd2, 0xf2bd27, 0x48a657, 0xd968a9, 0x8b5eb2];
const outlineOffsets = [
  [-2, -2], [0, -3], [2, -2], [3, 0],
  [2, 2], [0, 3], [-2, 2], [-3, 0],
] as const;

const wildTiles: Record<number, { label: string; kind: "star" | "trip" | "move" }> = {
  1: { label: "1", kind: "star" }, 5: { label: "绊倒!", kind: "trip" },
  7: { label: "+3", kind: "move" }, 11: { label: "+1", kind: "move" },
  13: { label: "1", kind: "star" }, 16: { label: "-4", kind: "move" },
  17: { label: "绊倒!", kind: "trip" }, 23: { label: "+2", kind: "move" },
  24: { label: "-2", kind: "move" }, 26: { label: "绊倒!", kind: "trip" },
};

function tileColor(position: number, feature?: { kind: "star" | "trip" | "move" }): number {
  if (feature?.kind === "star") return 0xf0b718;
  if (feature?.kind === "trip") return 0xe4482c;
  if (feature?.kind === "move") return 0x5b81bd;
  return tileColors[(position - 1) % tileColors.length];
}

function positionOnTrack(position: number, finishLine: number): Point {
  const step = Math.round((Math.max(0, Math.min(position, finishLine)) / finishLine) * 30);
  if (step === 0) return { x: 134, y: 67 };
  if (step <= 12) return { x: 234 + (step - .5) * (871 / 12), y: 67 };
  if (step === 13) return { x: 1138, y: 143 };
  if (step === 14) return { x: 1138, y: 217 };
  if (step === 15) return { x: 1139, y: 292 };
  if (step <= 29) return { x: 1070 - (step - 16) * 70, y: 292 };
  return { x: 77, y: 292 };
}

function drawFlower(g: PixiGraphics, x: number, y: number, color: number, scale = 1) {
  g.beginFill(color);
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6;
    g.drawCircle(x + Math.cos(angle) * 8 * scale, y + Math.sin(angle) * 8 * scale, 7 * scale);
  }
  g.endFill();
  g.beginFill(0xf2bd27); g.drawCircle(x, y, 5 * scale); g.endFill();
  g.lineStyle(3 * scale, 0x347b38); g.moveTo(x, y + 8 * scale); g.lineTo(x - 4 * scale, y + 31 * scale);
}

function drawTree(g: PixiGraphics, x: number, y: number, scale = 1) {
  g.beginFill(0x19633d); g.drawRect(x - 3 * scale, y, 6 * scale, 27 * scale); g.endFill();
  g.beginFill(0x247847);
  g.drawPolygon([x, y - 38 * scale, x - 21 * scale, y + 5 * scale, x + 21 * scale, y + 5 * scale]);
  g.drawPolygon([x, y - 24 * scale, x - 27 * scale, y + 19 * scale, x + 27 * scale, y + 19 * scale]);
  g.endFill();
  g.lineStyle(2, 0x102f25, .8);
  g.moveTo(x, y - 32 * scale); g.lineTo(x - 15 * scale, y + 11 * scale);
  g.moveTo(x, y - 26 * scale); g.lineTo(x + 17 * scale, y + 14 * scale);
}

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

export function RaceTrack({ players, finishLine, trackName }: RaceTrackProps) {
  const racers = players.flatMap((player, ownerIndex) =>
    player.activeRacers.map((racer) => ({ ...racer, ownerIndex, playerName: player.name })),
  );
  const occupied = new Map<number, number>();

  const drawBoard = useCallback((g: PixiGraphics) => {
    g.clear();
    g.beginFill(ink); g.drawRoundedRect(4, 4, WIDTH - 8, HEIGHT - 8, 42); g.endFill();
    g.beginFill(paper); g.drawRoundedRect(12, 12, WIDTH - 24, HEIGHT - 24, 34); g.endFill();
    g.beginFill(ink); g.drawRoundedRect(20, 20, WIDTH - 40, HEIGHT - 40, 28); g.endFill();

    // Start pen and the thirty-space perimeter.
    g.beginFill(0x4f83ce); g.drawRoundedRect(29, 28, 205, 78, 28); g.endFill();
    g.lineStyle(3, ink); g.drawRoundedRect(29, 28, 205, 78, 28);
    for (let i = 1; i <= 12; i += 1) {
      const feature = trackName === "WildWilds" ? wildTiles[i] : undefined;
      g.beginFill(tileColor(i, feature));
      g.drawRect(234 + (i - 1) * (871 / 12), 28, 871 / 12, 78); g.endFill();
      g.lineStyle(3, ink); g.drawRect(234 + (i - 1) * (871 / 12), 28, 871 / 12, 78);
    }
    for (let i = 13; i <= 14; i += 1) {
      const feature = trackName === "WildWilds" ? wildTiles[i] : undefined;
      g.beginFill(tileColor(i, feature));
      g.drawRect(1105, 106 + (i - 13) * 74, 66, 74); g.endFill();
      g.lineStyle(3, ink); g.drawRect(1105, 106 + (i - 13) * 74, 66, 74);
    }
    for (let i = 15; i <= 29; i += 1) {
      const x = 1105 - (i - 15) * 70;
      const feature = trackName === "WildWilds" ? wildTiles[i] : undefined;
      g.beginFill(tileColor(i, feature));
      g.drawRect(x, 254, 70, 78); g.endFill();
      g.lineStyle(3, ink); g.drawRect(x, 254, 70, 78);
    }

    // Illustrated infield.
    g.beginFill(0x121116); g.drawRect(78, 113, 1027, 134); g.endFill();
    g.lineStyle(3, paper); g.drawRect(78, 113, 1027, 134);
    g.beginFill(trackName === "WildWilds" ? 0x7241a0 : 0xd97825);
    g.drawEllipse(600, 228, 455, 18); g.endFill();
    if (trackName === "WildWilds") {
      [158, 205, 259, 936, 991, 1044].forEach((x, index) => drawTree(g, x, 202, index % 2 ? .85 : 1.05));
      g.beginFill(0x71369c); g.drawPolygon([118, 220, 148, 173, 182, 220]); g.endFill();
      g.beginFill(0xb85fc1); g.drawCircle(215, 214, 22); g.endFill();
      g.lineStyle(3, 0x6c277f); for (let r = 5; r < 21; r += 6) g.drawCircle(215, 214, r);
      g.beginFill(0xe94d39); g.drawEllipse(1018, 221, 25, 9); g.drawRect(1014, 220, 8, 19); g.endFill();
      g.beginFill(paper); g.drawCircle(1004, 218, 4); g.drawCircle(1020, 214, 4); g.drawCircle(1032, 220, 4); g.endFill();
    } else {
      g.beginFill(0xb7672a); g.drawRoundedRect(160, 208, 880, 13, 7); g.endFill();
      drawFlower(g, 165, 181, 0xf2f0dc, .8); drawFlower(g, 215, 166, 0xd94b9b, 1.1);
      drawFlower(g, 953, 175, 0xe74a32, 1.2); drawFlower(g, 1019, 182, 0xe4d62b, .85);
      g.beginFill(0x387ec2); g.drawEllipse(308, 204, 30, 15); g.drawCircle(333, 195, 13); g.endFill();
      g.beginFill(0x387ec2); g.drawEllipse(887, 200, 31, 15); g.drawCircle(861, 191, 13); g.endFill();
      g.beginFill(paper); g.drawCircle(336, 191, 3); g.drawCircle(858, 188, 3); g.endFill();
    }

    // Finish podium on the lower-left, matching the physical board's printed badge.
    g.beginFill(paper); g.drawRoundedRect(29, 254, 96, 78, 24); g.endFill();
    g.lineStyle(3, ink); g.drawRoundedRect(29, 254, 96, 78, 24);
    g.beginFill(0xf2bd27); g.drawPolygon([42, 269, 113, 269, 103, 291, 50, 291]); g.endFill();
    g.beginFill(0x4f83ce); g.drawPolygon([42, 297, 113, 297, 103, 320, 50, 320]); g.endFill();
  }, [trackName]);

  const titleStyle = useMemo(() => new TextStyle({
    fill: paper, fontFamily: "Impact, Arial Black, sans-serif", fontSize: 72, fontWeight: "900",
    stroke: ink, strokeThickness: 3, letterSpacing: 0,
  }), []);
  const tileStyle = useMemo(() => new TextStyle({ fill: ink, fontSize: 20, fontWeight: "900", stroke: paper, strokeThickness: 2 }), []);

  return (
    <Stage width={WIDTH} height={HEIGHT} options={{ backgroundAlpha: 0, antialias: true, resolution: 2, autoDensity: true }}>
      <Graphics draw={drawBoard} />
      <Text text={trackName === "WildWilds" ? "WILD WILDS" : "MILD MILE"} x={600} y={167} anchor={0.5} style={titleStyle} />
      <Text text="起点" x={132} y={66} anchor={0.5} style={new TextStyle({ fill: 0xe63a24, fontSize: 33, fontWeight: "900", stroke: ink, strokeThickness: 3 })} />
      <Text text="1st" x={77} y={270} anchor={0.5} style={new TextStyle({ fill: ink, fontSize: 15, fontWeight: "900" })} />
      <Text text="2" x={77} y={299} anchor={0.5} style={new TextStyle({ fill: ink, fontSize: 20, fontWeight: "900" })} />
      {trackName === "Standard" && [5, 10, 15, 20, 25].map((position) => {
        const point = positionOnTrack(position, 30);
        return <Text key={position} text={String(position)} x={point.x} y={point.y} anchor={0.5} style={tileStyle} />;
      })}
      {trackName === "WildWilds" && Object.entries(wildTiles).map(([position, feature]) => {
        const point = positionOnTrack(Number(position), 30);
        const label = feature.kind === "star" ? `★ ${feature.label}` : feature.label;
        return <Text key={position} text={label} x={point.x} y={point.y} anchor={0.5}
          style={new TextStyle({ fill: feature.kind === "trip" ? paper : ink, fontSize: feature.kind === "trip" ? 13 : 19, fontWeight: "900", stroke: feature.kind === "trip" ? ink : paper, strokeThickness: 2 })} />;
      })}
      {racers.map((racer) => {
        const normalized = Math.round((Math.max(0, Math.min(racer.position, finishLine)) / finishLine) * 30);
        const stackIndex = occupied.get(normalized) ?? 0;
        occupied.set(normalized, stackIndex + 1);
        const point = positionOnTrack(racer.position, finishLine);
        const offsetX = (stackIndex % 3 - 1) * 16;
        const offsetY = Math.floor(stackIndex / 3) * 17 - 7;
        return (
          <Container key={`${racer.playerName}-${racer.id}`} x={point.x + offsetX} y={point.y + offsetY} alpha={racer.eliminated ? .4 : 1}>
            <RacerToken id={racer.id} name={racer.nameZh} color={playerColors[racer.ownerIndex % playerColors.length]}
              finished={racer.finished} />
            {(racer.tripped || racer.finished) && <Text text={racer.tripped ? "×" : "★"} x={15} y={-23} anchor={0.5}
              style={new TextStyle({ fill: racer.tripped ? 0xe63a24 : 0xf2bd27, fontSize: 16, fontWeight: "900", stroke: ink, strokeThickness: 2 })} />}
          </Container>
        );
      })}
    </Stage>
  );
}
