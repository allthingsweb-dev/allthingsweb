# Marks

The allthings/\_ marks, generated from the design tokens and the Archivo
typeface. The output lives in [`app/public/brand`](../../app/public/brand).

| File                                                       | What it is                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `wordmark.svg`, `wordmark-night.svg`                       | The master wordmark, for Paper and Night grounds                                               |
| `wordmark-animated.svg`, `wordmark-night-animated.svg`     | The same with a blinking cursor (still under reduced motion)                                   |
| `mark.svg`, `mark-night.svg`                               | The `a/` mark on a transparent ground                                                          |
| `icon.svg`, `icon-192.png`, `icon-512.png`                 | App icon: `a/` on a Night tile, inside the maskable safe zone                                  |
| `apple-touch-icon.png`                                     | 180px app icon for iOS                                                                         |
| `favicon.svg`, `favicon.ico`, `icon-16.png`, `icon-32.png` | Favicon: a larger, heavier `a/` that reads at 16px                                             |
| `avatar.svg`, `avatar.png`                                 | Blank avatar for a person or host without a photo or logo: the open slot `/_` in Glow on Night |

Link-preview cards (`og.py`) go to [`brand/og`](../og), 1200 x 630, on Night with its grain:

| File                                                                                                                          | What it is                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `og-home.png`, `og-events.png`, `og-people.png`, `og-about.png`, `og-code-of-conduct.png`, `og-brand.png`, `og-not-found.png` | Each page's card that doesn't change with data                                                                                       |
| `og-event-night.png`, `og-event-paper.png`                                                                                    | An event card's ground in each mode, signed with a/; the Worker sets the event's words over it (`web/src/og/`)                       |
| `og-lockup.ttf`, `og-label.ttf`, `og-meta.ttf`                                                                                | Static instances of Archivo (800 at 112%, 700 at 75%) and Geist Mono (500) that the Worker has Cloudflare Images draw those words in |
| `og-metrics.json`                                                                                                             | Each instance's advances and ascent, which the Worker lays the words out by                                                          |

Geist Mono is downloaded from a pinned google/fonts commit and checked by SHA-256, as Archivo is.

The Luma calendar's cover (`calendar_cover.py`) goes to [`brand/covers`](../covers):

| File           | What it is                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar.png` | 3500 x 1000 (Luma shows a calendar's cover at 3.5:1), on Night with its grain: the master wordmark with the slot open, over the two sentences, leaving the lower left clear for the avatar Luma sets there. Uploaded by hand, since Luma's API can't set it |

The calendar's avatar is `icon-512.png`, and its social preview image (Luma asks for about 1.91:1) is `og-home.png`.
An evening's Luma cover (`cover.py`) is drawn from its facts: square, 1600 x 1600 (Luma asks for at least 800), in the evening's mode, in the Swiss Index layout. The index of day, hour and year along the top; the lockup, `allthings/<topic>` with the cursor while the evening is ahead; the neighborhood, as large as fits, over who hosts it; and the short link beside the `a/` mark. Core writes the facts and sets the cover on Luma (`bun run luma cover`, core/README.md); by hand, `uv run cover.py --out cover.png < facts.json`. Same facts, same pixels.

| File                                                                         | What it is                                                                                         |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`specimen-night.png`, `specimen-paper.png`](../covers)                      | Two past evenings' covers, allthings/effect (Night) and allthings/open source hackathon (Paper), at 800 x 800, which `--check` holds the template to |

Everything is a plain SVG path or a PNG rendered from one, so no font is
needed to display the marks. Colors and the wordmark's weight, width and
tracking come from
[`all-things.tokens.json`](../all-things.tokens.json).

## Regenerating

Requires [uv](https://docs.astral.sh/uv/).

```bash
uv run generate.py
```

`uv run generate.py --check` fails if the committed marks are out of date; CI
runs it when the tokens or the generator change.

The script downloads Archivo from a pinned google/fonts commit and checks its
SHA-256 before using it. Text is shaped with HarfBuzz, so kerning matches the
browser, and icons are rendered with resvg.

## Typeface

Archivo is by Omnibus-Type and licensed under the
[SIL Open Font License 1.1](https://github.com/google/fonts/blob/main/ofl/archivo/OFL.txt).
The license covers the font software; artwork made with it, such as these
outlines, is not restricted by it.
