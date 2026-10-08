"""An evening's Luma cover: square, typographic, from its facts.

The foundations want covers "typographic: lockup, neighborhood, date, host,
short link", "generated from event data, never hand-assembled" (Imagery),
in the event's mode (Color). This is that template, in the Swiss Index
direction the site's home is built on: a ledger of rules, flush left on the
12-column grid, the lockup as the headline and the neighborhood as the
second voice.

    TUE OCT 27          6:00 PM                2026   (meta, Geist Mono)
    ───────────────────────────────────────────────── (rule)
    allthings/                                        (lockup, Archivo 800)
    trivia_

    ───────────────────────────────────────────────── (rule)
    EAST CUT                                          (label, Archivo 700 75%)
    HOSTED AT CODERABBIT                              (meta)
    ───────────────────────────────────────────────── (rule)
    allthings.dev/trivia                          a/  (meta and the mark)

Every word comes from the facts, so no two evenings' covers are alike: the
topic, its date and time, its neighborhood, who hosts it (or, with no
host on record, the venue's name) and its link. Luma
asks for a square cover of at least 800px (help.luma.com, "Event cover
images"); this one is laid out on a 1200-unit square and drawn at
{PIXELS}px.

    uv run cover.py --out cover.png < facts.json

The facts are JSON (core/src/cover.ts writes them):

    {"mode": "night", "topic": "trivia", "name": "allthings/trivia",
     "ahead": true, "date": "Tue Oct 27", "time": "6:00 PM", "year": "2026",
     "neighborhood": "East Cut", "hosts": "CodeRabbit", "venue": "CodeRabbit",
     "link": "allthings.dev/trivia"}

`topic` is null for a name that yields none; the name is then set as
written. `neighborhood`, `hosts` and `venue` are null when unknown, and their row
says only what is known. The same facts make the same pixels.
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import resvg_py
from generate import MONO_CACHE, MONO_SHA256, MONO_URL, TOKENS, hex_color_of, load_font
from og import GRAIN, Setter, Span, Style, palette

SIZE = 1200
PIXELS = 1600
MARGIN = 84
MEASURE = SIZE - 2 * MARGIN
# The grid's columns, as the layout tokens cut a page: 12, with 24 gutters.
GUTTER = 24
COLUMN = (MEASURE - 11 * GUTTER) / 12
RULE = 2

META = Style("mono", 500, 100, 28, 0.06, caps=True)
LINK = Style("mono", 500, 100, 28, 0.0)
MARK = Style("archivo", 800, 112, 64, -0.05)
# The lockup and the neighborhood are as large as fits, largest first.
LOCKUP_SIZES = (176, 160, 144, 128, 112, 96, 84, 72)
LABEL_SIZES = (128, 112, 96, 84, 72, 60)


def lockup_style(size: float) -> Style:
    return Style("archivo", 800, 112, size, -0.04)


def cursor_style(size: float) -> Style:
    return Style("archivo", 400, 112, size, -0.04)


def label_style(size: float) -> Style:
    return Style("archivo", 700, 75, size, -0.01, caps=True)


@dataclass(frozen=True)
class Facts:
    mode: str
    topic: str | None
    name: str
    ahead: bool
    date: str
    time: str
    year: str
    neighborhood: str | None
    hosts: str | None
    venue: str | None
    link: str

    @staticmethod
    def parse(data: dict) -> "Facts":
        facts = Facts(**data)
        if facts.mode not in ("night", "paper"):
            raise ValueError(f"mode is night or paper, not {facts.mode!r}")
        return facts


def column_x(index: int) -> float:
    """The left edge of the grid's column `index`, from 0."""
    return MARGIN + index * (COLUMN + GUTTER)


def wrap(setter: Setter, text: str, style: Style, width: float) -> list[str]:
    """Words set into lines no wider than `width`; a word too long stands alone."""
    lines: list[str] = []
    for word in text.split():
        if lines and setter.width([Span(f"{lines[-1]} {word}", "")], style) <= width:
            lines[-1] = f"{lines[-1]} {word}"
        else:
            lines.append(word)
    return lines


