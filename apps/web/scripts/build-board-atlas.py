"""Extract printed illustrations, not table/pawns, from the checked-in references.

Run with Python 3 + Pillow + NumPy. The runtime rebuilds the grid and borders
from trackLayout.ts; this atlas contains only the original printed artwork.
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "apps/web/public/assets/boards"
OUTPUT.mkdir(parents=True, exist_ok=True)
photos = {name: Image.open(ROOT / f"docs/{name}.png").convert("RGB")
          for name in ("mildmile", "wildwilds")}
atlas = Image.new("RGBA", (2048, 1024))
regions = {}


def extract(name, source, quad, destination, size, clean_black=False, transparent_blue=False,
            transparent_red=False):
    # Pillow QUAD order: top left, bottom left, bottom right, top right.
    patch = photos[source].transform(size, Image.Transform.QUAD, quad,
                                     Image.Resampling.BICUBIC).convert("RGBA")
    pixels = np.array(patch)
    if clean_black:
        dark = pixels[:, :, :3].max(axis=2) < 67
        pixels[dark, :3] = [29, 30, 33]
    if transparent_blue:
        blue = pixels[:, :, 2].astype(float) > pixels[:, :, 0] * 1.12
        pixels[blue, 3] = 0
    if transparent_red:
        red = ((pixels[:, :, 0].astype(float) > pixels[:, :, 1] * 1.4)
               & (pixels[:, :, 0].astype(float) > pixels[:, :, 2] * 1.6))
        pixels[red, 3] = 0
    atlas.paste(Image.fromarray(pixels), destination)
    regions[name] = [*destination, *size]


extract("mild", "mildmile", (191, 138, 162, 258, 1220, 258, 1184, 138),
        (0, 0), (1960, 280), clean_black=True)
extract("wild", "wildwilds", (181, 163, 144, 295, 1346, 295, 1311, 163),
        (0, 288), (1960, 280), clean_black=True)
extract("podium", "wildwilds", (66, 176, 38, 294, 135, 294, 158, 176),
        (0, 580), (164, 232), clean_black=True)
extract("start", "mildmile", (162, 76, 157, 120, 291, 120, 292, 76),
        (170, 580), (268, 88), transparent_blue=True)

# Corners follow each printed tile, correcting the oblique camera angle.
special = {
    1: (360, 88, 347, 150, 439, 150, 446, 88),
    5: (710, 91, 708, 152, 789, 152, 786, 91),
    7: (879, 92, 883, 153, 957, 153, 949, 92),
    11: (1223, 93, 1237, 151, 1312, 151, 1294, 93),
    13: (1327, 157, 1345, 222, 1414, 222, 1392, 157),
    16: (1263, 312, 1281, 383, 1380, 383, 1356, 312),
    17: (1178, 311, 1191, 382, 1278, 382, 1260, 311),
    23: (611, 310, 604, 380, 696, 380, 700, 310),
    24: (518, 310, 508, 380, 602, 380, 609, 310),
    26: (328, 310, 310, 379, 408, 379, 421, 310),
}
for index, (step, quad) in enumerate(special.items()):
    extract(f"tile-{step}", "wildwilds", quad,
            (460 + index * 150, 580), (144, 144))

for index, (step, box) in enumerate({
    5: (673, 83, 704, 116), 10: (1046, 82, 1095, 118),
    15: (1253, 283, 1313, 318), 20: (829, 282, 887, 319),
    25: (413, 283, 469, 321),
}.items()):
    x0, y0, x1, y1 = box
    extract(f"number-{step}", "mildmile", (x0, y0, x0, y1, x1, y1, x1, y0),
            (460 + index * 150, 750), ((x1 - x0) * 2, (y1 - y0) * 2), transparent_red=True)

atlas.save(OUTPUT / "print-atlas.webp", quality=94, method=6)
(ROOT / "apps/web/src/components/race3d/boardAtlas.json").write_text(
    json.dumps(regions, indent=2) + "\n")
print(f"Generated {OUTPUT / 'print-atlas.webp'}")
