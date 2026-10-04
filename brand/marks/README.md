# Marks

The all things/\_ marks, generated from the design tokens and the Archivo
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