def fits(setter: Setter, lines: list[str], style: Style, width: float) -> bool:
    return all(setter.width([Span(line, "")], style) <= width for line in lines)


def cut(setter: Setter, text: str, style: Style, width: float) -> str:
    """`text`, cut to fit `width` with an ellipsis if it doesn't."""
    if fits(setter, [text], style, width):
        return text
    while text and not fits(setter, [f"{text}…"], style, width):
        text = text[:-1]
    return f"{text.rstrip()}…"


def cover_svg(setter: Setter, colors: dict[str, str], facts: Facts) -> str:
    night = facts.mode == "night"
    p = palette(colors, night)
    # Rules in the meta color: the Index's ledger has to read at a
    # thumbnail's size, where the site's hairline tokens would vanish.
    rule_color = p["meta"]
    parts: list[str] = []
    if night:
        parts.append(
            f"<defs>{GRAIN}</defs>"
            f'<rect width="{SIZE}" height="{SIZE}" fill="{colors["night"]}"/>'
            f'<rect width="{SIZE}" height="{SIZE}" filter="url(#grain)"/>'
        )
    else:
        parts.append(f'<rect width="{SIZE}" height="{SIZE}" fill="{colors["paper"]}"/>')

    def rule(y: float) -> None:
        parts.append(
            f'<rect x="{MARGIN}" y="{y:.0f}" width="{MEASURE}" height="{RULE}" fill="{rule_color}"/>'
        )

    def text(spans: list[Span], style: Style, x: float, baseline: float) -> None:
        parts.append(setter.draw(spans, style, x, baseline))

    def right(spans: list[Span], style: Style, baseline: float) -> None:
        text(spans, style, SIZE - MARGIN - setter.width(spans, style), baseline)

    # The index along the top: the day, the hour on the seventh column, the year.
    top = MARGIN + META.size
    text([Span(facts.date, p["meta"])], META, MARGIN, top)
    text([Span(facts.time, p["meta"])], META, column_x(6), top)
    right([Span(facts.year, p["meta"])], META, top)
    top_rule = top + 24
    rule(top_rule)

    # The foot, from the bottom up: the link beside the mark, then the place.
    foot = SIZE - MARGIN
    mark = [Span("a", p["text"]), Span("/", p["accent"])]
    link = cut(setter, facts.link, LINK, MEASURE - setter.width(mark, MARK) - GUTTER)
    text([Span(link, p["meta"])], LINK, MARGIN, foot)
    right(mark, MARK, foot)
    foot_rule = foot - MARK.size * 0.72 - 32
    rule(foot_rule)

    bottom = foot_rule - 36
    under = f"hosted at {facts.hosts}" if facts.hosts is not None else facts.venue
    if under is not None:
        text([Span(cut(setter, under, META, MEASURE), p["meta"])], META, MARGIN, bottom)
        bottom -= META.size + 28
    if facts.neighborhood is not None:
        size = next(
            (
                s
                for s in LABEL_SIZES
                if fits(setter, [facts.neighborhood], label_style(s), MEASURE)
            ),
            LABEL_SIZES[-1],
        )
        place = cut(setter, facts.neighborhood, label_style(size), MEASURE)
        text([Span(place, p["place"])], label_style(size), MARGIN, bottom)
        bottom -= size * 0.72
    # Neither known: no empty row between two rules, the foot's rule serves.
    if facts.neighborhood is None and under is None:
        place_rule = foot_rule
    else:
        place_rule = bottom - 40
        rule(place_rule)

    # The lockup stands on the place's rule: allthings/ over the topic, with
    # the cursor while the evening is ahead; or the name, as written. What
    # is left above it, under the index, stays open.
    words = facts.topic if facts.topic is not None else facts.name
    rows_allowed = 2 if facts.topic is not None else 3
    room = place_rule - top_rule - 56 - 40
    for size in LOCKUP_SIZES:
        style = lockup_style(size)
        cursor = setter.width([Span("_", "")], cursor_style(size))
        lines = wrap(setter, words, style, MEASURE - cursor)
        head = 1 if facts.topic is not None else 0
        rows = head + len(lines)
        height = size * 0.72 + (rows - 1) * size * 0.9
        if (
            len(lines) <= rows_allowed
            and fits(setter, lines, style, MEASURE - cursor)
            and (head == 0 or fits(setter, ["allthings/"], style, MEASURE))
            and height <= room
        ):
            break
    # At the smallest size, what still doesn't fit is cut, never overflows.
    if len(lines) > rows_allowed:
        lines = lines[:rows_allowed]
        lines[-1] = f"{lines[-1]}…"
    lines = [cut(setter, line, style, MEASURE - cursor) for line in lines]
    rows = head + len(lines)
    left = MARGIN - size * 0.04
    # Room under the last baseline for descenders (g, p, y) and the cursor.
    baseline = place_rule - size * 0.3 - 24 - (rows - 1) * size * 0.9
    if facts.topic is not None:
        text([Span("allthings", p["text"]), Span("/", p["accent"])], style, left, baseline)
        baseline += size * 0.9
    for index, line in enumerate(lines):
        text([Span(line, p["text"])], style, left, baseline)
        if facts.ahead and index == len(lines) - 1:
            x = left + setter.width([Span(f"{line}", "")], style) + style.tracking_em * size
            text([Span("_", p["accent"])], cursor_style(size), x, baseline)
        baseline += size * 0.9

    title = (facts.topic and f"allthings/{facts.topic}") or facts.name
    label = " · ".join(
        part
        for part in (title, f"{facts.date} {facts.year}", facts.neighborhood, under)
        if part
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {SIZE} {SIZE}" width="{PIXELS}" height="{PIXELS}" '
        f'role="img" aria-label="{html.escape(label)}"><title>{html.escape(label)}</title>'
        f'{"".join(parts)}</svg>\n'
    )


