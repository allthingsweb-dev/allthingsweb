# all things/\_ — brand foundations

The rules every page, cover, slide, email and line of copy is checked against. Design tokens, components and templates implement these; when they disagree, this document wins and they get fixed.

## Who we are

**An open door and a high bar.** All Things is an open community for people who build software in San Francisco: the person a month into their first job, the maintainer of a library you install every day, the founder, the creator, and everyone between. Everyone is welcome. What goes on stage has earned its place.

> Evenings for people who build software.
> In the neighborhoods of San Francisco.

These two sentences are the whole pitch. They support the page; they never headline it.

## Name

- The name is **all things**, always lowercase. The master wordmark is **all things/\_**: the slot after the slash is left open, and every event fills it.
- Each event is **all things/&lt;topic&gt;**: all things/effect, all things/expo. The topic is lowercase, short and specific.
- "all things" abbreviates to **at**. Lists and running copy use **at/&lt;topic&gt;** (at/effect, at/react native).
- The sign-off is **see you at/&lt;topic&gt;**, exactly in that form. It belongs after someone commits: the confirmation state, the calendar invite title, the reminder email subject. Never beside the button that asks.
- **The cursor means "not yet happened".** Upcoming and live events carry a blinking \_ (all things/effect\_); past events lose it (all things/expo). The master wordmark always keeps it.
- The lockup is the link. allthings.dev/effect is the address of all things/effect.
- "All Things Web" is our history. It appears on the history page and in launch messaging, never in the brand.

## Voice

Plain, warm, specific, a little dry. We sound like the friend who knows the good events, not like an events company.

| Say | Not |
| --- | --- |
| evenings | events, programming |
| I'm in | RSVP, Register now, Sign up |
| hosted at CodeRabbit · hosts | sponsored by, sponsors, partners |
| East Cut, Potrero Hill, FiDi | "downtown SF", "the Bay Area tech scene" |
| who's on stage and what they built | "thought leaders", "industry experts" |
| talk between evenings → discord | Join our vibrant community! |

- Hosting companies give space, food and drinks. We have never taken money or sold a stage, so we never call anyone a sponsor.
- Say each thing once. If the page already shows the date, the button doesn't repeat it.
- No exclamation-mark enthusiasm, no hype words, no emoji in the brand voice.

## Places

Every event names its neighborhood, using the name locals use. It is how we remind a tech crowd that they live in a real city.

| Venue | Neighborhood |
| --- | --- |
| 201 Spear St (CodeRabbit), 100 1st St (Vercel) | East Cut |
| 45 Fremont St (Sentry), 351 California St (Sanity), 50 Beale St (Mux), 525 Market St (AWS GenAI Loft), 585 Market St, 660 Market St (WorkOS), 1 Post St (Mintlify) | FiDi |
| 40 O'Farrell St (Convene), 760 Market St (Vapi, Solv) | Union Square |
| 444 De Haro St (Convex, Discord), 277 Carolina St | Potrero Hill |
| Pier 70 (Standard Deviant Brewing) | Dogpatch |
| 1242 Market St | Mid-Market |
| 360 Ritch St (Little Skillet) | SoMa |
| 620 Treat Ave (Southern Pacific Brewing) | Mission |
| 500 Terry A Francois Blvd (Cisco Meraki) | Mission Bay |

Derive new ones from the venue's address, and prefer the local name over the official district.

## Marks

