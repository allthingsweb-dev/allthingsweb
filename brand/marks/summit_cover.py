"""AI Engineer Code Summit's co-branded cover, for allthings/aie.

AIE's organizers made allthings/aie an official community event of the
Code Summit (San Francisco, November 9 to 12, 2026), allowed community
events to use its branding and supplied its cover: the one their official
afterparty uses on Luma, kept as supplied in
brand/cobrands/aie-code-summit/cover.png and checked by SHA-256, as the
fonts are. core/src/cobrands.ts decides which evenings wear it.

This template sets an evening's facts on that art, in AIE's layout and our
lockup, square on the same 1200-unit grid as cover.py:

    [AI Engineer / Code Summit]   the art's lockup, as supplied
    [ OFFICIAL COMMUNITY EVENT ]  AIE's label (Geist Mono)
    allthings/aie ▮               our lockup (Archivo 800), AIE's cursor block
    ───────────────               the art's rule
    WED · 2026.11.11              the weekday and the day, year first
    SAN FRANCISCO, CA             the neighborhood, once the venue is known
    HOSTS  allthings/_            the master wordmark on the art's first plate

Only what changes is covered: the art's own label, title, date, place and
logos sit on black plates, so each is blacked out, and the art's lines the
plates hid are drawn again where the art shows them entering and leaving.
Four San Francisco landmarks are drawn into the art in its own thin-line and
dotted vocabulary, quiet enough to find: the Golden Gate Bridge on the
lockup box with its coordinates under it, Sutro Tower atop the tallest line,
Lombard Street's eight hairpins in a riser of the staircase and the
Transamerica Pyramid in an empty cell.

The art is AIE's, whatever the evening's mode: its cover is always on black.
"""

from __future__ import annotations

import base64
import hashlib
import sys
from typing import TYPE_CHECKING

from generate import (
    CURSOR_WEIGHT,
    ROOT,
    Run,
    Typesetter,
    ink_bounds,
    load_brand,
    load_font,
    paths,
)
from og import Setter, Span, Style

if TYPE_CHECKING:
    from cover import Facts

NAME = "AI Engineer Code Summit"
ART = ROOT / "brand/cobrands/aie-code-summit/cover.png"
ART_SHA256 = "f76b456e719bb5e6a111dfbd3bff4ce2e91fb0bb1ead2bb5b21bcaa481500d84"
SIZE = 1200

# AIE's colors, sampled from the art: its type and rules, the line work, its
# orange (the cursor block and the square in the staircase) and the quieter
# gray the landmarks' strokes are drawn in. Text is set only in white or the
# line color: the bridge's coordinates are small text, so their caption is
# in the line color, Lc 82.9 and 14.7:1 on the art's black (brand/src/
# contrast.ts), past small text's Lc 75 and WCAG 2.2 AA.
WHITE = "#FFFFFF"
LINE = "#D8D8D8"
ORANGE = "#FF570A"
QUIET = "#B4B4B4"
CAPTION = LINE

LABEL = Style("mono", 500, 100, 34, 4 / 34, caps=True)
META = Style("mono", 500, 100, 28, 3 / 28, caps=True)
HOSTS = Style("mono", 500, 100, 17, 4 / 17, caps=True)
COORDINATES = Style("mono", 500, 100, 11, 2 / 11)

# The lockup stands where the art's title stood, as large as fits before
# the staircase, largest first; AIE's cursor block follows it.
LOCKUP_X = 73
LOCKUP_BASELINE = 548
LOCKUP_SIZES = (100, 88, 76, 64, 52)
LOCKUP_RIGHT = 900
CURSOR_GAP = 0.22
CURSOR_WIDTH = 0.42
CURSOR_HEIGHT = 0.74
META_RIGHT = 670

# The art's plates over what changes: x, y, width, height.
PLATES = (
    (0, 340, 940, 215),  # its label and title
    (0, 555, 860, 60),
    (0, 615, 690, 175),  # its date and place
    (70, 1022, 175, 26),  # "CO-HOSTED BY"
    (60, 1058, 384, 74),  # its first logo
    (488, 1056, 358, 76),  # its second logo
)
# The art's lines the plates hid, entering and leaving them.
LINES = (
    (407, 1058, 1.5, 74),
    (488, 1077, 358, 1.5),
    (771, 1115, 75, 1.5),
    (771, 1056, 1.5, 76),
    (803, 1056, 1.5, 76),
)
# The master wordmark's ink box, on the first plate.
WORDMARK = (73, 1067, 279)

