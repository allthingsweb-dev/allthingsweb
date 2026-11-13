"""Link-preview cards: 1200 x 630, from the tokens and Archivo.

Pages that don't change with data get a whole card here. Event pages get a
ground here and their words drawn over it by the Worker with Cloudflare's
Images binding (web/src/og/): the fonts it draws with are instances of the
same variable fonts, written beside the cards, with the advance widths the
Worker lays words out by.
"""

from __future__ import annotations

import io
import json
from dataclasses import dataclass

import uharfbuzz as hb
from PIL import Image
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

W, H = 1200, 630
MARGIN = 72


@dataclass(frozen=True)
class Style:
    """One way of setting type: a font instance, size and tracking."""

    face: str  # "archivo" or "mono"
    weight: int
    width: float  # Archivo's wdth axis; ignored for mono
    size: float
    tracking_em: float = 0.0
    caps: bool = False


@dataclass(frozen=True)
class Span:
    text: str
    color: str


class Setter:
    """Shapes spans of one style with HarfBuzz and draws them as SVG paths."""

    def __init__(self, faces: dict[str, bytes]):
        self.faces = {name: hb.Face(hb.Blob(data)) for name, data in faces.items()}
        self.fonts: dict[tuple[str, int, float], hb.Font] = {}

    def font(self, style: Style) -> hb.Font:
        key = (style.face, style.weight, style.width)
        if key not in self.fonts:
            font = hb.Font(self.faces[style.face])
            axes = {"wght": style.weight}
            if style.face == "archivo":
                axes["wdth"] = style.width
            font.set_variations(axes)
            self.fonts[key] = font
        return self.fonts[key]

    def shape(self, spans: list[Span], style: Style):
        font = self.font(style)
        upem = self.faces[style.face].upem
        scale = style.size / upem
        placed = []
        x = 0.0
        for span in spans:
            text = span.text.upper() if style.caps else span.text
            buf = hb.Buffer()
            buf.add_str(text)
            buf.guess_segment_properties()
            hb.shape(font, buf, {"kern": True, "liga": True})
            for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
                placed.append((info.codepoint, x + pos.x_offset * scale, span.color))
                x += pos.x_advance * scale + style.tracking_em * style.size
        return font, scale, placed, x - style.tracking_em * style.size

    def width(self, spans: list[Span], style: Style) -> float:
        return self.shape(spans, style)[3]

    def draw(self, spans: list[Span], style: Style, x: float, baseline: float) -> str:
        font, scale, placed, _ = self.shape(spans, style)
        pens: dict[str, SVGPathPen] = {}
        for glyph, gx, color in placed:
            pen = pens.setdefault(color, SVGPathPen(None, ntos=_number))
            font.draw_glyph_with_pen(
                glyph,
                TransformPen(pen, (scale, 0, 0, -scale, x + gx, baseline)),
            )
        return "".join(
            f'<path fill="{color}" d="{pen.getCommands()}"/>'
            for color, pen in pens.items()
        )


def _number(value: float) -> str:
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text == "-0" else text


GRAIN = (
    '<filter id="grain" x="0" y="0" width="100%" height="100%">'
    '<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" '
    'seed="7" stitchTiles="stitch"/>'
    '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.09 0"/>'
    "</filter>"
)


def ground(c: dict[str, str], night: bool) -> str:
    if not night:
        return f'<rect width="{W}" height="{H}" fill="{c["paper"]}"/>'
    return (
        f"<defs>{GRAIN}</defs>"
        f'<rect width="{W}" height="{H}" fill="{c["night"]}"/>'
        f'<rect width="{W}" height="{H}" filter="url(#grain)"/>'
    )


def card(body: str, title: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'
    )


def palette(c: dict[str, str], night: bool) -> dict[str, str]:
    """Roles on a ground, as the foundations pair them."""
    if night:
        return {
            "text": c["paper"],
            "accent": c["glow"],
            "meta": c["dusk"],
            "lead": c["mist"],
            "place": c["lavender"],
        }
    return {
        "text": c["ink"],
        "accent": c["bridge"],
        "meta": c["karlText"],
        "lead": c["ink"],
        "place": c["violet"],
    }


# The roles cards set type in: the foundations' roles, at card scale.
LOCKUP = Style("archivo", 800, 112, 132, -0.04)
NAME = Style("archivo", 800, 112, 112, -0.04)
CURSOR = Style("archivo", 400, 112, 132, -0.04)
SMALL_WORDMARK = Style("archivo", 800, 112, 40, -0.045)
LEAD = Style("archivo", 500, 100, 34, -0.01)
LABEL = Style("archivo", 700, 75, 40, -0.01, caps=True)
META = Style("mono", 500, 100, 24, 0.06, caps=True)


