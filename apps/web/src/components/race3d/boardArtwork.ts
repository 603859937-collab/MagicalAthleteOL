import i18n from "../../i18n";
import { assetUrl } from "../../runtimeConfig";
import atlas from "./boardAtlas.json";
import { FINISH_BADGE_RECT, REFERENCE_BOARD, referenceRectForStep } from "./trackLayout";

export type TrackName = "Standard" | "WildWilds";
const INK = "#1d1e21";
const PAPER = "#f1f0e9";
const COLORS = ["#b664ad", "#edb921", "#3f7939", "#507fc8", "#e54b34"];
const WILD_LABEL_KEYS: Record<number, string | null> = {
  5: "board.trip", 17: "board.trip", 26: "board.trip",
};
const WILD_SYMBOLS: Record<number, string> = {
  1: "★ 1", 7: "+3", 11: "+1", 13: "★ 1", 16: "−4", 23: "+2", 24: "−2",
};

/** Canvas-filled labels follow the UI language, so the fallback board stays readable. */
function wildLabel(step: number): string {
  const key = WILD_LABEL_KEYS[step];
  return key ? i18n.t(key) : WILD_SYMBOLS[step] ?? "";
}
let atlasPromise: Promise<HTMLImageElement> | undefined;

export function loadBoardAtlas(): Promise<HTMLImageElement> {
  if (!atlasPromise) {
    atlasPromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Board illustration could not be loaded"));
      image.src = assetUrl("assets/boards/print-atlas.webp");
    }).catch((error: unknown) => {
      atlasPromise = undefined;
      throw error;
    });
  }
  return atlasPromise;
}

function rounded(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.roundRect(x, y, w, h, r);
}

export function drawBoardArtwork(context: CanvasRenderingContext2D, track: TrackName, image?: HTMLImageElement) {
  const { width, height } = REFERENCE_BOARD;
  const wild = track === "WildWilds";
  const stamp = (name: keyof typeof atlas, x: number, y: number, w: number, h: number) => {
    if (!image) return;
    const [sx, sy, sw, sh] = atlas[name];
    context.drawImage(image, sx, sy, sw, sh, x, y, w, h);
  };
  context.clearRect(0, 0, width, height);
  context.fillStyle = INK;
  rounded(context, 0, 0, width, height, 47);
  context.fill();

  context.save();
  rounded(context, 20, 20, 1160, 320, 36);
  context.clip();
  for (let step = 0; step < 30; step += 1) {
    const { x, y, width: w, height: h } = referenceRectForStep(step);
    context.fillStyle = step === 0 ? COLORS[3] : COLORS[(step - 1) % COLORS.length];
    context.fillRect(x, y, w, h);
    context.strokeStyle = INK;
    context.lineWidth = 3;
    context.strokeRect(x, y, w, h);
    if (wild && `tile-${step}` in atlas) {
      if (image) {
        stamp(`tile-${step}` as keyof typeof atlas, x + 3, y + 3, w - 6, h - 6);
      } else {
        context.font = "900 23px sans-serif";
        context.textAlign = "center";
        context.fillStyle = PAPER;
        context.strokeStyle = INK;
        context.lineWidth = 3;
        context.strokeText(wildLabel(step), x + w / 2, y + h / 2 + 8);
        context.fillText(wildLabel(step), x + w / 2, y + h / 2 + 8);
      }
    } else if (!wild && step > 0 && step % 5 === 0) {
      if (image) {
        const name = `number-${step}` as keyof typeof atlas;
        const [, , sw, sh] = atlas[name];
        stamp(name, x + (w - sw * .46) / 2, y + (h - sh * .46) / 2, sw * .46, sh * .46);
      } else {
        context.font = "900 32px sans-serif";
        context.fillStyle = PAPER;
        context.textAlign = "center";
        context.fillText(String(step), x + w / 2, y + h / 2 + 10);
      }
    }
  }
  context.restore();

  // White printed keylines, with black gutters just like the physical board.
  context.strokeStyle = PAPER;
  context.lineWidth = 3;
  rounded(context, 17, 17, 1166, 326, 40);
  context.stroke();
  context.beginPath();
  context.moveTo(252, 18);
  context.lineTo(252, 102);
  context.lineTo(20, 102);
  context.moveTo(252, 102);
  context.lineTo(1101, 102);
  context.lineTo(1101, 258);
  context.lineTo(20, 258);
  context.stroke();

  stamp(wild ? "wild" : "mild", 116, 109, 980, 140);
  stamp("start", 76, 38, 122, 40);
  const finish = FINISH_BADGE_RECT;
  stamp("podium", finish.x, finish.y, finish.width, finish.height);
  if (!image) {
    context.fillStyle = PAPER;
    context.textAlign = "center";
    context.font = "900 65px Impact, sans-serif";
    context.fillText(wild ? "WILD WILDS" : "MILD MILE", 608, 205);
    context.font = "900 28px sans-serif";
    context.fillText(i18n.t("board.start"), 136, 70);
    context.fillText("1 / 2", 67, 190);
  }

  // The physical folding seam is subtle and never covers a tile label.
  context.fillStyle = "rgba(0,0,0,.13)";
  context.fillRect(599.5, 2, 1, 356);
  context.fillStyle = "rgba(255,255,255,.07)";
  context.fillRect(600.5, 2, .65, 356);
}

export function createBoardCanvas(track: TrackName): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = REFERENCE_BOARD.width * 2;
  canvas.height = REFERENCE_BOARD.height * 2;
  const context = canvas.getContext("2d");
  if (context) {
    context.scale(2, 2);
    drawBoardArtwork(context, track);
  }
  return canvas;
}