- **Master wordmark:** all things/\_ in Archivo 800 at 112% width, with the cursor blinking once a second. With reduced motion, the cursor stays solid.
- **Logo and app icon:** **a/**. The tail of the a runs into the slash: a beginning, with what comes next implied.
- The slash is always Bridge on light grounds and Glow on Night.
- Don't stack the letters (a/ over t/), drop the slash, set the marks in another typeface, or add effects.

## Color

Contrast is designed with APCA, the perceptual model being explored for WCAG 3, and every pairing must also pass WCAG 2.2 AA, which remains the standard: 4.5:1 for text and 3:1 for large text. APCA is the stricter guide in practice. WCAG 2 passes black on Glow at 6.6:1, yet it reads badly at text sizes; APCA rates it Lc 49.5, fit for headlines only. APCA targets: **Lc 90** preferred for body text, **Lc 75** minimum for small text, **Lc 60** at 24px and up, **Lc 45** for headlines and marks. The design-token tests check both.

| Token | Hex | On Paper | On Night | Use |
| --- | --- | --- | --- | --- |
| Paper | #F4F1EC | — | Lc 97.6 · 15.5:1 | Light ground; text on Night |
| Ink | #141210 | Lc 97.1 · 16.6:1 | — | Text on Paper |
| Bridge | #C0362C | Lc 68.1 · 4.9:1 | — | The slash; text only at 24px+ |
| Bridge Deep | #9A2B22 | Lc 77.3 · 6.8:1 | — | Small orange text; Paper buttons |
| Violet | #5B34D6 | Lc 75.9 · 6.4:1 | — | Neighborhoods and links on Paper |
| Karl text | #5E5A55 | Lc 75.5 · 6.1:1 | — | Dates and meta on Paper |
| Karl | #E6E2DC | — | — | Quiet surfaces on Paper (named for the fog) |
| Night | #1B1729 | — | — | Dark ground |
| Night raised | #242033 | — | — | Surfaces on Night |
| Mist | #E3DCF7 | — | Lc 86.3 · 13.2:1 | Secondary text on Night |
| Dusk | #D9D3E0 | — | Lc 79.9 · 11.9:1 | Dates and meta on Night |
| Lavender | #DACFFF | — | Lc 80.0 · 11.9:1 | Neighborhoods and links on Night |
| Glow | #FF6A3D | — | Lc 46.8 · 6.1:1 | The slash and display at 36px+ only |

Buttons: white on Bridge Deep (Lc 90.3, 7.7:1) on Paper, and white on Bridge (Lc 81.7, 5.5:1) on Night. Violet fills take white text (Lc 89.0, 7.2:1).

**Night is muted and grained.** A large, saturated dark ground tires the eyes and makes light text seem to glow, which readability scores don't measure. So Night keeps its violet hue at low chroma (OKLCH 0.22 / 0.035 / 293), and carries a fine, fixed grain ([`texture/grain.svg`](texture/grain.svg)) that gives it Paper's printed feel. Paper has no texture.

**The site is in the visitor's mode.** Every page follows the mode the visitor chose (system, Paper or Night), and the system's until they choose; a page never switches to a mode of its own.

**An event's artwork has its mode.** Evening events are Night; daytime events (hackathons, brunches) are Paper. An event's cover, link-preview card, slides and posts share its mode; its page does not. Which one is set by when it starts in San Francisco: from 5 AM up to 4 PM is daytime, and 4 PM or later (or the small hours) is an evening.

## Typography

One family, Archivo, used at three widths, plus Geist Mono for meta.

| Role | Size / line | Weight | Width | Tracking | Min Lc |
| --- | --- | --- | --- | --- | --- |
| Wordmark | 168 / 0.84 | 800 | 112% | −4.5% | 45 |
| Event lockup | 72 / 0.9 | 800 | 112% | −4% | 45 |
| Label (caps) | 40 / 1.0 | 700 | 75% | −1% | 60 |
| Lead | 30 / 1.25 | 500 | 100% | −1% | 75 |
| Statement | 22 / 1.3 | 500 | 100% | −1% | 75 |
| List name | 21 | 700 | 100% | 0 | 75 |
| List place (caps) | 14 | 600 | 75% | +6% | 75 |
| Body | 18 / 1.55 | 400 | 100% | 0 | 90 |
| Meta (Geist Mono, caps) | 14 / 1.5 | 500 | — | +6% | 75 |

Each role's letters are pulled back by their face's left side bearing (brand/type-metrics.json, measured from the fonts by brand/marks), so the wordmark, a 156px lockup and a mono meta line share one visual left edge. The statement role sets the two sentences beside a page's lists, one line each at desktop widths.

Sizes are the largest. The wordmark, event lockup, label, lead and statement shrink on narrow screens, each down to a floor its token sets.

## Layout

- A 12-column grid, flush left, ragged right. Rules instead of boxes; sharp corners.
- Every length comes from the layout tokens in [`all-things.tokens.json`](all-things.tokens.json):
  - The page: at most 1440px wide, with a margin of 4.5% of the screen, from 16px on phones to 64px.
  - The grid: 12 columns with 24px gutters. In a ledger, each fact's label takes 3 columns and the fact the other 9.
  - Spacing on a 4px scale, three rule weights (1, 2 and 3px), portrait and tile sizes, and the breakpoints (480, 600, 768 and 1024px).
  - Reading measures: 68 characters to a line of reading copy, 36 to a lead.
- The site's stylesheet writes no length of its own but a 1px hairline, and em where a length follows the type (tracking, an underline's offset, inline code's size): no inline styles, no magic widths, no breakpoint of a page's own. A test fails the build on any other.
- Reading copy keeps its measure and gives the rest of the row to what sits beside it. Speakers on a stage share the row rather than squeezing into narrow fixed columns.
- A lineup is as dense as its evening is long (web/src/pages/lineup.ts). Up to 3 talks, each speaker gets a full card: portrait, title, links and bio. Up to 6, each talk shows its people as rows of portrait, role, name and title, and bios stay on /people. Beyond 6, as in a lightning round, one compact row per talk, with its description behind a disclosure. A panel or fireside chat always shows its people as rows; moderators and guests keep their role.
- Every host is always seen: portraits sit side by side, never overlapping. The stylesheet has no negative margins.
- Asymmetry is deliberate: neighboring blocks may sit on different cuts of the grid and align to different edges.
- Lists of events: a light date, the name heavy with its slash, and the place bolder than the date but clearly secondary.
- Home says each thing once: the next event is the hero, real photos sit beside it, and the lists below show only other events ("after that", "recently").

## Imagery

- Real photos of real people at our evenings. No AI illustrations and no stock photography.
- Event covers are typographic: lockup, neighborhood, date, host, short link. They are generated from event data, never hand-assembled.

## People and channels

- Socials sit in a quiet line of words in the footer (luma · discord · youtube · github · x · bluesky · linkedin) and on the history page, never in a hero.
- Luma and Discord are actions on home: "subscribe on luma" beside "every evening →", and "talk between evenings → discord". Every evening's index says where to follow along in the same quiet line of words as the footer, under its title: luma calendar · discord · x.
- The organizers are visible everywhere: "hosted by Erik & Andre" with portraits in every footer, organizers first on the people page, and "your hosts" beside the hosting company on every event page.
- Everyone has a page of their own, `/people/<slug>`, from their name: their profile, every talk and part at our evenings and the ones we shared, and, for an organizer, every evening they hosted. Every name on the site links to it. When a name changes, so does the slug, and the old address redirects to the new one for good.

## Accessibility

APCA targets above for all text; never color alone to carry meaning; real buttons and links; alt text that describes the moment in a photo; the cursor stops blinking for people who prefer reduced motion.

- Text is set no smaller than its contrast allows: Lc 75 for small text, 60 at 24px and up, 45 at 36px and up. The palette shows a color too faint for text on a ground as a bar, not as text.
- Every page starts with a link past the header to the page itself, and every control shows its focus.
- The mode control is a popover. Escape or a click outside closes it, without script.
- Long names and titles break rather than overflow, down to a 320px screen and at 200% zoom.
- Every kind of page passes axe in the web tests, apart from the rules that need a browser. Color contrast is checked against the APCA targets above.