@dataclass(frozen=True)
class Page:
    file: str
    title: str
    #: The big line(s); "" in a line is the open slot (the cursor alone).
    lines: tuple[str, ...]
    #: Whether the first line is the lockup's "allthings/".
    lockup: bool
    meta: str
    lead: tuple[str, ...]


SENTENCES = (
    "Evenings for people who build software.",
    "In the neighborhoods of San Francisco.",
)

PAGES = (
    Page("og-home.png", "allthings/_", ("",), True, "San Francisco", SENTENCES),
    Page(
        "og-events.png",
        "every evening · allthings/_",
        ("every evening",),
        False,
        "ahead and past",
        SENTENCES,
    ),
    Page(
        "og-people.png",
        "people · allthings/_",
        ("people",),
        False,
        "organizers and speakers",
        SENTENCES,
    ),
    Page(
        "og-talks.png",
        "every talk · allthings/_",
        ("every talk",),
        False,
        "on stage at every evening",
        SENTENCES,
    ),
    Page(
        "og-year.png",
        "the year in evenings · allthings/_",
        ("the year",),
        False,
        "in evenings",
        SENTENCES,
    ),
    Page(
        "og-about.png",
        "about · allthings/_",
        ("about",),
        False,
        "who we are",
        SENTENCES,
    ),
    Page(
        "og-code-of-conduct.png",
        "code of conduct · allthings/_",
        ("code of conduct",),
        False,
        "welcoming, respectful, community first",
        ("How we treat each other at every evening,", "and how to report a concern."),
    ),
    Page(
        "og-privacy.png",
        "privacy · allthings/_",
        ("privacy",),
        False,
        "what we keep, and why",
        ("What this site keeps about you,", "and how to have it taken down."),
    ),
    Page(
        "og-brand.png",
        "allthings/brand",
        ("brand",),
        True,
        "palette, type, marks",
        ("The rules every page, cover and line of copy", "is checked against."),
    ),
    Page(
        "og-not-found.png",
        "not found · allthings/_",
        ("not found",),
        False,
        "404",
        ("No evening lives at this address.",),
    ),
)


def page_card(setter: Setter, c: dict[str, str], page: Page) -> str:
    p = palette(c, night=True)
    parts = [ground(c, night=True)]
    # Meta along the top.
    parts.append(setter.draw([Span(page.meta, p["meta"])], META, MARGIN, MARGIN + 24))
    # The big words: the lockup, or a page's name under the small wordmark.
    lines: list[list[Span]] = []
    if page.lockup:
        lines.append([Span("allthings", p["text"]), Span("/", p["accent"])])
    style = LOCKUP if page.lockup else NAME
    for line in page.lines:
        lines.append([Span(line, p["text"])] if line else [])
    line_height = style.size * 0.9
    top = 300 if page.lockup else 330
    for index, spans in enumerate(lines):
        baseline = top + index * line_height
        if spans:
            parts.append(setter.draw(spans, style, MARGIN - 6, baseline))
        if index == len(lines) - 1 and page.file == "og-home.png":
            # The slot after the slash, open.
            parts.append(
                setter.draw([Span("_", p["accent"])], CURSOR, MARGIN - 6, baseline)
            )
    if not page.lockup:
        wordmark = [
            Span("allthings", p["text"]),
            Span("/", p["accent"]),
            Span("_", p["accent"]),
        ]
        parts.append(setter.draw(wordmark, SMALL_WORDMARK, MARGIN, 210))
    # The two sentences at the foot.
    for index, sentence in enumerate(page.lead):
        baseline = H - MARGIN - (len(page.lead) - 1 - index) * LEAD.size * 1.25
        parts.append(setter.draw([Span(sentence, p["lead"])], LEAD, MARGIN, baseline))
    return card("".join(parts), page.title)


def event_ground(setter: Setter, c: dict[str, str], night: bool) -> str:
    """An event card's ground: its mode's, signed with the a/ mark."""
    p = palette(c, night)
    mark = [Span("a", p["text"]), Span("/", p["accent"])]
    style = Style("archivo", 800, 112, 56, -0.05)
    x = W - MARGIN - setter.width(mark, style)
    parts = [ground(c, night), setter.draw(mark, style, x, H - MARGIN)]
    return card("".join(parts), "allthings/_")


# A person's card is the people card made theirs: its meta names their part
# at our evenings, and their photo fills the right of the card, square, from
# margin to margin, as their page shows it. The Worker draws the photo (or
# the blank avatar) into this box and sets their name, title and X handle
# (web/src/og/person-card.ts), so the box is written beside the metrics.
PERSON_PHOTO_SIDE = H - 2 * MARGIN
PERSON_PHOTO = {
    "left": W - MARGIN - PERSON_PHOTO_SIDE,
    "top": MARGIN,
    "side": PERSON_PHOTO_SIDE,
}
# Each part a person's card can name, as the people page groups them, and
# "people" for someone with no part yet.
PERSON_PARTS = ("organizer", "speaker", "co-host", "mc", "people")
# The hairline that keeps a photo as dark as Night visible on Night, as
# site.css rules portraits; two pixels, since cards are mostly seen at half
# size.
PERSON_RULE = 2


