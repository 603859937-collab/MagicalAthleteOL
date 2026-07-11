import { Container, Graphics, Stage, Text } from "@pixi/react";
import { useCallback } from "react";
import { TextStyle, type Graphics as PixiGraphics } from "pixi.js";
import type { PlayerState } from "../protocol";

interface RaceTrackProps {
  players: PlayerState[];
  finishLine: number;
}

const colors = [0xffcf5c, 0x69d2e7, 0xf58ab6, 0x9be564];

export function RaceTrack({ players, finishLine }: RaceTrackProps) {
  const drawTrack = useCallback(
    (graphics: PixiGraphics) => {
      graphics.clear();
      graphics.beginFill(0x241e3a);
      graphics.drawRoundedRect(18, 18, 864, 264, 24);
      graphics.endFill();
      const cellWidth = 820 / finishLine;
      for (let index = 0; index <= finishLine; index += 1) {
        const x = 48 + index * cellWidth;
        graphics.lineStyle(index === finishLine ? 4 : 1, index === finishLine ? 0xffcf5c : 0x4c4568);
        graphics.moveTo(x, 48);
        graphics.lineTo(x, 252);
      }
    },
    [finishLine],
  );

  return (
    <Stage width={900} height={300} options={{ backgroundAlpha: 0, antialias: true }}>
      <Graphics draw={drawTrack} />
      <Text text="START" x={26} y={24} style={new TextStyle({ fill: 0xbcb5d8, fontSize: 12 })} />
      <Text text="FINISH" x={830} y={24} style={new TextStyle({ fill: 0xffcf5c, fontSize: 12 })} />
      {players.map((player, index) => {
        const x = 48 + (player.position / finishLine) * 820;
        const y = 74 + index * 48;
        return (
          <Container key={player.id} x={x} y={y}>
            <Graphics
              draw={(graphics) => {
                graphics.clear();
                graphics.beginFill(colors[index % colors.length], player.connected ? 1 : 0.35);
                graphics.drawCircle(0, 0, 15);
                graphics.endFill();
              }}
            />
            <Text
              text={player.selectedAthlete?.nameZh ?? player.name}
              x={20}
              y={-10}
              style={new TextStyle({ fill: 0xffffff, fontSize: 14, fontWeight: "600" })}
            />
          </Container>
        );
      })}
    </Stage>
  );
}
