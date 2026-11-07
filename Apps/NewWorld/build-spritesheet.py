#!/usr/bin/env python3
"""Extract four directional views from New World building sheets and pack atlas pages."""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

CATEGORIES = ("houses", "restaurants", "stores", "village", "watertower")
SHEET_COLUMNS = 8
SHEET_ROWS = 4
ORIENTATION_FRAMES = (0, 8, 16, 24)
PADDING = 3
SUFFIX = "_16bit.png"
MAX_ATLAS_SIZE = 4096


@dataclass
class Sprite:
    category: str
    source_path: Path
    key: str
    image: Image.Image
    width: int
    height: int
    orientation: int
    source_frame: int
    page: int = -1
    x: int = 0
    y: int = 0


@dataclass
class AtlasPage:
    image: Image.Image
    x: int = PADDING
    y: int = PADDING
    row_height: int = 0
    used_width: int = 0


def parse_args() -> argparse.Namespace:
    project_root = Path(__file__).resolve().parents[2]
    default_assets = Path(
        os.environ.get("NEW_WORLD_ASSETS_DIR", project_root.parent / "NewWorld-Assets")
    )
    default_output = project_root / "docs" / "Apps" / "NewWorld" / "assets"

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--asset-root",
        type=Path,
        default=default_assets,
        help="Local checkout of the private belfegor442/NewWorld-Assets repository",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help="Generated atlas directory served by the New World web client",
    )
    parser.add_argument("--max-size", type=int, default=MAX_ATLAS_SIZE)
    return parser.parse_args()


def collect_sprites(asset_root: Path) -> list[Sprite]:
    if not asset_root.is_dir():
        raise FileNotFoundError(
            f"Asset repository not found: {asset_root}. Clone belfegor442/NewWorld-Assets first."
        )

    sprites: list[Sprite] = []
    source_count = 0

    for category in CATEGORIES:
        folder = asset_root / category
        if not folder.is_dir():
            continue

        for path in sorted(folder.glob(f"*{SUFFIX}")):
            if "_dither" in path.name:
                continue

            with Image.open(path) as source:
                sheet = source.convert("RGBA")

            width, height = sheet.size
            if width % SHEET_COLUMNS != 0 or height % SHEET_ROWS != 0:
                raise ValueError(
                    f"Unexpected sheet grid in {path}: {width}x{height} "
                    f"is not divisible by {SHEET_COLUMNS}x{SHEET_ROWS}"
                )

            frame_width = width // SHEET_COLUMNS
            frame_height = height // SHEET_ROWS
            base_name = path.name[:-len(SUFFIX)]
            source_count += 1

            for orientation, frame_index in enumerate(ORIENTATION_FRAMES):
                column = frame_index % SHEET_COLUMNS
                row = frame_index // SHEET_COLUMNS
                left = column * frame_width
                top = row * frame_height
                frame = sheet.crop(
                    (left, top, left + frame_width, top + frame_height)
                )

                key = f"{category}/{base_name}/orientation-{orientation}"
                sprites.append(
                    Sprite(
                        category=category,
                        source_path=path,
                        key=key,
                        image=frame,
                        width=frame.width,
                        height=frame.height,
                        orientation=orientation,
                        source_frame=frame_index,
                    )
                )

    if not sprites:
        raise RuntimeError("No *_16bit.png spritesheets found in the expected folders.")

    print(
        f"Read {source_count} source sheets; extracted "
        f"{len(sprites)} directional frames ({len(ORIENTATION_FRAMES)} per sheet)."
    )
    return sprites


def pack_sprites(sprites: list[Sprite], max_size: int) -> list[AtlasPage]:
    if not 512 <= max_size <= 8192:
        raise ValueError("--max-size must be between 512 and 8192 pixels")

    pages: list[AtlasPage] = []
    ordered = sorted(
        sprites,
        key=lambda sprite: (
            max(sprite.width, sprite.height),
            sprite.height,
            sprite.width,
        ),
        reverse=True,
    )

    for sprite in ordered:
        if (
            sprite.width + PADDING * 2 > max_size
            or sprite.height + PADDING * 2 > max_size
        ):
            raise ValueError(f"Sprite exceeds atlas dimensions: {sprite.source_path}")

        placed = False
        for page_index, page in enumerate(pages):
            x, y, row_height = page.x, page.y, page.row_height
            if x + sprite.width + PADDING > max_size:
                x = PADDING
                y += row_height + PADDING
                row_height = 0

            if y + sprite.height + PADDING <= max_size:
                sprite.page = page_index
                sprite.x = x
                sprite.y = y
                page.x = x + sprite.width + PADDING
                page.y = y
                page.row_height = max(row_height, sprite.height)
                page.used_width = max(
                    page.used_width, x + sprite.width + PADDING
                )
                page.image.alpha_composite(sprite.image, (x, y))
                placed = True
                break

        if not placed:
            page = AtlasPage(
                Image.new("RGBA", (max_size, max_size), (0, 0, 0, 0))
            )
            sprite.page = len(pages)
            sprite.x = PADDING
            sprite.y = PADDING
            page.x = sprite.x + sprite.width + PADDING
            page.y = sprite.y
            page.row_height = sprite.height
            page.used_width = sprite.x + sprite.width + PADDING
            page.image.alpha_composite(sprite.image, (sprite.x, sprite.y))
            pages.append(page)

    return pages


def write_output(
    sprites: list[Sprite],
    pages: list[AtlasPage],
    output: Path,
    max_size: int,
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)

    # Remove only atlas pages generated by this builder, including stale pages
    # left over from an earlier build that used a different number of sheets.
    for old_page in output.glob("spritesheet-*.png"):
        old_page.unlink()

    page_names: list[str] = []
    for index, page in enumerate(pages, start=1):
        used_width = min(max_size, max(PADDING * 2, page.used_width))
        used_height = min(max_size, page.y + page.row_height + PADDING)
        filename = f"spritesheet-{index:02d}.png"
        page.image.crop((0, 0, used_width, used_height)).save(
            output / filename, optimize=True
        )
        page_names.append(filename)

    manifest_sprites: dict[str, dict[str, Any]] = {}
    for sprite in sorted(sprites, key=lambda item: item.key):
        manifest_sprites[sprite.key] = {
            "key": sprite.key,
            "category": sprite.category,
            "page": sprite.page,
            "x": sprite.x,
            "y": sprite.y,
            "width": sprite.width,
            "height": sprite.height,
            "orientation": sprite.orientation,
            "sourceFrame": sprite.source_frame,
            "sourceSheet": sprite.source_path.name,
        }

    manifest = {
        "schemaVersion": 2,
        "variant": "16bit-four-directional-views",
        "sourceSheetLayout": {
            "columns": SHEET_COLUMNS,
            "rows": SHEET_ROWS,
            "extractedFrames": list(ORIENTATION_FRAMES),
        },
        "pages": page_names,
        "sprites": manifest_sprites,
    }

    manifest_path = output / "sprite-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> int:
    args = parse_args()
    try:
        sprites = collect_sprites(args.asset_root.resolve())
        pages = pack_sprites(sprites, args.max_size)
        manifest = write_output(
            sprites, pages, args.output.resolve(), args.max_size
        )
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    total_bytes = sum(
        path.stat().st_size for path in args.output.glob("spritesheet-*.png")
    )
    print(
        f"Packed {len(manifest['sprites'])} directional sprites into "
        f"{len(manifest['pages'])} atlas page(s)."
    )
    print(f"Atlas PNG total: {total_bytes:,} bytes")
    print(f"Output: {args.output.resolve()}")
    print(f"Manifest: {args.output.resolve() / 'sprite-manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
