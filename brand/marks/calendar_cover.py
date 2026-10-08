"""The Luma calendar's cover (luma.com/allthingsweb): the open slot.

The calendar is every evening at once, so its cover is the master wordmark,
allthings/_, with the slot after the slash left open, and the two sentences
that are the whole pitch (brand/foundations.md, "Who we are"), on Night
with its grain. Luma shows a calendar's cover wide, 3.5:1, and sets the
calendar's avatar over its lower left corner, so that corner is left empty:
the wordmark stands above it and the sentences sit at the foot of the
right-hand side, as home's do.

    allthings/_
                                    Evenings for people who build software.
                                    In the neighborhoods of San Francisco.

Luma's API can't set a calendar's cover; an organizer uploads this file in
the calendar's settings (Settings, Display, Change Cover).
"""

from __future__ import annotations

from og import GRAIN, SENTENCES, Setter, Span, Style, palette

WIDTH, HEIGHT = 3500, 1000
MARGIN = 140

WORDMARK = Style("archivo", 800, 112, 340, -0.045)
CURSOR = Style("archivo", 400, 112, 340, -0.045)
LEAD = Style("archivo", 500, 100, 76, -0.01)
META = Style("mono", 500, 100, 44, 0.06, caps=True)


def calendar_cover_svg(setter: Setter, colors: dict[str, str]) -> str:
    p = palette(colors, night=True)
    parts = [
        f"<defs>{GRAIN}</defs>",
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="{colors["night"]}"/>',
        f'<rect width="{WIDTH}" height="{HEIGHT}" filter="url(#grain)"/>',
    ]
    # Where every evening is, along the top, as a page's meta line.
    parts.append(
        setter.draw([Span("San Francisco", p["meta"])], META, MARGIN, MARGIN + META.size)
    )
    # The wordmark, pulled back by its left side bearing as the site's is.
    baseline = HEIGHT * 0.6
    left = MARGIN - WORDMARK.size * 0.04
    word = [Span("allthings", p["text"]), Span("/", p["accent"])]
    parts.append(setter.draw(word, WORDMARK, left, baseline))
    cursor_x = left + setter.width(word, WORDMARK) + WORDMARK.tracking_em * WORDMARK.size
    parts.append(setter.draw([Span("_", p["accent"])], CURSOR, cursor_x, baseline))
    # The two sentences at the foot of the right-hand columns, one line each,
    # flush left in a block that ends at the right margin.
    x = WIDTH - MARGIN - max(
        setter.width([Span(sentence, "")], LEAD) for sentence in SENTENCES
    )
    line = LEAD.size * 1.25
    for index, sentence in enumerate(SENTENCES):
        y = HEIGHT - MARGIN - (len(SENTENCES) - 1 - index) * line
        parts.append(setter.draw([Span(sentence, p["lead"])], LEAD, x, y))
    title = "allthings/_ · " + " ".join(SENTENCES)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}" height="{HEIGHT}" '
        f'role="img" aria-label="{title}"><title>{title}</title>{"".join(parts)}</svg>\n'
    )
