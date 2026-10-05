"""Generates the all things/_ marks as SVG outlines and PNG icons.

The marks are set in Archivo (SIL Open Font License), shaped with HarfBuzz so
kerning matches the browser, and written as plain SVG paths: no font is
needed to display them. Colors and the wordmark's type settings come from
the design tokens, so the marks stay in step with the rest of the brand.

    uv run generate.py          # write the marks to app/public/brand
    uv run generate.py --check  # fail if the committed marks are stale
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import resvg_py
from og import build_og
import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from PIL import IcoImagePlugin, Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOKENS = ROOT / "brand/all-things.tokens.json"
OUT = ROOT / "app/public/brand"
# Link-preview cards and what the Worker draws event cards with (og.py).
OG_OUT = ROOT / "brand/og"

# Archivo variable font, pinned to a google/fonts commit and verified by hash.
FONT_URL = (
    "https://github.com/google/fonts/raw/6c70c829f09ea345d3590406693220ea35c6553f"
    "/ofl/archivo/Archivo%5Bwdth%2Cwght%5D.ttf"
)
FONT_SHA256 = "0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053"
FONT_CACHE = HERE / ".cache/Archivo[wdth,wght].ttf"

# Geist Mono, for meta on link-preview cards, pinned the same way.
MONO_URL = (
    "https://github.com/google/fonts/raw/9e25e2ba265e5298f70f6182dd4e8a3ebf1b9123"
    "/ofl/geistmono/GeistMono%5Bwght%5D.ttf"
)
MONO_SHA256 = "d00e590b8eb3a59acc329b2d044fd143ae935090b7da33199ebee27cc7de8196"
MONO_CACHE = HERE / ".cache/GeistMono[wght].ttf"

# The cursor is the regular-weight underscore, as on the site.
CURSOR_WEIGHT = 400
# The a/ mark is set a little tighter than the wordmark.
MARK_TRACKING_EM = -0.05
# Share of the tile width taken by the a/ ink: roomy for app icons, nearly
# full for favicons so it reads at 16px.
ICON_INK_WIDTH = 0.5
FAVICON_INK_WIDTH = 0.84
# Favicons use the heaviest weight so the slash survives at 16px.
FAVICON_WEIGHT = 900
# The blank avatar for people and hosts without a photo or logo: the
# wordmark's tail, "/_", the slot still open.
AVATAR_INK_WIDTH = 0.46
# Maskable icons keep their content inside a centered circle of 80% diameter.
MASKABLE_SAFE_RADIUS = 0.4

TILE = 1000
ICON_SIZES = {"icon-16.png": 16, "icon-32.png": 32}
LARGE_ICON_SIZES = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}
ICO_SIZES = (16, 32, 48)


@dataclass(frozen=True)
class Brand:
    colors: dict[str, str]
    weight: int
    width: float
    tracking_em: float
    font_size: float
    cursor_blink_ms: float


def hex_color_of(name: str) -> str:
    components = json.loads(TOKENS.read_text())["color"][name]["$value"]["components"]
    return "#" + "".join(f"{round(c * 255):02X}" for c in components)


def load_brand() -> Brand:
    tokens = json.loads(TOKENS.read_text())

    def hex_color(name: str) -> str:
        components = tokens["color"][name]["$value"]["components"]
        return "#" + "".join(f"{round(c * 255):02X}" for c in components)

    wordmark = tokens["type"]["wordmark"]
    settings = wordmark["$extensions"]["dev.allthings"]
    return Brand(
        colors={
            name: hex_color(name)
            for name in ("paper", "ink", "bridge", "night", "glow")
        },
        weight=wordmark["$value"]["fontWeight"],
        width=float(settings["width"].rstrip("%")),
        tracking_em=settings["letterSpacingEm"],
        font_size=wordmark["$value"]["fontSize"]["value"],
        cursor_blink_ms=tokens["motion"]["cursorBlink"]["$value"]["value"],
    )


def load_font(
    url: str = FONT_URL, sha256: str = FONT_SHA256, cache: Path = FONT_CACHE
) -> bytes:
    if not cache.exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            cache.write_bytes(response.read())
    data = cache.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha256:
        cache.unlink()
        sys.exit(f"{cache.name} download has sha256 {digest}, expected {sha256}")
    return data


@dataclass(frozen=True)
class Run:
    text: str
    weight: int
    role: str  # "text" or "accent", mapped to colors per variant
    cursor: bool = False


@dataclass(frozen=True)
class Placed:
    font: hb.Font
    glyph: int
    x: float
    role: str
    cursor: bool


class Typesetter:
    def __init__(self, data: bytes, width: float):
        self.face = hb.Face(hb.Blob(data))
        self.upem = self.face.upem
        self.width = width
        self.fonts: dict[int, hb.Font] = {}

    def font(self, weight: int) -> hb.Font:
        if weight not in self.fonts:
            font = hb.Font(self.face)
            font.set_variations({"wght": weight, "wdth": self.width})
            self.fonts[weight] = font
        return self.fonts[weight]

    def set(self, runs: list[Run], tracking_em: float) -> list[Placed]:
        """Lays runs out on one line, like CSS letter-spacing on a span."""
        placed: list[Placed] = []
        x = 0.0
        for run in runs:
            font = self.font(run.weight)
            buf = hb.Buffer()
            buf.add_str(run.text)
            buf.guess_segment_properties()
            hb.shape(font, buf, {"kern": True, "liga": True})
            for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
                placed.append(
                    Placed(font, info.codepoint, x + pos.x_offset, run.role, run.cursor)
                )
                x += pos.x_advance + tracking_em * self.upem
        return placed


Transform = tuple[float, float, float, float, float, float]


def glyph_transform(scale: float, dx: float, dy: float, x: float) -> Transform:
    # Font units point up; SVG units point down.
    return (scale, 0, 0, -scale, dx + x * scale, dy)


def ink_bounds(placed: list[Placed]) -> tuple[float, float, float, float]:
    """Ink box in SVG orientation (y down), with the baseline at y = 0."""
    pen = BoundsPen(None)
    for glyph in placed:
        glyph.font.draw_glyph_with_pen(
            glyph.glyph, TransformPen(pen, glyph_transform(1, 0, 0, glyph.x))
        )
    assert pen.bounds is not None
    return pen.bounds


def number(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


def paths(
    placed: list[Placed], colors: dict[str, str], scale: float, dx: float, dy: float
) -> str:
    groups: dict[tuple[str, bool], SVGPathPen] = {}
    for glyph in placed:
        pen = groups.setdefault(
            (glyph.role, glyph.cursor), SVGPathPen(None, ntos=number)
        )
        glyph.font.draw_glyph_with_pen(
            glyph.glyph, TransformPen(pen, glyph_transform(scale, dx, dy, glyph.x))
        )
    elements = []
    for (role, cursor), pen in groups.items():
        cls = ' class="cursor"' if cursor else ""
        elements.append(f'<path{cls} fill="{colors[role]}" d="{pen.getCommands()}"/>')
    return "".join(elements)


def svg(
    body: str,
    width: float,
    height: float,
    title: str,
    *,
    pixel_width: float,
    style: str = "",
) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {number(width)} {number(height)}" '
        f'width="{number(pixel_width)}" height="{number(pixel_width * height / width)}" '
        f'role="img" aria-label="{title}">'
        f"<title>{title}</title>{style}{body}</svg>\n"
    )


def blink_style(ms: float) -> str:
    return (
        "<style>"
        f".cursor{{animation:blink {number(ms)}ms steps(1) infinite}}"
        "@keyframes blink{50%{opacity:0}}"
        "@media (prefers-reduced-motion:reduce){.cursor{animation:none}}"
        "</style>"
    )


def text_svg(
    placed: list[Placed],
    colors: dict[str, str],
    title: str,
    pixel_scale: float,
    style: str = "",
) -> str:
    """A tight crop of the ink, sized as if set at the token font size."""
    x0, y0, x1, y1 = ink_bounds(placed)
    body = paths(placed, colors, 1, -x0, -y0)
    return svg(
        body, x1 - x0, y1 - y0, title, pixel_width=(x1 - x0) * pixel_scale, style=style
    )


def tile_svg(
    placed: list[Placed],
    colors: dict[str, str],
    ground: str,
    ink_width: float,
    title: str,
    center_y: float = 0.5,
) -> str:
    x0, y0, x1, y1 = ink_bounds(placed)
    scale = TILE * ink_width / (x1 - x0)
    dx = (TILE - (x1 - x0) * scale) / 2 - x0 * scale
    dy = TILE * center_y - (y0 + y1) / 2 * scale
    background = f'<rect width="{TILE}" height="{TILE}" fill="{ground}"/>'
    return svg(
        background + paths(placed, colors, scale, dx, dy),
        TILE,
        TILE,
        title,
        pixel_width=512,
    )


def check_maskable(placed: list[Placed], ink_width: float) -> None:
    x0, y0, x1, y1 = ink_bounds(placed)
    scale = ink_width / (x1 - x0)
    half_diagonal = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 * scale / 2
    if half_diagonal > MASKABLE_SAFE_RADIUS:
        sys.exit(
            f"Icon ink reaches {half_diagonal:.3f} of the tile; maskable limit is {MASKABLE_SAFE_RADIUS}"
        )


def png(svg_text: str, size: int) -> bytes:
    return bytes(resvg_py.svg_to_bytes(svg_string=svg_text, width=size, height=size))


def ico(svg_text: str) -> bytes:
    largest = Image.open(io.BytesIO(png(svg_text, max(ICO_SIZES))))
    out = io.BytesIO()
    largest.save(out, format="ICO", sizes=[(s, s) for s in ICO_SIZES])
    return out.getvalue()


def build() -> dict[Path, bytes]:
    brand = load_brand()
    archivo = load_font()
    setter = Typesetter(archivo, brand.width)
    c = brand.colors
    on_paper = {"text": c["ink"], "accent": c["bridge"]}
    on_night = {"text": c["paper"], "accent": c["glow"]}

    wordmark = setter.set(
        [
            Run("all things", brand.weight, "text"),
            Run("/", brand.weight, "accent"),
            Run("_", CURSOR_WEIGHT, "accent", cursor=True),
        ],
        brand.tracking_em,
    )

    def a_slash(weight: int) -> list[Placed]:
        return setter.set(
            [Run("a", weight, "text"), Run("/", weight, "accent")], MARK_TRACKING_EM
        )

    mark = a_slash(brand.weight)
    check_maskable(mark, ICON_INK_WIDTH)

    px = brand.font_size / setter.upem
    blink = blink_style(brand.cursor_blink_ms)
    title = "all things/_"
    icon = tile_svg(mark, on_night, c["night"], ICON_INK_WIDTH, title)
    favicon = tile_svg(
        a_slash(FAVICON_WEIGHT), on_night, c["night"], FAVICON_INK_WIDTH, title
    )
    avatar = tile_svg(
        setter.set(
            [
                Run("/", brand.weight, "accent"),
                Run("_", CURSOR_WEIGHT, "accent"),
            ],
            brand.tracking_em,
        ),
        on_night,
        c["night"],
        AVATAR_INK_WIDTH,
        "No photo yet",
    )

    files: dict[str, str | bytes] = {
        "wordmark.svg": text_svg(wordmark, on_paper, title, px),
        "wordmark-night.svg": text_svg(wordmark, on_night, title, px),
        "wordmark-animated.svg": text_svg(wordmark, on_paper, title, px, blink),
        "wordmark-night-animated.svg": text_svg(wordmark, on_night, title, px, blink),
        "mark.svg": text_svg(mark, on_paper, title, px),
        "mark-night.svg": text_svg(mark, on_night, title, px),
        "icon.svg": icon,
        "avatar.svg": avatar,
        "favicon.svg": favicon,
        "favicon.ico": ico(favicon),
    }
    files.update({name: png(favicon, size) for name, size in ICON_SIZES.items()})
    files.update({name: png(icon, size) for name, size in LARGE_ICON_SIZES.items()})
    files["avatar.png"] = png(avatar, 512)
    colors = {
        name: hex_color_of(name)
        for name in json.loads(TOKENS.read_text())["color"]
        if name != "$type"
    }
    og = build_og(
        {"archivo": archivo, "mono": load_font(MONO_URL, MONO_SHA256, MONO_CACHE)},
        colors,
        lambda svg_text: bytes(resvg_py.svg_to_bytes(svg_string=svg_text)),
    )
    return {
        **{
            OUT / name: content.encode() if isinstance(content, str) else content
            for name, content in files.items()
        },
        **{OG_OUT / name: content for name, content in og.items()},
    }


def matches(path: Path, data: bytes) -> bool:
    """Images must match by pixels, since zlib builds differ; anything else
    (SVGs, fonts, metrics) exactly."""
    if not path.exists():
        return False
    if path.suffix not in (".png", ".ico"):
        return path.read_bytes() == data

    def frames(image: Image.Image) -> list[tuple[tuple[int, int], bytes]]:
        # An ICO holds one frame per size; every frame has to match.
        if isinstance(image, IcoImagePlugin.IcoImageFile):
            return [
                (size, image.ico.getimage(size).convert("RGBA").tobytes())
                for size in sorted(image.ico.sizes())
            ]
        return [(image.size, image.convert("RGBA").tobytes())]

    return frames(Image.open(path)) == frames(Image.open(io.BytesIO(data)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generates the all things/_ marks.")
    parser.add_argument(
        "--check", action="store_true", help="fail if committed marks are stale"
    )
    args = parser.parse_args()

    files = build()
    if args.check:
        stale = [
            str(path.relative_to(ROOT))
            for path, data in files.items()
            if not matches(path, data)
        ]
        if stale:
            sys.exit(f"Stale marks: {', '.join(stale)}. Run `uv run generate.py`.")
        print(f"{len(files)} marks are up to date")
        return

    for path, data in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    print(f"Wrote {len(files)} marks to app/public/brand and brand/og")


if __name__ == "__main__":
    main()
