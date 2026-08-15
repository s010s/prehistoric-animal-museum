#!/usr/bin/env python3
"""Remove the review-only magenta key from the authored far-tree atlas.

The image model supplies the botanical silhouettes.  This deterministic pass
only converts its flat chroma backing into an alpha-tested runtime texture and
decontaminates antialiased edge pixels so distant trees do not acquire a pink
fringe in fog.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def smoothstep(start: float, end: float, value: float) -> float:
    progress = max(0.0, min(1.0, (value - start) / (end - start)))
    return progress * progress * (3.0 - 2.0 * progress)


def prepare(source: Path, destination: Path) -> None:
    image = Image.open(source).convert("RGBA")
    source_pixels = image.load()
    output = Image.new("RGBA", image.size)
    output_pixels = output.load()
    # Median background observed in the generated chroma plate.  Exact colour
    # matching is intentionally avoided because the generator leaves a few
    # low-amplitude compression/illumination variations in the flat field.
    background = (240.0, 12.0, 207.0)

    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, _ = source_pixels[x, y]
            magenta_energy = float(min(red, blue))
            magenta_dominance = float(min(red, blue) - green)
            key_strength = smoothstep(25.0, 72.0, magenta_dominance) * smoothstep(
                104.0, 178.0, magenta_energy
            )
            alpha = max(0.0, min(1.0, 1.0 - key_strength))

            if alpha <= 0.015:
                output_pixels[x, y] = (0, 0, 0, 0)
                continue

            # Undo the chroma contribution in partially covered edge pixels.
            if alpha < 0.985:
                edge_alpha = max(alpha, 0.08)
                red = round((red - background[0] * (1.0 - edge_alpha)) / edge_alpha)
                green = round(
                    (green - background[1] * (1.0 - edge_alpha)) / edge_alpha
                )
                blue = round(
                    (blue - background[2] * (1.0 - edge_alpha)) / edge_alpha
                )

            output_pixels[x, y] = (
                max(0, min(255, red)),
                max(0, min(255, green)),
                max(0, min(255, blue)),
                round(alpha * 255),
            )

    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    arguments = parser.parse_args()
    prepare(arguments.source, arguments.destination)


if __name__ == "__main__":
    main()