def person_ground(setter: Setter, c: dict[str, str], part: str) -> str:
    """A person's card's ground: the people card's meta, here their part,
    and its small wordmark, with the rule around their photo's box."""
    p = palette(c, night=True)
    wordmark = [
        Span("allthings", p["text"]),
        Span("/", p["accent"]),
        Span("_", p["accent"]),
    ]
    box = PERSON_PHOTO
    half = PERSON_RULE / 2
    # The rule sits outside the box, so the photo drawn into it never covers it.
    rule = (
        f'<rect x="{_number(box["left"] - half)}" y="{_number(box["top"] - half)}" '
        f'width="{_number(box["side"] + PERSON_RULE)}" '
        f'height="{_number(box["side"] + PERSON_RULE)}" '
        f'fill="none" stroke="{c["ruleNight"]}" stroke-width="{PERSON_RULE}"/>'
    )
    parts = [
        ground(c, night=True),
        setter.draw([Span(part, p["meta"])], META, MARGIN, MARGIN + 24),
        setter.draw(wordmark, SMALL_WORDMARK, MARGIN, 210),
        rule,
    ]
    return card("".join(parts), f"{part} · allthings/_")


# A person's card is a JPEG (web/src/og/person-card.ts): with a photo over
# the grain, a PNG is too large for some apps' previews. When the Worker
# can't draw one, the people card stands in, as a JPEG at the same quality,
# so it is the type the page names.
PERSON_CARD_QUALITY = 85


def jpeg(png_bytes: bytes) -> bytes:
    """A PNG as a baseline JPEG at the person card's quality."""
    out = io.BytesIO()
    Image.open(io.BytesIO(png_bytes)).convert("RGB").save(
        out, format="JPEG", quality=PERSON_CARD_QUALITY
    )
    return out.getvalue()


# What the Worker draws cards with: each role's instance, written as a font
# file it can point the Images binding at, with advance widths. The lead is
# a person's title, set as the people card sets its sentences.
INSTANCES = {
    "og-lockup": Style("archivo", 800, 112, 1000),
    "og-label": Style("archivo", 700, 75, 1000),
    "og-lead": Style("archivo", 500, 100, 1000),
    "og-meta": Style("mono", 500, 100, 1000),
}

# The characters the Worker measures; others count as the widest of these.
MEASURED = (
    "".join(chr(i) for i in range(0x20, 0x7F))
    + "’‘“”–—…·éèêëáàâäíóòôöúùûüñçßÉÁÍÓÚÑ"
)


def instance(data: bytes, style: Style) -> bytes:
    # Keep the source's timestamps, so the same inputs make the same bytes.
    font = TTFont(io.BytesIO(data), recalcTimestamp=False)
    axes = {"wght": style.weight}
    if style.face == "archivo":
        axes["wdth"] = style.width
    static = instantiateVariableFont(font, axes)
    out = io.BytesIO()
    static.save(out)
    return out.getvalue()


def metrics(setter: Setter, style: Style) -> dict[str, object]:
    """Each measured character's advance and the font's ascent, in
    thousandths of the size: a text overlay's top sits an ascent above its
    baseline."""
    face = setter.faces[style.face]
    ascent = setter.font(style).get_font_extents("ltr").ascender
    return {
        "ascent": round(ascent * 1000 / face.upem, 1),
        "advances": {
            char: round(setter.width([Span(char, "")], style), 1) for char in MEASURED
        },
    }


def build_og(faces: dict[str, bytes], c: dict[str, str], png) -> dict[str, bytes]:
    setter = Setter(faces)
    files: dict[str, bytes] = {}
    for page in PAGES:
        files[page.file] = png(page_card(setter, c, page))
    files["og-people.jpg"] = jpeg(files["og-people.png"])
    files["og-event-night.png"] = png(event_ground(setter, c, night=True))
    files["og-event-paper.png"] = png(event_ground(setter, c, night=False))
    for part in PERSON_PARTS:
        files[f"og-person-{part}.png"] = png(person_ground(setter, c, part))
    measured: dict[str, object] = {"og-person-photo": PERSON_PHOTO}
    for name, style in INSTANCES.items():
        files[f"{name}.ttf"] = instance(faces[style.face], style)
        measured[name] = metrics(setter, style)
    files["og-metrics.json"] = (
        json.dumps(measured, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    ).encode()
    return files
