#!/usr/bin/env python3
"""Prepare a compact alpha-tested midground vegetation atlas.

The source is a three-column RGBA sprite sheet (conifer crown, tree fern,
cycad).  This tool removes chroma-key residue, normalises each silhouette into
an equal square cell, and appends a deterministic bark cell used by the real
3D trunks.  Keeping this transformation repeatable makes the browser asset
reviewable without baking hand-edited masks into the source image.
"""

from __future__ import annotations

import argparse
import random
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


CELL_SIZE = 512
FOLIAGE_CELLS = 3
PADDING = 18


def remove_chroma_residue(source: Image.Image) -> Image.Image:
    image = source.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            neon_green = green > 165 and green > red * 1.42 and green > blue * 1.75
            neon_yellow = red > 170 and green > 155 and blue < 88
            neon_red = red > 172 and red > green * 1.72 and blue < 105
            if neon_green or neon_yellow or neon_red:
                pixels[x, y] = (red, green, blue, 0)
                continue
            if alpha < 236:
                # Edge despill only.  Interior foliage remains untouched.
                neutral_high = max(red, blue)
                green = min(green, int(neutral_high * 1.22 + 14))
                pixels[x, y] = (red, green, blue, alpha)

    alpha = image.getchannel("A")
    # A one-pixel median pass removes isolated key flecks without blurring the
    # fine compound-leaf silhouette that makes the cards believable.
    cleaned_alpha = alpha.filter(ImageFilter.MedianFilter(3))
    image.putalpha(ImageChops.darker(alpha, cleaned_alpha))
    return image


def fit_foliage_cell(source: Image.Image, column: int) -> Image.Image:
    left = round(source.width * column / FOLIAGE_CELLS)
    right = round(source.width * (column + 1) / FOLIAGE_CELLS)
    panel = source.crop((left, 0, right, source.height))
    bounds = panel.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"foliage column {column} has no opaque pixels")
    panel = panel.crop(bounds)
    maximum_width = CELL_SIZE - PADDING * 2
    maximum_height = CELL_SIZE - PADDING * 2
    scale = min(maximum_width / panel.width, maximum_height / panel.height)
    size = (
        max(1, round(panel.width * scale)),
        max(1, round(panel.height * scale)),
    )
    panel = panel.resize(size, Image.Resampling.LANCZOS)
    cell = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    x = (CELL_SIZE - panel.width) // 2
    y = CELL_SIZE - PADDING - panel.height
    cell.alpha_composite(panel, (x, y))
    return retain_primary_silhouette(cell)


def retain_primary_silhouette(image: Image.Image) -> Image.Image:
    """Remove detached generation flecks while preserving compound leaves."""
    alpha = image.getchannel("A")
    pixels = alpha.load()
    visited = bytearray(image.width * image.height)
    components: list[list[tuple[int, int]]] = []

    for start_y in range(image.height):
        for start_x in range(image.width):
            offset = start_y * image.width + start_x
            if visited[offset] or pixels[start_x, start_y] <= 8:
                continue
            visited[offset] = 1
            queue = deque([(start_x, start_y)])
            component: list[tuple[int, int]] = []
            while queue:
                x, y = queue.popleft()
                component.append((x, y))
                for neighbour_x, neighbour_y in (
                    (x - 1, y),
                    (x + 1, y),
                    (x, y - 1),
                    (x, y + 1),
                ):
                    if not (
                        0 <= neighbour_x < image.width
                        and 0 <= neighbour_y < image.height
                    ):
                        continue
                    neighbour_offset = neighbour_y * image.width + neighbour_x
                    if (
                        visited[neighbour_offset]
                        or pixels[neighbour_x, neighbour_y] <= 8
                    ):
                        continue
                    visited[neighbour_offset] = 1
                    queue.append((neighbour_x, neighbour_y))
            components.append(component)

    if not components:
        return image
    primary = max(components, key=len)
    kept = Image.new("L", image.size, 0)
    kept_pixels = kept.load()
    for x, y in primary:
        kept_pixels[x, y] = pixels[x, y]
    output = image.copy()
    output.putalpha(kept)
    return output


def create_bark_cell(variant: int) -> Image.Image:
    randomiser = random.Random(0x6D5A17C3 + variant * 0x245)
    base = (82, 67, 49) if variant == 0 else (73, 64, 51)
    image = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (*base, 255))
    pixels = image.load()
    for y in range(CELL_SIZE):
        for x in range(CELL_SIZE):
            broad = 10 * __import__("math").sin(x * 0.057 + y * 0.006)
            fine = 5 * __import__("math").sin(x * 0.31 + y * 0.017)
            knot = 5 * __import__("math").sin((x + y * 0.12) * 0.11)
            noise = randomiser.uniform(-4.5, 4.5)
            value = broad + fine + knot + noise
            pixels[x, y] = (
                max(35, min(126, round(base[0] + 2 + value))),
                max(30, min(105, round(base[1] + 1 + value * 0.72))),
                max(24, min(82, round(base[2] + value * 0.48))),
                255,
            )
    draw = ImageDraw.Draw(image, "RGBA")
    for index in range(34):
        x = (index * 137 + 31) % CELL_SIZE
        width = 1 + index % 3
        draw.line(
            [(x, -12), (x + (index % 5) - 2, CELL_SIZE + 12)],
            fill=(28, 23, 18, 32 + index % 4 * 10),
            width=width,
        )
    return image


def prepare(
    source_path: Path,
    output_path: Path,
    variant_source_path: Path | None,
) -> None:
    sources = [remove_chroma_residue(Image.open(source_path))]
    if variant_source_path is not None:
        sources.append(remove_chroma_residue(Image.open(variant_source_path)))
    # One-source v1 remains supported. Two sources produce an 8-cell, 4096 px
    # power-of-two v2 with two silhouettes and two bark tints per species.
    bark_cell_count = 2 if len(sources) == 2 else 1
    total_cells = len(sources) * FOLIAGE_CELLS + bark_cell_count
    atlas = Image.new(
        "RGBA",
        (CELL_SIZE * total_cells, CELL_SIZE),
        (0, 0, 0, 0),
    )
    cell = 0
    for source in sources:
        for column in range(FOLIAGE_CELLS):
            atlas.alpha_composite(
                fit_foliage_cell(source, column),
                (cell * CELL_SIZE, 0),
            )
            cell += 1
    for variant in range(bark_cell_count):
        atlas.alpha_composite(create_bark_cell(variant), (cell * CELL_SIZE, 0))
        cell += 1
    output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output_path, "WEBP", quality=88, method=6, exact=True)
    opaque = sum(atlas.getchannel("A").histogram()[220:])
    print(
        f"wrote {output_path} ({atlas.width}x{atlas.height}, "
        f"{opaque / (atlas.width * atlas.height):.1%} opaque coverage)"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--variant-source", type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output, args.variant_source)


if __name__ == "__main__":
    main()
