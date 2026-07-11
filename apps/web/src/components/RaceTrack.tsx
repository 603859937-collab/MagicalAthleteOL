import { Container, Graphics, Stage, Text } from "@pixi/react";
import { useCallback } from "react";
import { TextStyle, type Graphics as PixiGraphics } from "pixi.js";
import type { PlayerState } from "../protocol";

interface RaceTrackProps {
  players: PlayerState[];
  finishLine: number;
  trackName: "Standard" | "WildWilds";
}

const colors = [0xf33a20, 0x2e87d3, 0xf2bd27, 0x36a957, 0xd85a9f, 0x7446aa];
const wildTiles: Record<number, { label: string; color: number }> = {
  1: { label: "★", color: 0xf2bd27 }, 5: { label: "TRIP", color: 0xf33a20 },
  7: { label: "+3", color: 0x36a957 }, 11: { label: "+1", color: 0x36a957 },
  13: { label: "★", color: 0xf2bd27 }, 16: { label: "−4", color: 0xf33a20 },
  17: { label: "TRIP", color: 0xf33a20 }, 23: { label: "+2", color: 0x36a957 },
  24: { label: "−2", color: 0xf33a20 }, 26: { label: "TRIP", color: 0xf33a20 },
};

export function RaceTrack({ players, finishLine, trackName }: RaceTrackProps) {
  const racers = players.flatMap((player, ownerIndex) =>
    player.activeRacers.map((racer) => ({ ...racer, ownerIndex, playerName: player.name })),
  );
  const drawTrack = useCallback((graphics: PixiGraphics) => {
    graphics.clear();
    graphics.beginFill(0xf7f2e7);
    graphics.lineStyle(8, 0x121212);
    graphics.drawRoundedRect(12, 12, 1076, 336, 6);
    graphics.endFill();
    const cellWidth = 1000 / finishLine;
    for (let index = 0; index <= finishLine; index += 1) {
      const x = 48 + index * cellWidth;
      const special = trackName === "WildWilds" ? wildTiles[index] : undefined;
      if (special) {
        graphics.beginFill(special.color, 0.2);
        graphics.drawRect(x - cellWidth / 2, 28, cellWidth, 300);
        graphics.endFill();
      }
      graphics.lineStyle(index === finishLine ? 5 : 1, index === finishLine ? 0x121212 : 0xc9c2b4);
      graphics.moveTo(x, 28);
      graphics.lineTo(x, 328);
    }
  }, [finishLine, trackName]);

  return (
    <Stage width={1100} height={360} options={{ backgroundAlpha: 0, antialias: true }}>
      <Graphics draw={drawTrack} />
      <Text text="START" x={22} y={8} style={new TextStyle({ fill: 0x121212, fontSize: 12, fontWeight: "700" })} />
      <Text text="FINISH" x={1028} y={8} style={new TextStyle({ fill: 0xf33a20, fontSize: 12, fontWeight: "700" })} />
      {trackName === "WildWilds" && Object.entries(wildTiles).map(([tile, feature]) => (
        <Text key={tile} text={feature.label} x={42 + Number(tile) * (1000 / finishLine)} y={312} anchor={0.5}
          style={new TextStyle({ fill: feature.color, fontSize: feature.label === "TRIP" ? 8 : 12, fontWeight: "800" })} />
      ))}
      {racers.map((racer, index) => {
        const x = 48 + (Math.min(racer.position, finishLine) / finishLine) * 1000;
        const y = 58 + index * Math.min(48, 245 / Math.max(racers.length - 1, 1));
        return (
          <Container key={`${racer.playerName}-${racer.id}`} x={x} y={y}>
            <Graphics draw={(graphics) => {
              graphics.clear();
              graphics.beginFill(colors[racer.ownerIndex % colors.length], racer.eliminated ? 0.35 : 1);
              graphics.lineStyle(3, 0x121212);
              graphics.drawCircle(0, 0, racer.finished ? 18 : 14);
              graphics.endFill();
            }} />
            <Text text={`${racer.nameZh}${racer.tripped ? " ×" : ""}`} x={20} y={-9}
              style={new TextStyle({ fill: 0x121212, fontSize: 13, fontWeight: "700" })} />
          </Container>
        );
      })}
    </Stage>
  );
}
