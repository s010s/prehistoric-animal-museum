#!/usr/bin/env python3
"""Normalize the reviewed 4x2 mature-tree cutouts into a runtime atlas.

The ImageGen source deliberately keeps one complete root-to-tip silhouette in
each cell.  This deterministic pass removes the residual low-alpha studio
matte, preserves the antialiased foliage edge, and bottom-aligns every real
root flare.  Runtime geometry can therefore use the texture's true bottom as
the same world-space terrain contact plane used by all other ecology layers.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


SOURCE_COLUMNS = 4
SOURCE_ROWS = 2
DEFAULT_CELL_SIZE = 512
ALPHA_FLOOR = 22


def clean_alpha(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    # ImageGen's background extraction leaves a very low-alpha olive studio
    # wash.  Alpha-tested foliage must not retain that wash because its mip
    # chain would otherwise become a rectangular haze around every tree.
    cleaned = alpha.point(
        lambda value: 0
        if value <= ALPHA_FLOOR
        else min(255, round((value - ALPHA_FLOOR) * 255 / (254 - ALPHA_FLOOR)))
    )
    rgba.putalpha(cleaned)
    return rgba


def fit_cell(
    source: Image.Image,
    column: int,
    row: int,
    cell_size: int,
) -> Image.Image:
    left = round(source.width * column / SOURCE_COLUMNS)
    right = round(source.width * (column + 1) / SOURCE_COLUMNS)
    top = round(source.height * row / SOURCE_ROWS)
    bottom = round(source.height * (row + 1) / SOURCE_ROWS)
    panel = clean_alpha(source.crop((left, top, right, bottom)))
    bounds = panel.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError(f"tree cell {column},{row} has no visible pixels")
    panel = panel.crop(bounds)
    padding_x = max(7, round(cell_size * 14 / 512))
    padding_top = max(5, round(cell_size * 10 / 512))
    padding_bottom = max(4, round(cell_size * 8 / 512))
    maximum_width = cell_size - padding_x * 2
    maximum_height = cell_size - padding_top - padding_bottom
    scale = min(maximum_width / panel.width, maximum_height / panel.height)
    target_size = (
        max(1, round(panel.width * scale)),
        max(1, round(panel.height * scale)),
    )
    panel = panel.resize(target_size, Image.Resampling.LANCZOS)
    # Lanczos can reintroduce tiny non-zero alpha values outside the cutout.
    panel = clean_alpha(panel)
    cell = Image.new("RGBA", (cell_size, cell_size), (0, 0, 0, 0))
    x = (cell_size - panel.width) // 2
    y = cell_size - padding_bottom - panel.height
    cell.alpha_composite(panel, (x, y))
    return cell


def checker_preview(atlas: Image.Image, path: Path) -> None:
    checker = Image.new("RGB", atlas.size, (230, 230, 230))
    draw = ImageDraw.Draw(checker)
    checker_size = 32
    for y in range(0, atlas.height, checker_size):
        for x in range(0, atlas.width, checker_size):
            colour = (190, 190, 190) if (x // checker_size + y // checker_size) % 2 else (238, 238, 238)
            draw.rectangle(
                (x, y, x + checker_size - 1, y + checker_size - 1),
                fill=colour,
            )
    checker.paste(atlas, (0, 0), atlas)
    path.parent.mkdir(parents=True, exist_ok=True)
    checker.save(path, "PNG", optimize=True)


def prepare(
    source_path: Path,
    output_path: Path,
    preview_path: Path | None,
    cell_size: int,
) -> None:
    source = Image.open(source_path).convert("RGBA")
    atlas = Image.new(
        "RGBA",
        (cell_size * SOURCE_COLUMNS, cell_size * SOURCE_ROWS),
        (0, 0, 0, 0),
    )
    for row in range(SOURCE_ROWS):
        for column in range(SOURCE_COLUMNS):
            atlas.alpha_composite(
                fit_cell(source, column, row, cell_size),
                (column * cell_size, row * cell_size),
            )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output_path, "WEBP", quality=92, method=6, exact=True)
    if preview_path is not None:
        checker_preview(atlas, preview_path)
    histogram = atlas.getchannel("A").histogram()
    opaque = sum(histogram[220:]) / (atlas.width * atlas.height)
    transparent = histogram[0] / (atlas.width * atlas.height)
    print(
        f"wrote {output_path} ({atlas.width}x{atlas.height}, "
        f"{opaque:.1%} opaque, {transparent:.1%} fully transparent)"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preview", type=Path)
    parser.add_argument("--cell-size", type=int, default=DEFAULT_CELL_SIZE)
    args = parser.parse_args()
    if args.cell_size < 128 or args.cell_size > 1024:
        parser.error("--cell-size must be between 128 and 1024")
    prepare(args.source, args.output, args.preview, args.cell_size)


if __name__ == "__main__":
    main()