# The Golden Gate Bridge standing on the lockup box's top edge: its towers'
# left legs, the tops of the towers and the lowest point of the main cable,
# which sags over "AI Engineer" without touching it.
TOWERS = (150, 514)
TOWER_TOP = 24
CABLE_SAG = 58
# The box's top corners, where the side spans come down.
DECK = ((74, 82), (590, 82))
# Hangers stop short of "AI Engineer".
HANGER_GAP = (250, 412)


def _n(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _rects(rects: tuple[tuple[float, float, float, float], ...], fill: str) -> str:
    return "".join(
        f'<rect x="{_n(x)}" y="{_n(y)}" width="{_n(w)}" height="{_n(h)}" fill="{fill}"/>'
        for x, y, w, h in rects
    )


def art() -> str:
    """The art as a data URI, once it is checked to be the one supplied."""
    data = ART.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != ART_SHA256:
        sys.exit(f"{ART.name} has sha256 {digest}, expected {ART_SHA256}")
    return f"data:image/png;base64,{base64.b64encode(data).decode()}"


def golden_gate() -> str:
    left, right = TOWERS
    (x0, deck), (x1, _) = DECK
    middle = (left + right) / 2 + 5
    half = (right - left) / 2
    cable = (
        f"M{x0} {deck} Q{left - 40} 60 {left + 5} {TOWER_TOP} "
        f"Q{_n(middle)} {2 * CABLE_SAG - TOWER_TOP} {right + 5} {TOWER_TOP} "
        f"Q{right + 50} 60 {x1} {deck}"
    )

    def cable_y(x: float) -> float:
        return TOWER_TOP + (CABLE_SAG - TOWER_TOP) * (1 - ((x - middle) / half) ** 2)

    legs = "".join(
        f'<line x1="{x}" y1="{TOWER_TOP - 4}" x2="{x}" y2="{deck}"/>'
        for tower in TOWERS
        for x in (tower, tower + 10)
    )
    bars = "".join(
        f'<line x1="{tower}" y1="{y}" x2="{tower + 10}" y2="{y}"/>'
        for tower in TOWERS
        for y in (TOWER_TOP + 4, TOWER_TOP + 22, TOWER_TOP + 40)
    )
    hangers = "".join(
        f'<line x1="{x}" y1="{cable_y(x):.1f}" x2="{x}" y2="80" stroke="{QUIET}" '
        'stroke-width="0.8" stroke-dasharray="1 3"/>'
        for x in range(left + 22, right - 10, 14)
        if not HANGER_GAP[0] <= x <= HANGER_GAP[1]
    )
    return (
        f'<g fill="none" stroke="{QUIET}" stroke-width="1.2">'
        f'<path d="{cable}" stroke-dasharray="1.6 4.4" stroke-linecap="round"/>'
        f"{legs}{bars}</g>{hangers}"
    )


def sutro_tower() -> str:
    """Sutro Tower, the antenna atop the art's tallest line (x 1142, from y 135)."""
    lines = (
        (1142, 136, 1131, 92),
        (1142, 136, 1153, 92),
        (1142, 136, 1142, 88),
        (1133, 102, 1151, 102),
        (1136, 116, 1148, 116),
        (1131, 92, 1131, 80),
        (1142, 88, 1142, 74),
        (1153, 92, 1153, 80),
    )
    return (
        f'<g fill="none" stroke="{QUIET}" stroke-width="1.1">'
        + "".join(
            f'<line x1="{a}" y1="{b}" x2="{c}" y2="{d}"/>' for a, b, c, d in lines
        )
        + "</g>"
    )


def lombard_street() -> str:
    """The staircase's riser at x 652 (y 854 to 928), as eight hairpins downhill."""
    turns = " ".join(
        f"{666 if i % 2 == 0 else 652},{_n(857 + (i + 1) * 7.8)}" for i in range(8)
    )
    return (
        '<rect x="649" y="857" width="7" height="69" fill="#000"/>'
        f'<polyline fill="none" stroke="{LINE}" stroke-width="1.5" '
        f'stroke-linejoin="round" points="652,855 {turns} 652,928"/>'
    )


def transamerica_pyramid() -> str:
    """The Transamerica Pyramid, in the empty cell at x 905 to 933, y 570 to 640."""
    return (
        f'<g fill="none" stroke="{QUIET}" stroke-width="1.1">'
        '<polygon points="919,584 908,640 930,640"/>'
        '<line x1="919" y1="584" x2="919" y2="570"/>'
        '<line x1="911" y1="626" x2="905" y2="618"/>'
        '<line x1="927" y1="626" x2="933" y2="618"/></g>'
    )


def wordmark(colors: dict[str, str]) -> str:
    """allthings/_ as wordmark-night.svg sets it, scaled into its box."""
    brand = load_brand()
    placed = Typesetter(load_font(), brand.width).set(
        [
            Run("allthings", brand.weight, "text"),
            Run("/", brand.weight, "accent"),
            Run("_", CURSOR_WEIGHT, "accent"),
        ],
        brand.tracking_em,
    )
    x0, y0, x1, _ = ink_bounds(placed)
    left, top, width = WORDMARK
    scale = width / (x1 - x0)
    return paths(
        placed,
        {"text": colors["paper"], "accent": colors["glow"]},
        scale,
        left - x0 * scale,
        top - y0 * scale,
    )


def _right(setter: Setter, topic: str, size: float, ahead: bool) -> float:
    """Where the lockup, and its cursor while it is ahead, end."""
    style = lockup_style(size)
    end = LOCKUP_X + setter.width([Span(f"allthings/{topic}", "")], style)
    if ahead:
        end += (style.tracking_em + CURSOR_GAP + CURSOR_WIDTH) * size
    return end


def lockup_style(size: float) -> Style:
    return Style("archivo", 800, 112, size, -0.04)


def fit_lockup(setter: Setter, topic: str, ahead: bool) -> tuple[float, str]:
    """The largest size the lockup fits at; at the smallest, the topic cut."""
    for size in LOCKUP_SIZES:
        if _right(setter, topic, size, ahead) <= LOCKUP_RIGHT:
            return size, topic
    size = LOCKUP_SIZES[-1]
    while topic and _right(setter, f"{topic}…", size, ahead) > LOCKUP_RIGHT:
        topic = topic[:-1]
    return size, f"{topic.rstrip()}…"


def cut(setter: Setter, text: str, style: Style, width: float) -> str:
    """`text`, cut to fit `width` with an ellipsis if it doesn't."""
    if setter.width([Span(text, "")], style) <= width:
        return text
    while text and setter.width([Span(f"{text}…", "")], style) > width:
        text = text[:-1]
    return f"{text.rstrip()}…"


def summit_cover(
    setter: Setter, colors: dict[str, str], facts: Facts
) -> tuple[str, str]:
    """The cover's body on the 1200-unit square, and what it says, for its label."""
    assert facts.topic is not None and facts.cobrand is not None
    weekday = facts.date.split(" ")[0]
    place = facts.neighborhood or "San Francisco, CA"
    parts = [
        f'<image href="{art()}" width="{SIZE}" height="{SIZE}"/>',
        _rects(PLATES, "#000"),
        _rects(LINES, LINE),
        wordmark(colors),
        golden_gate(),
        setter.draw([Span("37.8199 N · 122.4783 W", CAPTION)], COORDINATES, 76, 240),
        sutro_tower(),
        lombard_street(),
        transamerica_pyramid(),
        setter.draw([Span("[ official community event ]", WHITE)], LABEL, 77, 415),
    ]

    size, topic = fit_lockup(setter, facts.topic, facts.ahead)
    style = lockup_style(size)
    lockup = [
        Span("allthings", colors["paper"]),
        Span("/", colors["glow"]),
        Span(topic, colors["paper"]),
    ]
    parts.append(setter.draw(lockup, style, LOCKUP_X, LOCKUP_BASELINE))
    if facts.ahead:
        # AIE's cursor: a block in its orange, while the evening is ahead.
        x = (
            LOCKUP_X
            + setter.width(lockup, style)
            + (style.tracking_em + CURSOR_GAP) * size
        )
        height = CURSOR_HEIGHT * size
        parts.append(
            f'<rect x="{x:.0f}" y="{LOCKUP_BASELINE - height:.0f}" '
            f'width="{CURSOR_WIDTH * size:.0f}" height="{height:.0f}" fill="{ORANGE}"/>'
        )

    parts += [
        f'<rect x="73" y="612" width="592" height="2" fill="{WHITE}"/>',
        setter.draw([Span(f"{weekday} · {facts.cobrand.day}", WHITE)], META, 75, 680),
        setter.draw(
            [Span(cut(setter, place, META, META_RIGHT - 75), WHITE)], META, 75, 724
        ),
        setter.draw([Span("hosts", WHITE)], HOSTS, 75, 1046),
    ]

    label = " · ".join(
        (
            f"allthings/{facts.topic}",
            f"an official community event of {NAME}",
            f"{weekday} {facts.cobrand.day}",
            place,
            "hosted by allthings",
        )
    )
    return "".join(parts), label