def faces() -> dict[str, bytes]:
    return {"archivo": load_font(), "mono": load_font(MONO_URL, MONO_SHA256, MONO_CACHE)}


def colors() -> dict[str, str]:
    return {
        name: hex_color_of(name)
        for name in json.loads(TOKENS.read_text())["color"]
        if name != "$type"
    }


def render(facts: Facts, setter: Setter | None = None, pixels: int = PIXELS) -> bytes:
    svg = cover_svg(setter or Setter(faces()), colors(), facts)
    return bytes(resvg_py.svg_to_bytes(svg_string=svg, width=pixels, height=pixels))


# Two past evenings' covers, one in each mode, written beside the template
# by generate.py (and held to it by --check), at Luma's smallest size.
SPECIMENS = {
    "specimen-night.png": Facts(
        mode="night",
        topic="effect",
        name="Effect San Francisco",
        ahead=False,
        date="Wed Sep 30",
        time="5:30 PM",
        year="2026",
        neighborhood="East Cut",
        hosts="CodeRabbit",
        venue="CodeRabbit",
        link="allthings.dev/effect",
    ),
    "specimen-paper.png": Facts(
        mode="paper",
        topic="open source hackathon",
        name="Open Source Hackathon",
        ahead=False,
        date="Sat Oct 5",
        time="11:30 AM",
        year="2024",
        neighborhood="FiDi",
        hosts="Sentry",
        venue="Sentry, SF",
        link="allthings.dev/open-source-hackathon",
    ),
}
SPECIMEN_PIXELS = 800


def main() -> None:
    parser = argparse.ArgumentParser(description="Draws an evening's Luma cover.")
    parser.add_argument("--out", required=True, type=Path, help="where to write the PNG")
    args = parser.parse_args()
    try:
        facts = Facts.parse(json.load(sys.stdin))
    except (TypeError, ValueError) as error:
        sys.exit(f"Not a cover's facts: {error}")
    args.out.write_bytes(render(facts))


if __name__ == "__main__":
    main()
