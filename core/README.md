# allthings-core

The data layer the Worker (`web/`) runs on: repositories over Postgres with
Effect SQL, and the migrations that define the schema.

## One catalog

The site's pages, the MCP tools (which the CLI and the Claude plugin
call), the v1 API and the feeds all say which evenings and people there
are. They must say the same, so each fact is stated once, in
`src/catalog.ts`, as a typed SQL fragment, with its TypeScript twin where
something is sorted or decided in code. Every public read builds its
statement from it.

- **Which evenings are public:** `published(e)`. An evening is found by
  its long slug, its short link or a link it had before (`resolve`), the
  short link winning.
- **Their order:** `soonestFirst(e)` and `latestFirst(e)`, ids breaking
  ties, and the `Order` that `selectEvents` sorts by.
- **Ahead or over:** `ahead(e, now)` and `ended(e, now)`, which agree with
  `eventStatus` (live through its end) at every instant, a test holds. `now`
  is one instant for every surface, `asOf` (`src/clock.ts`): the
  `Clock`'s, at the start of its minute. The pages, the feeds, the MCP
  tools and the v1 API all read it, never the time itself; the guard below
  lists the code that reads the time for its own work.
- **Ours or shared:** `ours(e)`. Whether a surface counts the evenings we
  share is a named choice, never a filter written inline.
- **An evening's lineup:** its talks in running order, each talk's
  speakers in the order they were attached, with their part; its hosts, as
  attached; its people, by role. `talksOf`, `hostsOf` and `peopleOf` read
  them in that order, each surface choosing the fields it publishes, and
  `talkOrder`, `speakerOrder`, `hostOrder` and `peopleOrder` are the
  orders themselves, for a statement that joins them its own way.
- **A person's appearances:** their talks (`talkAppearances`) and their
  parts in evenings as a whole (`roleAppearances`) at published evenings,
  each scoped by whose evenings (`ours` or `any`) and when (`any`, or
  once `ended`), latest evening first (`latestTalkFirst`,
  `latestAppearanceFirst`). /people is our evenings' at any time; a
  person's page, every evening's; /about counts ours once over; the sitemap
  lists everyone at any; the speakers list (`list_speakers`,
  `/api/v1/speakers`) counts our evenings' talks once `ended`.

Each surface still reads in one statement, since from a Worker every round
trip costs more than the query, and builds it from these fragments. What a
surface adds is how it shows what the catalog selects: home's limits, its
hero (always ours) and its photos; /events by year; an event page's posts,
schedule, notes, venue and guest count; the people page's groups and its
X-follower order; the API's and the tools' published fields, long slugs,
limits, search and error texts. None of that decides which evenings or
people there are, or their order.

`tests/catalog-guard.test.ts` reads core's and the Worker's source and
fails on any file that states one of these rules itself (selecting by
`is_draft`, a comparison on `end_date`, `curation = '…'`, an `ORDER BY` on
`start_date`, or a lineup's order) outside `src/catalog.ts`. It lists the
code that isn't a public read (the Luma sync, the organizers' tools, the
reports), each with why; the list only shrinks, and a listed file that
states no rule fails it too. `tests/catalog.test.ts` holds the fragments to
the schema, `ahead` and `ended` to `eventStatus` at every instant around
an evening's start and end, and each scope of a person's appearances.

`web/tests/parity.test.ts` holds the surfaces to each other over one
seeded database at one instant: the same evenings in the same order from
`list_events`, `/api/v1/events`, the feed, /events and home; the same
lineup from `get_event`, `/api/v1/events/:id` and the event page, by every
link; the same people and talks from `list_speakers`, `/api/v1/speakers`,
/people, people's pages, /about and the sitemap; and whose each evening is,
from `list_events` and /events.

The public contract is `src/contract.ts`, the one source of it. The CLI's
zod copy (`cli/src/schemas.ts`) is held to it by `tests/contract.test.ts`,
which the core workflow runs whenever `cli/src` changes. The old app's
schemas and answers are legacy: where tests still compare the Worker with
the app, it is on the fields the app has.

## Luma sync

`src/luma/` is the app's hourly Luma calendar sync (`app/src/lib/luma/`) as
Effect services, for a Worker cron to run: `Luma` reads the calendar's public
iCalendar feed over `HttpClient` (retrying 429, 5xx, timeouts and dropped
connections), and `LumaSync` writes it to `events` in one statement, touching
only the events Luma changed, so `updated_at` says when it last did. Which
columns Luma owns, and which the site does, is written down in
`src/luma/sync.ts`. `tests/luma-parity.test.ts` runs the app's sync and
core's on copies of one database with the same feed and requires the same
rows; nothing in the tests reaches Luma.

`LumaSync.rehearse` is the dry run. It runs the same statement in a
transaction that always rolls back, and reports every event the sync would
create and every column it would change, before and after. Nothing is
committed. `bun run sync:rehearse` prints that report for the database at
`DATABASE_URL`. Run it as `site_sync`, the role the sync writes as, so the
dry run also proves the role's grants:

```sh
DATABASE_URL=$(op read "op://allthings/allthings site_sync/credential") bun run sync:rehearse
```

Every `op://` reference in this repository reads the `allthings` 1Password vault. Your own `op` session (the 1Password desktop app integration) can read it, and agents read it with `OP_SERVICE_ACCOUNT_TOKEN`.

## Image ingestion

`src/ingest/` is the image half of the app's hourly sync (`app/src/lib/event-covers`, `profile-photos`, `post-images`) as an Effect service, `ImageIngest`. It fills in three kinds of missing image:

- each event without a cover gets its Luma cover
- each profile without a photo gets the one at its `photo_source_url`
- each post gets its image and its author's avatar

**Downloads** are HTTPS only, from a per-kind host list, with every redirect checked first, a 15 MiB cap, and a check that the bytes are an image.

**Processing** goes through `Pictures`. In the Worker that is Cloudflare's Images binding, because the app's sharp, heic-convert and openimg don't run in Workers. HEIC, HEIF, WebP and AVIF are stored as JPEG (the app stores PNG), and other formats keep their bytes.

**Storing** an image means putting it in the `MediaBucket` under a new key. Then one statement records it in `images` and sets it on its row, only while the row still has none. An object stored for nothing is deleted again.

Each phase starts nothing new after its budget, and `pending` is the dry run: it lists what would be fetched and fetches nothing.

`tests/ingest-parity.test.ts` runs each phase and the app's on copies of one database, with the same downloads, processing, ids and time. It requires the same rows, the same objects stored and deleted, and the same results.

## Who took part

`event_people` holds a person's part in an event as a whole: an allthings
organizer, a co-host or the MC. Who was on stage, and in what capacity, is on
the talks: `talks.format` (a talk, a panel or a fireside chat) and each
speaker's `talk_speakers.role` (speaking or moderating), so a panelist is a
panel's speaker and a fireside's guest is its speaker (`src/people.ts`).
`Events.getPublished` returns all of it, with Luma's guest counts.

An evening's talks run in order: `event_talks.position`, from 0, and
`event_talks.starts_at` where the start is known. Pages, the public API,
promotion drafts and the completeness report all list talks by position;
a talk attached without one follows, in the order it was attached. A
lineup in `backfill/lineups.json` sets both per talk (`position`,
`startsAt` with its offset, "2026-09-30T18:41:00-07:00"); it never clears
them, so unplacing a talk is a manual update of that one row:

```sql
UPDATE event_talks SET position = NULL, starts_at = NULL, updated_at = now()
WHERE event_id = $1 AND talk_id = $2;
```

A lineup can also correct the record. An event is found by its Luma id,
or by `slug` where it has none, and its `remove` lists what the evening
didn't have, each with its sources: talks to take off it (a talk on no
other evening is deleted with its speakers) and people's parts in it
(by an existing profile and role).

### Editing a talk

`bun run talks update` edits a talk that exists (`src/talk-edits.ts`): its
title, its description (editor HTML, as the site stores it) and its
speakers. The old admin did this. A lineup never changes a talk's title or
description, and never takes a speaker off a talk it keeps. What a run isn't
given stays as it is. `talks list` prints an evening's talks, in page order,
with their ids and speakers.

- **Speakers** are the talk's whole list, in the order its page shows them,
  one `--speaker` each, by profile slug or id, with `:moderator` for a
  moderator. A changed list replaces the old one in `talk_speakers`, in that
  order.
- **`--dry-run`** prints each value as it is and as it will be, as a diff,
  and an approval token for that change. It changes nothing.
- **`--approve <token>`**, with the same values, locks the talk and works
  the change out again in one transaction. It refuses unless the change
  still hashes to the token, so a title or a speaker changed in between
  stops it.

```sh
DATABASE_URL=… bun run talks list effect   # ids, titles, speakers
DATABASE_URL=… bun run talks update <talk id> --title "…" --description-file talk.html \
  --speaker ada-lovelace --speaker grace-hopper:moderator --dry-run
DATABASE_URL=… bun run talks update <talk id> --title "…" --description-file talk.html \
  --speaker ada-lovelace --speaker grace-hopper:moderator --approve <token>
```

## Speaker order: X followers

Speaker lists are ordered by how many follow each person on X, most first.
Nobody picks this order; it is how the order is decided. Among equal counts,
and among people without one (who always come after everyone counted), the
list keeps its own order (`byFollowers` in `src/followers.ts`; /people's
speakers: whoever took part latest first).

Each profile keeps a snapshot, `x_followers` with `x_followers_at`, read from
public data: X's own API with the app's bearer token (`X_BEARER_TOKEN`), by
user id, up to 100 accounts a request, $0.010 each on pay-per-use, or the
keyless FixTweet API without it. The sync
Worker refreshes the missing and oldest snapshots on its schedule, a bounded number per run, reading for
at most its window (30 s); a handle X doesn't know, or a failed read,
leaves the snapshot as it was, and the least recently tried go first
(`x_followers_tried_at`), so a handle that keeps failing never holds the
slots. A count is only ever its handle's: changing
or clearing `twitter_handle` clears the snapshot (a trigger, in both
migrations), and a count read while the handle changed is not stored.

A profile knows its X account by its numeric user id (`x_user_id`), which
never changes: people change handles, and X lets others take a freed one.
The refresh stores the id the first time it reads a handle. A handle whose
account has another id now is never adopted: it is cleared, the id is kept,
and `x_handle_lost` records it for the completeness report ("person whose
X handle is now someone else's"). A source that can look an account up by
id (X's own API; FixTweet can't) reads by id, and a renamed account's new
handle is stored as it is. Editing a handle by hand forgets the old
account: its id, its count and a lost handle. The post search knows X
authors by id too.

```sh
DATABASE_URL=… bun run followers --dry-run   # read the counts, write nothing
DATABASE_URL=… bun run followers             # store them
DATABASE_URL=… bun run followers --stale-days 0 --max 1000   # re-read everyone
```

## Luma descriptions

The feed's DESCRIPTION is only a link to the event's page, so each
evening's words come from Luma's API (`description_md`, the Markdown of
Luma's editor). `src/luma/description.ts` makes it rich text the way talk
descriptions are kept: headings become bold paragraphs, images, rules and
raw HTML go, and the rest passes `sanitizeRichText`. It also takes a
one-line summary: the leading sentences, up to 200 characters, of the
first paragraph that reads as prose.

`src/luma/descriptions.ts` writes both to `events.luma_description` and
`luma_summary`, which Luma owns: each import makes them what Luma has now.
`events.description` is the site's own, for an organizer to say it
differently, and nothing from Luma writes it. The event page's "About" row
shows the site's description when it says something, and Luma's otherwise.
The tagline stays the site's too: while it is the sync's placeholder ("See
Luma for event details and registration."), the summary stands in for it
on the page, in its structured data and in the feed (`src/tagline.ts`).
The four "<name> at All Things Web" taglines the app's first sync wrote
became that placeholder in the migration.

Drafts' descriptions come with the draft refresh (see "Drafts the feed
doesn't carry").

The hourly sync imports descriptions after the events and images, in a
window of their own (web/src/sync/run.ts).
To run it now, for every event, from `core/`:

```sh
DATABASE_URL=… LUMA_API_KEY=… bun run luma:descriptions --dry-run   # ask Luma, print what would change
DATABASE_URL=… LUMA_API_KEY=… bun run luma:descriptions             # write it
```

`tests/luma-descriptions.test.ts` runs the conversion, the client against
fixtures and the import against `tests/seed.sql`; nothing reaches Luma.

## Talks given elsewhere

`external_talks` holds talks people gave away from our evenings: at
conferences, other meetups, on podcasts and in videos. Each has its event
(the conference, meetup, podcast or channel), its kind, the day, its page
and recording where they exist, and where its facts were read and when.
`ExternalTalks.forProfiles` reads them, latest first, for person pages.

`backfill/external-talks.json` carries them from public sources (YouTube,
conference and meetup pages, podcast pages, people's own sites). What
could not be confirmed, a date or a same-name speaker above all, is kept
under `held` with its reason and never written.

```sh
DATABASE_URL=… bun run external-talks --dry-run   # what would be written, rolled back
DATABASE_URL=… bun run external-talks             # write it, in one transaction
```

Applying is safe to repeat: a talk is known by its speaker, title and day,
and one already there only takes corrected links and sources.

## Hidden venues

While Luma shows an event's venue to guests only ("location_visibility":
"guests-only"), its calendar feed hides it: LOCATION is the event's own page
and DESCRIPTION says "Check event page for more details". The sync takes
that as no venue, so an event it creates then has none and keeps none (All
Things Sync, 2026-04-29, at CodeRabbit's rooftop, was one). Luma's API
gives the address all the same, and `src/luma/venues.ts` fills in each
published event's missing venue from it, the way the sync writes a venue
the feed shows. It never replaces a stored venue, and keeps any field an
organizer wrote. The hourly sync does it after the events
(web/src/sync/run.ts); to run it now, from `core/`:

```sh
DATABASE_URL=… LUMA_API_KEY=… bun run luma:venues --dry-run   # ask Luma, print the venues
DATABASE_URL=… LUMA_API_KEY=… bun run luma:venues             # write them
```

The completeness check fails on any published evening without a venue,
however old, since Luma always knows where one was.

Where Luma's venue is wrong, the organizers' replaces it: a `venue` in an
evening's entry in `backfill/lineups.json`, with its sources, written by
`bun run lineups` and marked `events.venue_by_organizer`. From then on
neither sync, core's nor the app's, nor the venue fill changes it (All
Things Sync was on CodeRabbit's 18th-floor rooftop, not the 12th floor
Luma lists).

## Drafts the feed doesn't carry

Luma's calendar feed carries no private event. Once the sync has stored
an event as a draft (it went private, or was made private), the feed never
says what became of it, and its row keeps the name and times it had: the
draft stored as JS Trivia Night on 2026-04-29 is Markdown Trivia Night on
2026-05-22 on Luma. `src/luma/drafts.ts` asks Luma's API about every
draft we know, by its Luma id, and writes what Luma owns where it
differs: the name, the times, the venue unless the organizers set one,
and its description and summary, converted as the import of published
evenings converts them (so the draft preview shows its About text). It
only reads from Luma. Whether an evening is a draft stays the
feed's: one Luma now shows publicly comes back in the feed and the sync
publishes it, so the refresh only reports it. An event Luma no longer
shows us (403, or 404 once cancelled) is left as it is. The hourly sync
does it after the venues (web/src/sync/run.ts); to run it now, from
`core/`:

```sh
DATABASE_URL=… LUMA_API_KEY=… bun run luma:drafts --dry-run   # ask Luma, print what would change
DATABASE_URL=… LUMA_API_KEY=… bun run luma:drafts             # write it
```

For the same reason, an evening made private from the start (`bun run
luma create`) never reaches the database by the feed. `--add <evt-…>`
stores one: it asks Luma's API for the event and inserts it as the sync
would have, as a draft, with the sync's slug and placeholder tagline. It
refuses an event that isn't private (the feed brings those in) and one
already stored. From then on the refresh keeps it in line.

```sh
DATABASE_URL=… LUMA_API_KEY=… bun run luma:drafts --add evt-… --dry-run   # what it would store
DATABASE_URL=… LUMA_API_KEY=… bun run luma:drafts --add evt-…             # store it
```

## Luma people import

The calendar feed names no hosts and counts no guests. `src/luma/api.ts`
asks Luma's official API (`GET /v1/events/get` on `public-api.luma.com`) with
a Luma calendar's API key, which needs Luma Plus, in `LUMA_API_KEY`; without
it the import does nothing. `src/luma/people-sync.ts` asks about every
published event, matches hosts to profiles as `src/luma/people.ts` plans it,
and writes `event_people` (its own rows only), `profiles.luma_user_id`, and
`events.luma_guest_count` and `luma_checked_in_count`, in one statement.

Hosts are matched by Luma user id, then by exact name with a review line.
A host whose Luma user id is a hosting company's (`sponsors.luma_user_id`,
from `backfill/hosts.json`) is that company: it is attached to the event as
a hosting company (`event_sponsors`, only ever added), never matched to a
person. Nothing is created without an organizer's decision: Luma's hosts
include companies' accounts not yet on record and people under other names.
Run it from `core/`:

```sh
DATABASE_URL=… LUMA_API_KEY=$(op read "op://allthings/allthings Luma API key/credential") \
  bun run luma:people --dry-run                          # ask Luma, print the plan and what to review
bun run luma:people --create usr-… --link usr-…=<profile id> --dry-run   # decide the hosts it listed
bun run luma:people --create usr-… --link usr-…=<profile id>             # write
```

`tests/luma-people.test.ts` runs the client against fixtures in the shape
docs.luma.com documents, and the import against `tests/seed.sql`; nothing in
the tests reaches Luma.

## What kind of evening

`events.program` says what an evening was: `talks` (a lineup on stage), an
`open-floor` (community demos with no fixed lineup), `social` (a hangout,
trivia, an after-party) or a `hackathon`. It's `talks` unless an organizer
says otherwise, and `is_hackathon`, which the public API still publishes,
must agree with it. Only an evening of talks is asked for talks, and the
event page says an open floor was open to anyone before any demos it knows.

`core/backfill/programs.json` names every event's program, each sourced to
its Luma page, with a note wherever the evening had no lineup. Run it from
`core/`; it lists any event the file doesn't name:

```sh
DATABASE_URL=… bun run programs --dry-run   # do everything, print it, roll back
DATABASE_URL=… bun run programs             # write
```

## Short links

The lockup is the link (brand/foundations.md, "Name"): allthings/effect
lives at allthings.dev/effect. `src/short-slugs.ts` is the rule, taking
evenings in the order they start:

1. An evening's base is its topic as a URL segment (react native →
   `react-native`, web show & tell → `web-show-and-tell`), or its name
   when the name yields no topic.
2. It takes the first of these that no other evening holds and no page is
   at: the base, then the base with its month in San Francisco
   (`web-2024-11`), then the day (`web-2024-11-12`), then a count.
3. A shared evening is someone else's, never allthings/anything, so its
   link is under `shared/` (`shared/typescript-ai-demo-day`). The bare root
   is the lockup's alone, and a shared name can't take a topic ours might
   want.

A link, once given, is that evening's for good. The first evening of a
topic keeps the bare one, and a later evening of the same topic is dated,
so nothing printed, posted or put in a QR code ever comes to mean another
evening. `event_slugs` records every link given (its key holds each to one
evening), and `events.short_slug` is the one in use. `events.slug`, the
app's long slug, stays as the app serves it.

The Worker serves an evening at its link: its pages, lists, sitemap, feed,
canonical URL, card, structured data, calendar file and promotion drafts
all use it. Its long slug, and any link it had before, redirect there
(301): Luma's descriptions, posts and QR codes link the long ones. An
evening without a link yet is served at its long slug. The v1 API and the
MCP tools keep the long slug as the app publishes it, and `get_event` takes
any link, as the evening's page does: the long slug, the short link, or
one it had before (`resolve` in `src/catalog.ts`).

`src/slugs.ts` gives every published evening without a link its own; drafts
get none, so a cancelled evening holds no link. The hourly sync does it
after the events (web/src/sync/run.ts). To run it now, from `core/`:

```sh
DATABASE_URL=… bun run slugs --dry-run   # the links it would give
DATABASE_URL=… bun run slugs             # give them
```

To move an evening to another link, add the new one to `event_slugs` for
it, then set `events.short_slug` to it (a foreign key holds the link to
the evening's own); the old one keeps redirecting.

## Ours, or shared

`events.curation` says whose evening an event is: `ours`, or `shared`,
someone else's evening we share with our community because we think it's
good. A shared event names who organizes it, `events.organized_by`, a
company in `sponsors` (the table that already holds companies with their
sites and handles, so pages link out and drafts tag them); the database
holds a shared event to having one, and only it. `Rows.Curation` is the
discriminated type: `{ kind: "ours" }` or `{ kind: "shared", organizer }`.

What follows from it:

- A shared evening is named as written, never allthings/<topic>
  (`eventTopic`), on its page, in lists, in feeds and on its card.
- /events and home list it in the same rows, marked "shared · by Mastra".
  Home's hero is always our next evening, and its photos are of ours.
- Its page says who organizes it, linked to their site, and has no "your
  hosts". Its structured data names the organizer, not us.
- /about's numbers count our evenings alone, and the people page and the
  speakers list (`list_speakers`, `/api/v1/speakers`) list who was on
  stage at ours; people from a shared evening are on its page.
- The MCP tools say whose an evening is: `curation` (`ours` or `shared`)
  and `organizer` (its name and site; null for ours), and the CLI marks a
  shared one "shared · by Mastra". The v1 API publishes `curation` and
  `organizedBy`.
- Completeness asks a shared evening for no organizers, MC or topic.
- Promotion drafts recommend it, by its organizer, and say why; it gets no
  Luma description or Meetup listing of ours.

`core/backfill/curation.json` names the shared evenings and their
organizers, sourced; an organizer the database lacks is added, one it has is
kept as it is. Run it from `core/`:

```sh
DATABASE_URL=… bun run curation --dry-run   # do everything, print it, roll back
DATABASE_URL=… bun run curation             # write
```

## Completeness

`src/completeness.ts` lists what each published event's record lacks. It's
a pure function over what one statement reads, so the same rows always give
the same report:

- talks, for an evening of talks (see "What kind of evening", below), and
  each listed talk's speakers and description
- the event's people and an organizer among them
- everyone named on the event: title, bio, photo, links
- hosts, with their logo and about, and their website and X, Bluesky or
  LinkedIn
- venue address, the lockup's topic, a description (the site's or
  Luma's), a tagline that is no placeholder or a summary to stand in for
  it, a cover
- for past events: photos, a recording link, and Luma's guest count

Links, cover, recording and guest count are optional; the rest is
required. Nothing reads text for meaning, so a description's tense is not
judged.

```sh
DATABASE_URL=$(op read "op://allthings/allthings site_reader/credential") bun run completeness          # table, then each event's gaps
DATABASE_URL=… bun run completeness --json   # the same, for tools
DATABASE_URL=… bun run completeness --check  # also fail if an evening of talks that ended in the last 30 days has none,
                                             # or any published evening, past or upcoming, has no venue
```

It only reads, so the read-only `site_reader` role is enough. The admin MCP
server (`app/scripts/mcp-server.ts`) serves the same JSON as
`get_completeness_report`. `.github/workflows/completeness.yaml` runs
`--check` against production every Monday and puts the report in the run's
summary.

## Posts about events

`event_posts` holds posts about each event on X, Bluesky and LinkedIn. Each
row has the post's canonical URL (unique), its plain text, its author, when
it was posted, and a status: `approved` shows, `hidden` was taken down,
`pending` waits for an organizer. Nothing approves itself. Images are kept
as their source URLs, and the app's hourly sync copies them into the media
bucket (`app/src/lib/post-images/`). Pages show only those copies.

`src/posts/` reads a post from public sources that need no key. X posts
come through the FixTweet API (api.fxtwitter.com), Bluesky posts through
the public AppView. LinkedIn serves nothing public, so its text and author
come from whoever adds the post; the time comes from the post's id. Then it
stores the post, approved. Adding a post that is already there changes
nothing.

```sh
DATABASE_URL=… bun run posts add <event slug> <post url> [--dry-run]
DATABASE_URL=… bun run posts add <slug> <linkedin url> --author-name "…" --text "…" [--author-url …]
DATABASE_URL=… bun run posts apply [--dry-run]   # every post in backfill/posts.json
```

The admin MCP server's `add_event_post` runs the same script.
`tests/posts.test.ts` runs against recorded answers; nothing in the tests
reaches X, FixTweet or Bluesky.

### Finding posts

`src/posts/candidates.ts` finds posts about evenings on its own. For each
evening it searches Bluesky's public search (`app.bsky.feed.searchPosts`,
keyless) and, once the X app has a token, X's search, for posts that link
the evening's Luma page or its page on the site, name it, or come from or
mention the people on its stage, from two weeks before it to a week after.
Each post is scored the same way every time (`scoreCandidate`: a link to
the evening, its name, "allthings" with its topic, a host, its people,
the night itself), and the ones that score at least 5 are added as
`pending`. Nothing is approved here: an organizer approves or hides each.

```sh
DATABASE_URL=… bun run posts find --dry-run          # the last week's evenings, scored, nothing written
DATABASE_URL=… bun run posts find --past             # every evening so far
DATABASE_URL=… bun run posts pending                 # what waits for review
DATABASE_URL=… bun run posts approve <post url>      # show it on its evening's page
DATABASE_URL=… bun run posts hide <post url>         # never show it
```

X is searched only with `X_BEARER_TOKEN` (1Password: "allthings X app" in
the `allthings` vault); recent search reaches seven days back, and
`X_SEARCH=archive` uses full-archive search where the app has it. The sync
Worker searches the last week's evenings on its schedule and queues what it finds as pending. As site_sync it can add posts
only through `public.queue_event_post` (migrations/0018_pending_posts.ts), a
SECURITY DEFINER function with its search path pinned that checks every
field and inserts nothing but pending posts; the role holds no INSERT on
`event_posts`, and EXECUTE is revoked from everyone else. The admin MCP server's `list_pending_posts`, `approve_post` and
`hide_post` run the same script.

## An evening's photos

`src/photos.ts` adds photos to an evening. Each file is re-encoded the way
the bucket keeps photos (`scripts/encode.ts`: upright, at most 4096 pixels on
its long edge, JPEG at quality 88, every bit of metadata stripped, so no
location), stored through the upload Worker under
`events/<event id>/<sha-256 of the file>.jpg`, and recorded in `images` and
`event_images`. Pages list an evening's photos by `event_images.created_at`,
so one run adds its photos in the order given, after those already there.
The key is the file's contents, so adding a file again changes nothing, and
an object an interrupted run stored is reused only when it serves exactly the
bytes made.
Objects are stored first, then one transaction writes every row.

Every photo needs its alt text, one `--alt` per file in the files' order,
saying what the scene shows ("Effect 4.0 merged live on stage at
CodeRabbit"), never naming people from their faces. HEIC is not read:
export JPEGs first. Run it from `core/` with the owner's connection string
and the upload Worker's URL and token (see `scripts/reencode-originals.ts`):

```sh
DATABASE_URL=… bun run photos add effect a.jpg b.jpg --alt "…" --alt "…" --dry-run   # encode, check, roll back
DATABASE_URL=… MEDIA_UPLOAD_URL=… MEDIA_UPLOAD_TOKEN=… bun run photos add effect a.jpg b.jpg --alt "…" --alt "…"
```

To replace one of an evening's photos, say with a retouched copy, name it by
its position on the page (from 1) or its image id. The new photo is encoded
and stored as above and takes the old one's place in the order. In the same
transaction the old link and its `images` row are deleted, and only when
nothing else points at that row (`imageReferences`, which a test holds to
the schema's foreign keys). That is checked before anything is stored, so a
refusal stores nothing, and again under the transaction's lock. The old
object stays in the bucket: nothing deletes one.

```sh
DATABASE_URL=… bun run photos replace effect 5 retouched.jpg --alt "…" --dry-run   # encode, check, roll back
DATABASE_URL=… MEDIA_UPLOAD_URL=… MEDIA_UPLOAD_TOKEN=… bun run photos replace effect 5 retouched.jpg --alt "…"
```

To take a photo off an evening, list its photos, then remove one by its
position on the page (from 1) or its image id. `--dry-run` prints exactly
what would change, and an approval token for it, and changes nothing.
`--approve <token>` makes that change in one transaction, after working it
out again under lock. It refuses if anything moved since the dry run: the
photo, its place, or what else points at its `images` row. The photo's link
is deleted. Its `images` row goes too, but only when nothing else points at
it; otherwise the output names what still uses it. The object stays in the
bucket, and the output says so. Neither step needs the upload Worker, and
`list` only reads.

```sh
DATABASE_URL=… bun run photos list effect                          # positions, image ids, alt texts
DATABASE_URL=… bun run photos remove effect 5 --dry-run            # what would change, and its token
DATABASE_URL=… bun run photos remove effect 5 --approve <token>    # exactly that change
```

The admin MCP server's `list_event_photos`, `add_event_photos`,
`replace_event_photo` and `remove_event_photo` run the same script.
`remove_event_photo` without `approve` is the dry run. `tests/photos.test.ts`
runs it against `tests/seed.sql` with a media origin that only keeps what it
is given.

### Home's photos

Home's mosaic shows photos picked by hand, in
`core/backfill/hero-photos.json`: real photos of our evenings that show how
big they are, full rooms and packed crowds facing a speaker. Each names its
image id, the evening it was taken at, and why it earns the spot. Home shows
the first three it can, in the file's order, and the first is the wide
tile. It shows each only as a photo of the evening it names, and skips one
it can't show: gone, off the media origin, not that evening's, or of an
evening that is a draft, someone else's or still ahead. When it can show
none, or the file lists none, it falls back to the first photo of each of
our latest evenings.

Replacing or removing a photo deletes its `images` row, so a picked one can
go. `bun run hero-photos` fails, naming each, when home can't show one of
them; `.github/workflows/hero-photos.yaml` runs it against production when
a pull request changes the file, on main, and every Monday.

```sh
DATABASE_URL=$(op read "op://allthings/allthings site_reader/credential") bun run hero-photos
```

### The home lab's wall, faces and tally

The home lab (`web/src/pages/lab/`, at /lab/home) tries heroes that show
how big allthings is. Beside home it reads `Community`
(`src/community.ts`), in one statement: the about page's tally (`held`
and `tally` in `src/about.ts`, which /about reads too), a wall of
photos, and faces.

- **The wall** is `core/backfill/wall-photos.json`: about forty photos of
  crowds and energy across many evenings, picked by looking at every photo,
  in the order the wall shows them. They are held to the hero photos'
  rules, and each carries its evening's date and short link. When the lab
  can show none of them, it shows every photo of our evenings held, latest
  first.
- **Every evening held** comes with the photo that stands for it, for the
  lab's contact sheet: its first on the wall, else its first attached, or
  none, latest evening first.
- **The faces** are `core/backfill/faces.json`: people who have been on
  stage at our evenings, by profile id, whose profile photo is of them (a
  logo or a drawing is left out). The lab shows each while the profile has
  a photo on the media origin and has been on stage at one of our evenings
  held. When it can show none, it shows everyone on stage with a photo,
  latest first.

`bun run hero-photos` checks the wall and the faces with home's photos,
and the workflow runs it when any of the three files changes.

## Schedules and notes

Some events' pages say more than the record: a hackathon's schedule, its
awards, theme and how teams form. `event_schedule_items` holds an event's
schedule in order, each step's time as the organizers wrote it ("1 - 7 pm",
"~7:00 pm"); `event_notes` holds rows of the page under their own label
("Awards", "Theme"), with bodies in editor HTML that are sanitized as talk
descriptions are. `EventPages` reads both, and the Worker's event page shows
a Schedule row and a row per note.

`core/backfill/event-extras.json` carries what the app's own pages for four
events said (three hackathons at Sentry and NextDev.fm Live), with the pages
as sources. Who hosted NextDev.fm Live and who was its guest is in
`core/backfill/lineups.json`: a fireside chat its hosts moderated.

For each event the file names, it is the whole schedule and the whole set
of notes: applying replaces anything else, and changes nothing where the
database already matches. Run it from `core/`:

```sh
DATABASE_URL=… bun run event-extras --dry-run   # do everything, print it, roll back
DATABASE_URL=… bun run event-extras             # write
```

## Filling in profiles

`backfill/people.json` fills what profiles of people on published events
lack: a title, a bio, X, Bluesky and LinkedIn handles, and a photo. Every
fact carries the URL it was read from and the day it was read, taken from
public, keyless sources: the person's own X or Bluesky profile, GitHub,
their site, a company team page or a conference speaker page.

- A filled column is kept; only blank ones (or handles stored as empty
  strings) are set. The one exception: a fact may name the exact stale value
  it replaces (`was`), and replaces it only while the column still holds
  just that. A photo source is never replaced once its image is copied.
- A title is the person's job title at the time of their evening, or
  their latest known title where no source gives one from then.
- A bio is the person's own words, at most trimmed or put in the third
  person; a terse profile line is no bio.
- A photo is only ever a `photo_source_url` on a host the hourly ingestion
  copies from (`app/src/lib/profile-photos/hosts.ts`), which then makes it
  the profile's image.
- Anything uncertain, a same-name collision above all, is kept under
  `held` with its reason and never written.

```sh
DATABASE_URL=… bun run people --dry-run   # what would be filled, rolled back
DATABASE_URL=… bun run people             # fill it, in one transaction
```

### A photo from a file

`bun run people photo` sets a profile's photo from a local file, for a person
whose photo no public source has. The profile is named by its id, its slug
(as `/people/<slug>` has it) or its exact name, if only one profile has it.
The file is encoded as the photos are (upright, at most 4096 pixels on its
long edge, JPEG, or WebP where it is see-through, every bit of metadata
stripped). It is stored through the upload Worker and recorded in `images`,
with the old admin's key and alt text: `profiles/<name>-<image id>.<jpg|webp>`
(`profilePhotoKey`, as the ingestion keys photos) and the person's name.
`src/profile-photo.ts` sets it through `src/image-columns.ts`, as
`hosts logo` sets logos:

- **Deterministic.** The image id comes from the profile and the file's
  SHA-256, so the dry run names the exact id, key and URL.
- **`--dry-run`** prints exactly what would change, and an approval token for
  it. It stores and writes nothing.
- **`--approve <token>`** refuses before storing anything unless the change
  still hashes to the token. It checks the token again in its transaction,
  with the profile and its old photo locked.
- **The old photo** loses its `images` row only when nothing else points at
  it, such as a post's author avatar. Its object stays in the bucket.

```sh
DATABASE_URL=… bun run people photo ada-lovelace ada.jpg --dry-run
DATABASE_URL=… MEDIA_UPLOAD_URL=… MEDIA_UPLOAD_TOKEN=… bun run people photo ada-lovelace ada.jpg --approve <token>
```

## Hosting companies' links

Each hosting company (`sponsors`) may store its own website, its X, Bluesky
and LinkedIn handles and its Luma account, each checked for its shape by the
database (the Luma account is also unique: one company per account; the
people import attaches the company to the events Luma lists it as a host
of).
The event page links a host's name to its site, promotion drafts tag and
link hosts, and the completeness report flags a host without a website or
without any handle.

`backfill/hosts.json` holds them as researched from each company's
official site and profiles, every fact with the URL it was read from.
What could not be confirmed is left out, or kept under `held` with its
reason, and never written. A company the database doesn't hold yet is added
when its entry says what it does (`about`, sourced).

```sh
DATABASE_URL=… bun run hosts --dry-run   # what would change, rolled back
DATABASE_URL=… bun run hosts             # write it, in one transaction
```

Applying is safe to repeat; a column the file doesn't name is left as it is.

### Their logos

`bun run hosts logo` sets a company's two square logos from local files: one
for dark backgrounds (`square_logo_dark`) and one for light
(`square_logo_light`). The company is named by its exact name or its id.
Each file is encoded as the photos are (`scripts/encode.ts`: upright, at most
4096 pixels on its long edge, JPEG, or WebP where it is see-through, every bit
of metadata stripped). It is stored through the upload Worker and recorded
in `images`, with the old admin's key and alt text:
`sponsors/<name>-<dark|light>-<image id>.<jpg|webp>` and "Acme dark logo".
`src/host-logos.ts` sets them through `src/image-columns.ts`.

- **Deterministic.** The image id comes from the column, the company and the
  file's SHA-256. So the dry run names the exact id, key and URL, and setting
  the same file again changes nothing.
- **`--dry-run`** encodes and reads, and prints exactly what would change and
  an approval token for it. It stores and writes nothing, and needs no upload
  credentials.
- **`--approve <token>`** works the change out again and refuses before
  storing anything unless it hashes to the token. It stores each new object,
  checks the media origin serves exactly those bytes, and then, in one
  transaction with the company and the logos it replaces locked, checks the
  token once more and writes.
- **A replaced logo** loses its `images` row only when nothing else points at
  it (`imageReferences`); otherwise the output names what still uses it. Its
  object stays in the bucket.

```sh
DATABASE_URL=… bun run hosts logo Acme --dark acme-dark.png --light acme-light.png --dry-run
DATABASE_URL=… MEDIA_UPLOAD_URL=… MEDIA_UPLOAD_TOKEN=… bun run hosts logo Acme --dark acme-dark.png --light acme-light.png --approve <token>
```

## Promotion drafts

`src/promo/` drafts an evening's promotion from its record, in the brand's
voice (`brand/foundations.md`): the Luma description with every speaker
and their bio, the Meetup cross-post (seats-on-Luma notice, five topics,
the host's named place, and a checklist of the settings Meetup only takes
by hand), and posts for X, Bluesky, LinkedIn and Discord to announce the
evening, on the day, and after. People and hosting companies are tagged
by their stored handles, and descriptions link hosts to their sites;
the recap counts photos and approved posts and thanks those who posted.
Each draft is the richest of its candidates that fits its platform's limit
(`src/promo/limits.ts`), and what the record lacks is listed first as gaps.
Drafts only: nothing posts.

```sh
DATABASE_URL=… bun run promo <slug>                              # every draft, as text
DATABASE_URL=… bun run promo <slug> --channel x --channel meetup # only these
DATABASE_URL=… bun run promo <slug> --json                       # with each draft's length and limit
DATABASE_URL=… bun run promo <draft slug> --draft                # drafts for a draft evening, as the studio reads it
```

Meetup crops covers to 16:9, which would cut a square Luma cover.
`bun run promo:cover <slug> [--out <file>]` writes the evening's stored
cover centered on black in the smallest exact 16:9 frame that holds it,
unscaled (`scripts/pad-cover.ts`), by default to the system's temporary
directory.

It only reads. The admin MCP server's `get_promo_drafts` runs the same
script. `tests/promo.test.ts` keeps each seeded evening's drafts as golden
files in `tests/fixtures/promo/`; after an intended change, regenerate them
with `UPDATE_GOLDEN=1 bun test tests/promo.test.ts` and read the diff.

### The launch kit

`src/promo/launch.ts` drafts the rebrand's announcement: an X thread, posts
for Bluesky, the LinkedIn company page and Discord, the Luma calendar's
newsletter, an announcement for each Meetup group the evenings are listed
in, and a note for /about's history. It says what changed (the name and
the domain, short links, person pages, shared evenings, the at/hack
starter) and names the next evening. What isn't settled is one value with
a placeholder and a gap: the X handle (`launchXHandle`) and the next
evening. A checklist of what has to be true before posting comes first.

```sh
bun run promo:launch                                  # every draft, placeholders for what isn't settled
bun run promo:launch --channel x --channel discord    # only these
bun run promo:launch --x-handle allthingsdev          # before launchXHandle is set
DATABASE_URL=… bun run promo:launch --next <slug>     # naming a published, upcoming evening of ours
```

Only `--next` reads the database. `tests/promo-launch.test.ts` keeps the
kit with placeholders and settled as golden files; regenerate them with
`UPDATE_GOLDEN=1 bun test tests/promo-launch.test.ts`.

## Planning

Every evening starts in `planning`, a Postgres schema of its own
(`migrations/0012_planning.ts`): ideas for evenings (title, pitch, program,
topic, and a status from `idea` through `drafting` to `scheduled`, or
`dropped`, linked to the draft evening it becomes and to a past one it
builds on), speakers we'd like on stage (a profile, or a contact without
one) with their topics and when they're free or not, companies we'd like
to host (one we know, or a new name) with who to talk to and when each last
hosted, notes on the people and companies we know, and an unpublished
evening's lineup (`draft_people`, `migrations/0024_draft_lineup.ts`): its
organizers, co-hosts and MC, which readiness reads for the draft and
publishing copies to the evening's public lineup. Nothing about an
unpublished evening goes into `core/backfill/lineups.json`, which is the
lineup of published ones.
Each publish is claimed in `publishes` before it writes anything, so two
never overlap, and recorded published once Luma says so; from the claim
on, the private lineup can't change.

The schema is public; the rows are private. site_reader and site_sync are
never granted the schema, so no grant on `public`, not even one on every
table in it, reaches planning, and `tests/planning-privacy.test.ts` proves
both roles, made with their scripts' own statements, are refused. The same
test fails if any seed, fixture or backfill in this repository holds
planning rows: they live only in the database, written through the CLI.

`src/planning/` is the service, and `bun run plan` its CLI. It writes as the
database owner, the only role that may use the schema. Each change runs in
one transaction and prints the row as it now is; every command takes
`--json`, which the admin MCP server's planning tools (`add_idea`,
`list_wanted_speakers`, `search_planning`, `audit_planning` and the rest)
read, so the tools and the CLI can never disagree. People and companies are
named by id or exact name, events by slug, and a name two rows share is
refused with both ids. Every command that writes takes `--dry-run`: the write runs in a
transaction that is rolled back, so it prints exactly what it would be and
keeps nothing. Run it from `core/`:

```sh
DATABASE_URL=… bun run plan idea add --title "…" --pitch "…" --program social --inspired-by <slug> --dry-run   # what it would be; kept: nothing
DATABASE_URL=… bun run plan idea add --title "…" --pitch "…" --program social --inspired-by <slug>
DATABASE_URL=… bun run plan idea update <id> --status drafting --event <draft slug>
DATABASE_URL=… bun run plan speaker add --profile "Ada Lovelace" --topic effect \
  --window '{"startsOn":"2027-01-01","note":"free after Dec"}'
DATABASE_URL=… bun run plan speaker list --topic effect --available-on 2027-01-14
DATABASE_URL=… bun run plan host add --sponsor CodeRabbit --contact-name "…" --note "…"
DATABASE_URL=… bun run plan note add --profile "Ada Lovelace" --body "…" --author Erik
DATABASE_URL=… bun run plan lineup set <draft slug> --mc "Erik Thorelli" --organizer "Erik Thorelli" --organizer "Andre Landgraf" --dry-run
DATABASE_URL=… bun run plan lineup show <draft slug>
DATABASE_URL=… bun run plan search "trivia"
DATABASE_URL=… bun run plan audit   # fails if site_reader, site_sync or PUBLIC may reach planning
```

## Readiness

`src/readiness/` says whether a draft evening is ready to go out, and what
to add. A draft is an event the Luma sync stored as one (a private or
cancelled Luma event), named by slug, or an idea from planning, named by id:
through its draft evening when it has one, else on its own, with everything
still to do. Its checks and rankings are pure functions of what the database
holds at the Clock's now.

A draft that came from an idea is checked as the idea's kind of evening (a
social, a hackathon): the program is kept in planning, private, while the
evening is a draft, and publishing writes it to the event. A dropped idea
no longer counts.

**Checks.** The completeness rules run ahead of time, all but the ones only a
past evening can have (photos, a recording, a guest count): what the report
requires blocks publishing, the rest is advice. Then what only a draft is
asked:

- it is still a draft, and has a private Luma event
- it starts ahead, ends after it starts, starts in the evening and runs at
  most six hours (a hackathon may do neither)
- nothing of ours is published the same San Francisco day; a draft or a
  shared evening that day is advice
- its venue is named and has a known neighborhood (`src/places.ts`)
- a hackathon has its schedule
- once the Luma event exists (for an evening of ours), its cover is ours:
  `bun run luma cover` set and recorded it, and the facts it says (day,
  place, hosts, link) are still the evening's. A cover that isn't ours
  (Luma's default, or one set by hand) blocks, and so does one drawn
  before a fact changed; the site's copy of it, which the hourly
  ingestion stores, is advice

**Suggestions,** each ranked deterministically, so the same rows suggest
the same in the same order:

- network speakers whose past talks share the most of the evening's words
  (its topic, the idea's, and any `--topic` given), then the most recent
- wanted speakers whose topics share one, free that day
- host prospects, and hosts that last had us more than 90 days ago,
  longest first
- open dates on the three weekdays our evenings have been on most, with
  nothing else that day and none of ours within three days
- the guest count of the evening it builds on (no guest lists are stored)

Planning's rows join only as a role that may read planning (the owner); as
site_reader the report leaves them out and says so.

```sh
DATABASE_URL=… bun run readiness --event <draft slug> [--topic git --topic ai] [--json]
DATABASE_URL=… bun run readiness --idea <id>
```

It exits 1 when something blocks publishing, 2 on a draft that isn't there.
The admin MCP server's `get_draft_readiness` runs the same script.

## Collaborating on a draft

An organizer can invite outside collaborators to help make one evening:
guest round hosts, a venue contact, a promo partner. They work on our own
site, in the draft preview (web/src/preview/), never in a shared document.
This is the design. It is being built in small pull requests, each
described where it lands. Until a piece is here, the studio does that part
by hand.

**Who.** Each invitation is a row in `planning.collaborators`: an email,
the name the others see, and a role. An invitation expires a few days
after its evening ends, so collaboration carries on after the evening
goes public (round hosts hand in after the announcement) and stops on its
own.

| Role         | Sees                                   | Writes                                        |
| ------------ | -------------------------------------- | --------------------------------------------- |
| `viewer`     | the page, the brief's sections for it  | nothing                                       |
| `commenter`  | the same                               | comments                                      |
| `round_host` | the same, and their own round          | comments, their round's questions and answers |
| `venue`      | the same, and the logistics            | comments, logistics answers                   |
| `organizer`  | everything on that evening, and emails | comments                                      |

The stack's organizers (`PREVIEW_VIEWERS`, infra/src/preview.ts) are
organizers of every evening. Only the studio invites, through
`bun run collab invite … --dry-run | --approve <token>`, never the site.
Revoking takes effect on the collaborator's next request.

**Signing in, twice over:**

- **At the edge.** The preview's Access application admits the organizers,
  and an Access email list, "draft collaborators", that the studio keeps
  equal to the active invitations whenever it invites or revokes. Revoking
  also ends the person's Access sessions. The list's emails are never in
  this repository. The studio does this with its own Cloudflare token,
  limited to Zero Trust (infra/scripts, in 1Password as "allthings zero
  trust").
- **In the Worker,** in two steps on every request:
  - _Who signed in._ It verifies the token Access signs, as it does now:
    the signature against the team's keys, the issuer, this application's
    audience, the times, and an email. The check against `PREVIEW_VIEWERS`
    moves out of this step, so an invited email passes it.
  - _What they may do._ An organizer is someone on the stack's list. A
    collaborator has an active invitation to the evening, read from the
    database through a Hyperdrive that never caches, so a revoked one is
    refused at once. Anyone else gets the answer of an evening that
    doesn't exist, as before: Access let them in, and the Worker shows
    them nothing.

**What collaborators do.** Everything they write is a submission or a
comment, and only ever added. Organizers accept or reject through the
studio, and anything that changes the evening's own record goes through the
commands that already change it (`bun run luma update`, `bun run plan`).
The site has no accept action, and no collaborator writes `public` or Luma.

- **The brief** is stored a section at a time (`brief_sections`), each with
  the roles it is for. Sections about relationships, other venues, or
  people not yet asked are for organizers only.
- **Tasks** carry a due date and are for everyone, for a role, or for one
  person: "first drafts of your 8 + 1 by Tue Oct 20".
- **A round host's questions and answer key** (`round_submissions`): the
  answer-key format as a form, each save a new row. Only that round's hosts
  and the organizers ever see it. Players never do.
- **The venue** answers each logistics item in the panel: yes, no or unsure, with a note of up to 1000 characters if it needs one. Each answer is a new row, and the latest shows, with its review. Only the venue and the organizers see the items, and only the venue answers them (`POST /<slug>/logistics`, through the same checks as every form).
- **Comments** on the evening, a section, or a round. A comment on a round
  shows only to its hosts and the organizers. They're plain text, and the
  studio can hide one.

**Security:**

- **Least privilege.** The Worker writes as `draft_collab`, a login role
  made like site_sync (infra/scripts/draft-collab.ts). It holds column
  grants on these tables alone, adds rows without changing or deleting
  any, and has statement timeouts. Not the owner: the owner reads all of
  planning (contacts, notes on people, sent posts) and writes `public`, and
  the Worker that takes outsiders' input is the code most exposed.
  site_reader and site_sync are never granted any of it
  (tests/planning-privacy.test.ts).
- **Row security.** Every table has it. The policies read who is asking from
  `collab.email` and `collab.organizer`, which the Worker sets in each
  transaction from the verified token. So the database itself, and not only
  the Worker's queries, keeps one evening from another and one host's round
  from the next. The policies ask `SECURITY DEFINER` functions
  (`planning.collab_*`), so the role never reads a collaborator's email
  unless it organizes that evening.
- **Answer keys are encrypted at rest** with AES-256-GCM. The Worker seals
  each submission with a key it holds as a secret (kept in 1Password too).
  The row's ids are bound into the seal, so a ciphertext can't be moved to
  another host's row, and each row names its key, so the key can be
  rotated. This doesn't protect against a compromised Worker. It does keep
  answers out of database dumps, branches of production, and any tool that
  prints planning's rows. `bun run collab export` decrypts a round for the
  night into a file, not the terminal.
- **Forms, with no scripts.** The pages run no JavaScript, as the site's
  don't. Forms post to the same page, which then redirects. Every write
  needs:
  - a same-origin request (`Origin`, or `Sec-Fetch-Site: same-origin`);
  - a form token: an HMAC of the signer, the evening, the form, and when
    Access signed them in, keyed by a Worker secret;
  - form encoding, under a size limit.

  Each form is decoded with Effect Schema: trimmed and normalized text,
  capped lengths, closed lists, https sources, exactly the round's number
  of questions. Which round and evening a write is for comes from the
  invitation, never from the form. The preview's Content-Security-Policy
  gains `form-action 'self'` and nothing else: still no script source.

- **Rate limits,** counted from the audit in the same transaction as the
  write (`planning.collab_recent_actions`), so they are deterministic and
  tested.
- **The audit.** `collab_audit` records every action: each write, each view
  of a round, each refused evening. It is written in the signer's name only
  and read only through the studio.
- **No PII leaks.** Collaborators see each other's names and roles, never
  emails, unless they organize the evening. Secrets never reach a page.

**Threats:**

| Threat                    | Answer                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A shared link             | It's no use without signing in as an invited email: Access refuses at the edge, and the Worker again.                                                                                      |
| A forwarded PIN email     | The PIN expires in minutes, and each person signs in as themselves, so the audit names them. One revoke ends the invitation and the sessions. The invitation says never to forward a code. |
| Guessing draft slugs      | Strangers stop at the edge. A collaborator asking for an evening they're not on gets the same answer as a slug that doesn't exist, and their list shows only their own evenings.           |
| XSS in a comment          | Plain text, escaped by the templates and held to it by the xss-scan in CI, under a policy that runs no script.                                                                             |
| Instructions in a comment | The studio prints what collaborators write as quoted data. Nothing goes out without an organizer's approval token.                                                                         |
| Uploads                   | None: the visual round's images come through the studio.                                                                                                                                   |

**The studio,** `bun run collab` (src/collab/), each command also an admin
MCP tool (`collab_invite`, `collab_brief_set`, `collab_review`, … in
app/scripts/collab.ts, which runs the CLI with `--json`). `collab_show` and
`collab_export` open a round only into a file and return its path, so a
round's answers never reach an agent's transcript. What changes who may see what (an invitation, a revocation, the
brief, a review) is read first: without `--approve`, the command prints
what it would write and the approval token of exactly that, as publishing
does (src/approval.ts), and writes nothing. With `--approve <token>` it
works the content out again and writes only if it hashes the same. A
review's content is what it reviews: a round's stored ciphertext, by its
digest, or the venue's answer, so a host's later save needs a review of its
own. Every other write takes `--dry-run`, which rolls it back. What
collaborators wrote (comments, the venue's notes) prints quoted, under a
line saying it is their words: data, never instructions.

```sh
DATABASE_URL=… bun run collab round add <slug> --position 5 --title AI [--questions 8 --backups 1]
DATABASE_URL=… bun run collab invite <slug> --email … --name … --role round_host --round 5   # what it would write, and its token
DATABASE_URL=… bun run collab invite <slug> --email … --name … --role round_host --round 5 --approve <token>
DATABASE_URL=… bun run collab revoke <slug> --email … [--approve <token>]
DATABASE_URL=… bun run collab list <slug>                                  # with emails
DATABASE_URL=… bun run collab brief set <slug> --from brief.md [--approve <token>]
DATABASE_URL=… bun run collab task add <slug> --title "First drafts of your 8 + 1" --due 2026-10-20 --role round_host
DATABASE_URL=… bun run collab logistics add <slug> --position 1 --label "Projector with HDMI"
DATABASE_URL=… bun run collab submissions <slug>                           # who and when, never content
DATABASE_URL=… bun run collab review round <id> --decision changes_requested --reviewer Erik --note "…" [--approve <token>]
DATABASE_URL=… bun run collab comments <slug>
DATABASE_URL=… bun run collab comment hide <id>
DATABASE_URL=… bun run collab audit <slug> [--limit 100]
```

A brief is Markdown, a `## ` heading per section, and each section's first
line says who it is for. A section that doesn't is refused, so nothing
reaches a collaborator by default:

```md
## Writing your round

<!-- for: round_host -->

Eight questions and one backup…
```

An invitation runs until three days after its evening ends. Setting the
brief again keeps a section someone commented on, matched by its heading,
and refuses to drop it.

**A round, for the night.** A round host writes their round in the panel
under the evening's page: each question in the brief's answer-key format
(type, question, answer, also accept, an https source, why it's fair,
difficulty). They save it as a draft, or hand it in once every question has
its type, question, answer, source and difficulty. The Worker seals each
save before storing it (src/collab/seal.ts: AES-256-GCM, the row's ids
bound in, the key named by its id) with `COLLAB_ANSWERS_KEY`. The form
opens again with the latest save. Only that round's hosts and the organizers
ever see it, and each time one is opened is a line in the audit. For the
night, the studio opens a round with the same key, into a new file only its
owner may read. It prints only the file's path and digest, never the
answers, unless asked for `--stdout`:

```sh
COLLAB_ANSWERS_KEY=$(op read "op://allthings/allthings collab answers key/credential") \
  DATABASE_URL=… bun run collab export <slug> --round 5 --out round-5.md   # the latest handed in
DATABASE_URL=… COLLAB_ANSWERS_KEY=… bun run collab show <submission id> --out save.md
```

**The edge.** An approved invitation or revocation also sets Access's list
of collaborators to every active invitation, and a revocation ends that
person's Access sessions (src/collab/access.ts). Both need the studio's
token, `CLOUDFLARE_ZERO_TRUST_TOKEN` ("allthings zero trust" in 1Password;
infra/README.md, "The studio's Zero Trust token"), passed without printing
it. Without the token, an approval writes nothing. If Cloudflare fails
after the database was written, the command says so: the Worker already
enforces the change, and `collab access sync` finishes it.

```sh
CLOUDFLARE_ZERO_TRUST_TOKEN=$(op read "op://allthings/allthings zero trust/credential") \
  DATABASE_URL=… bun run collab invite <slug> … --approve <token>
DATABASE_URL=… CLOUDFLARE_ZERO_TRUST_TOKEN=… bun run collab access sync [--dry-run]   # the list, set to the invitations
CLOUDFLARE_ZERO_TRUST_TOKEN=… bun run collab access end-sessions --email …
```

Readiness reports what the collaboration still needs (src/readiness/collab.ts),
as advice: a round with no host, not handed in (late once its hosts' task
date has passed), or handed in and not accepted; anything the venue hasn't
confirmed and had accepted; and a task past its date. None of it blocks
publishing: an evening goes out on Luma well before its rounds are due.

**On the page.** The draft's page as the public will see it, and below it
a "for collaborators" panel in the site's own design:

- your role and who else is on the evening;
- your tasks with their dates;
- the brief's sections for you;
- your form;
- the comments.

It has the same grid, rules and type, and layout tokens only.

## Putting an evening out on Luma

`src/luma/publish.ts` takes an evening's Luma event from private draft to
public through Luma's official API (`src/luma/write.ts`: `events/create`,
`events/update`, `events/get`, `images/create-upload-url`, and the
two-step `events/cancel`, each as docs.luma.com documents it), with the
calendar's key in `LUMA_API_KEY`:

- `create` makes the event **private**, always, in San Francisco's time
  zone, from an idea's pitch when one is named. The calendar feed never
  carries a private event, so `luma:drafts --add` stores it as a draft
  (see "Drafts the feed doesn't carry"), which readiness checks and the
  draft preview shows.
- `update` changes a private event: name, times, place (`--venue` for a
  place Google Maps knows, so its name shows; `--address` as written), the
  description the promotion drafts write. Never a cover: that is
  `luma cover`'s, drawn from the evening's facts (see "Its cover").
  `--description-from-idea <id>` sets the description to an idea's pitch
  again, as `create` did, after the pitch changes.
  A public event is refused.
- `publish --dry-run` prints exactly what would go out: the event
  as Luma has it, with the drafts' description, and its approval token,
  the first 16 hex digits of the SHA-256 of that content as canonical
  JSON. It refuses while readiness finds a blocker, and while the cover
  Luma shows isn't the one we set and recorded: Luma's default, or any
  other (readiness reads only the record). With `--approve
<token>` it works the content out again and goes on only if it hashes
  the same, sets the description and the visibility in one update, and
  reads the event back to check both took.
  An evening of ours (not shared) with no talks on record that comes from
  an idea (a trivia night, a social) publishes with the idea's pitch
  instead: the drafts write their description from talks, and it has none.
  A shared evening is refused, as before.
  Publishing also writes the program of the idea the evening came from to
  its event, which until then kept the program the sync gave it.
- `cancel-test` deletes only a private test event named "allthings API
  test…" with no guests.

Writes are sent once: a timed-out create may have happened, and a retry
could make a second event. Every write has `--dry-run`, which prints the
body and sends nothing. Nothing in the tests reaches Luma.

```sh
LUMA_API_KEY=… DATABASE_URL=… bun run luma create --name "…" \
  --start 2026-11-18T18:00:00-08:00 --end 2026-11-18T21:00:00-08:00 --venue "CodeRabbit, 201 Spear St" --idea <id> --dry-run
LUMA_API_KEY=… DATABASE_URL=… bun run luma update --event <draft slug> --description-from-drafts --dry-run
LUMA_API_KEY=… DATABASE_URL=… bun run luma update --luma evt-… --description-from-idea <id> --dry-run
LUMA_API_KEY=… DATABASE_URL=… bun run luma publish <draft slug> --dry-run          # what would go out, and its token
LUMA_API_KEY=… DATABASE_URL=… bun run luma publish <draft slug> --approve <token>  # exactly that, public
LUMA_API_KEY=… bun run luma show evt-…                                             # the event as Luma has it
```

### Its cover

Every evening's Luma cover is allthings-branded and its own, never one of
Luma's defaults (images.lumacdn.com/gallery-images/, what a new event
starts with). `src/cover.ts` says what the cover says, from the evening as
its page reads it: allthings/<topic> (or the name, where it yields no
topic), with the cursor while it is ahead; its day, hour and year in San
Francisco; its neighborhood; who hosts it, or the venue's name with no host
on record; its short link, the one a draft gets when it is published; and
its mode, Night or Paper. The brand's template draws those facts, square,
with uv (`brand/marks/cover.py`). Same facts, same pixels.

`bun run luma cover` sets it, as publish does, in two steps:

- `--dry-run` draws the cover, writes the PNG to look at (`--out`, or a
  fresh temporary directory), says what it replaces on Luma (Luma's
  default, the one we last set, or another) and prints the approval token:
  the first 16 hex digits of the SHA-256 of the event, the facts, the PNG's
  SHA-256 and the cover it replaces, as canonical JSON. It sends nothing.
- `--approve <token>` draws and works it out again, and goes on only if it
  hashes the same: a fact or Luma's cover changed in between stops it. It
  uploads the PNG to Luma's CDN, sets it on the event, reads the event back
  to check it took, and records it on the evening: `generated_cover_url`
  (as Luma reads it back), `generated_cover_sha256` and
  `generated_cover_facts` (the facts' approval token), from
  migrations/0025_generated_cover.ts. It lets go of the evening's stored
  copy of the old cover, so the hourly image ingestion stores the new one.

Readiness compares against that record (see "Readiness"), and publishing
against Luma itself: an evening of ours goes out only with the cover we
set, saying what its facts say now.

Only a private event of ours is changed. A public one changes only through
publish and a shared one's Luma page is its organizer's; a public
evening's cover is still drawn to look at, and the dry run exits 1 saying
why it wouldn't be set.

```sh
LUMA_API_KEY=… DATABASE_URL=… bun run luma cover <draft slug> --dry-run      # draw it, read it, and its token
LUMA_API_KEY=… DATABASE_URL=… bun run luma cover <draft slug> --approve <token>
LUMA_API_KEY=… DATABASE_URL=… bun run luma cover evt-… --dry-run --out cover.png
```

Nothing in the tests reaches Luma or runs uv: `tests/luma-cover.test.ts`
draws with a stand-in renderer, and `uv run generate.py --check` in
brand/marks holds the template to two past evenings' covers.

### The calendar

`src/luma/calendar.ts` holds what the Luma calendar's page should say, and
sets it through Luma's API (`calendars/update`):

- the name: allthings;
- the two sentences from brand/foundations.md;
- Bridge, the slash's color, as its tint;
- the site, and the channels the site's footer lists (web/src/links.ts);
- the a/ app icon as its avatar (app/public/brand/icon-512.png).

`tests/luma-calendar.test.ts` holds each of these to its source. The address
changes only with `--slug`, because links to luma.com/allthingsweb are
everywhere. It works the way publish does:

- `--dry-run` prints each field that differs, from what to what, and its
  approval token.
- `--approve <token>` makes exactly those changes in one update. It uploads
  the avatar if Luma's isn't the same image, then reads the calendar back to
  check each change took.

Luma's API can't set a calendar's cover or its social preview image, so an
organizer uploads those in the calendar's settings: `brand/covers/calendar.png`
and `brand/og/og-home.png`.

```sh
LUMA_API_KEY=… bun run luma calendar --dry-run                    # what differs, and its token
LUMA_API_KEY=… bun run luma calendar --dry-run --slug allthings   # and move it to luma.com/allthings
LUMA_API_KEY=… bun run luma calendar --approve <token> [--slug allthings]
```

## Posting to Bluesky

`src/social/announce.ts` posts an evening's Bluesky draft (the promotion
drafts' announce, day-of or recap text) from @allthingsweb.dev, exactly as
an organizer approved it, through the AT Protocol (`src/social/bluesky.ts`:
`createSession` on bsky.social, `createRecord` on the account's PDS, and
`resolveHandle` and `getAuthorFeed` on the public AppView):

- `--dry-run` reads only: it prints the post, with a facet for every link
  and every mention whose handle Bluesky resolves (by UTF-8 byte offsets;
  a handle it doesn't stays plain text), says whether our account already
  posted that text, and prints its approval token, the first 16 hex digits
  of the SHA-256 of the account, evening, moment and post as canonical
  JSON (`src/approval.ts`, which Luma publishing shares). It needs no
  password.
- `--approve <token>` makes the post again and goes on only if it hashes
  the same, our account hasn't posted that text, and the app password
  signs in as our DID. Then it posts once: a post Bluesky didn't take is
  never retried, and the feed check stops a second try from doubling it.

The app password is the 1Password item "allthings Bluesky" (`handle`,
`app password`). Nothing in the tests reaches Bluesky.

```sh
DATABASE_URL=… bun run social bluesky <slug> --moment announce --dry-run   # the post, and its token
DATABASE_URL=… BLUESKY_HANDLE=… BLUESKY_APP_PASSWORD=… \
  bun run social bluesky <slug> --moment announce --approve <token>        # exactly that, once
```

## Sending to the Discord

`src/social/announce-discord.ts` sends an evening's Discord draft to our
server through its channel webhook (`src/social/discord.ts`: `GET` the
webhook, and `POST` it with `?wait=true`, as Discord's docs describe them),
exactly as an organizer approved it. `allowed_mentions` is empty, so no
text in a draft can ping anyone.

A webhook can post but can't read the channel, so `planning.sent_posts`
(`migrations/0021_sent_posts.ts`, `src/social/sent-posts.ts`) records
what was sent: one row per channel, evening and moment.

- `--dry-run` reads only. It prints the message, the server and channel
  the webhook posts to, whether that moment was already sent, and the
  approval token. The token covers the webhook, its channel, the evening,
  the moment and the message.
- `--approve <token>` makes the message again and goes on only if it
  hashes the same and nothing was sent or started for that moment. Then
  it claims the moment, sends once and records the message's page.
  - If Discord refuses the message (4xx), the claim is dropped.
  - If there's no answer (30 seconds at most), or a 5xx, the claim is kept
    as `unanswered`, since the message may be out. Nothing goes out again
    until an organizer has looked in the channel and settled it:
    - `--sent <message id>` when the message is there. The webhook reads
      it back by id, and it must hash to the approved token, even if the
      draft has changed since.
    - `--release` when it isn't, so it can be approved again.
  - A claim still `sending` five minutes on counts as unanswered (its
    process died). One that is younger is still going, so neither command
    touches it.
  - A sent message is never released.

The webhook URL is the 1Password item "allthings Discord webhook" (`url`).
It is a secret: nothing prints it. The record is in the planning schema,
so `DATABASE_URL` is the database owner. Nothing in the tests reaches
Discord.

```sh
DATABASE_URL=… DISCORD_WEBHOOK_URL=… bun run social discord <slug> --moment dayOf --dry-run          # the message, where it goes, its token
DATABASE_URL=… DISCORD_WEBHOOK_URL=… bun run social discord <slug> --moment dayOf --approve <token>  # exactly that, once
DATABASE_URL=… DISCORD_WEBHOOK_URL=… bun run social discord <slug> --moment dayOf --sent <message id>  # record the message an unanswered send left
DATABASE_URL=… bun run social discord <slug> --moment dayOf --release                                # let go of an unanswered send that left none
```

## Posting to X

`src/social/announce-x.ts` posts an evening's X draft as @allthingswebdev,
exactly as an organizer approved it, through X's API v2 (`src/social/x.ts`).

What went out is recorded in `planning.sent_posts`, as for Discord (see
"Sending to the Discord"), with the exact text approved
(`migrations/0022_x_sent_posts.ts`). Nothing reads our posts on X to find
out.

- `--dry-run` reads only, and nothing from X. It prints the post, the
  moment's record (not posted yet, sent, or not settled), and the approval
  token (the SHA-256 of the account, evening, moment and text). It doesn't
  sign in.
- `--approve <token>` makes the post again and goes on only if it hashes
  the same and nothing was posted or started for that moment. It claims
  the moment, then, in order:
  1. Signs in with the stored OAuth 2.0 refresh token, as the app
     (`X_CLIENT_ID`, `X_CLIENT_SECRET`).
  2. Stores the new refresh token X hands back, before anything else.
     X spends a refresh token when it is used.
  3. Checks that the sign-in is our account (`/2/users/me`).
  4. Renews the claim and posts once.

  Anything that stops it before step 4 drops the claim, and so does X
  refusing the post (a 4xx; X refuses a duplicate text with 403). No
  answer (30 seconds at most), or a 5xx, marks it `unanswered`. Nothing is
  posted again until an organizer has looked at our profile:
  - `--sent <post id>` when the post is there. X reads it back with the
    app's bearer token (one billed read), and it must be ours and say the
    text approved. X shortens links to t.co and escapes `&`, so links
    compare as one and entities are read back.
  - `--release` when it isn't, so it can be approved again.

The sign-in lives in the 1Password item "allthings X app", field
`oauth2 refresh token` (`src/social/x-sign-in.ts`, through `op` with
`OP_SERVICE_ACCOUNT_TOKEN`). The token is handed to `op` in a file only
this user can read, removed right after, never on its command line.

`x-sign-in --from-xurl` stores the sign-in that `xurl auth oauth2 --app
allthings allthingswebdev` made. While xurl's access token is unexpired, it
first checks that the token is our account. The first post spends xurl's
copy; that same xurl command signs xurl in again. The client ID, client
secret and bearer token are in the same item. `DATABASE_URL` is the
database owner, since the record is in the planning schema. Nothing in the
tests reaches X or 1Password.

```sh
DATABASE_URL=… bun run social x <slug> --moment announce --dry-run                       # the post, and its token
OP_SERVICE_ACCOUNT_TOKEN=… DATABASE_URL=… X_CLIENT_ID=… X_CLIENT_SECRET=… \
  bun run social x <slug> --moment announce --approve <token>                           # exactly that, once
DATABASE_URL=… X_BEARER_TOKEN=… bun run social x <slug> --moment announce --sent <post id>  # record the post an unanswered post left
DATABASE_URL=… bun run social x <slug> --moment announce --release                       # let go of an unanswered post that left none
OP_SERVICE_ACCOUNT_TOKEN=… bun run social x-sign-in --from-xurl                          # keep xurl's sign-in as ours
```

## Migrations

`migrations/` holds the schema as Effect SQL migrations, applied by Effect's
migrator (`src/migrator.ts`). The Next app in `app/` still runs on drizzle and
its hand-applied `app/migrations` until the cutover; both share production
until then (see below).

### Writing one

- One file per change: `migrations/NNNN_short_name.ts`, the next id after the
  last, default-exporting `statements([...])` with one SQL statement per
  entry. Add it to `migrations/index.ts`; a test fails if a file is missing
  there or an id is skipped.
- Forward only, and never edited after merge: production records each
  migration by id and name and will not run it again. To change something,
  add a migration. `migrate` refuses a database whose record is not a prefix
  of the migrations here.
- Each runs in one transaction with the others pending, so no
  `CREATE INDEX CONCURRENTLY`; split such a change out when it is needed.
- Until the cutover, a schema change ships twice: as the app's drizzle
  migration and as a migration here. `tests/migrations.test.ts` replays
  `app/migrations` and fails when the two schemas drift apart. Change
  `app/src/lib/schema.ts`, run `bun run db:generate --name <name>` in `app/`
  for the migration and its snapshot, and append any data statements to the
  generated SQL by hand. Only the test replays those files: production, now
  stamped, takes migrations from here alone. One exception: a migration that
  only brings production back to what `app/migrations` already creates (one
  of the hand-applied differences the test lists) ships here alone, and its
  entry leaves that list.
- Add the lines the migration creates to
  `tests/fixtures/production-schema.txt`, which is production's catalog once
  every migration here has run (`bun run migrate`, below).
- Its number must be free: CI's migration guard (`bun run migration-guard`,
  `src/migration-guard.ts`, on every pull request and on main) fails when a
  branch's migrations don't extend what production has applied, in order
  (it reads `effect_sql.migrations` as site_reader), or when a pull request
  adds a migration under a number another open pull request adds. The
  failure names each migration to renumber, and the number it should take.

`0001_baseline` is production's schema on 2026-10-04, read from its catalog,
not a copy of `app/migrations`: production received changes by hand that
those files do not record. The test lists each difference with its reason.
`tests/fixtures/production-schema.txt` is that catalog plus what each later
migration adds, and the tests hold the migrations to it both in PGlite and on
Postgres 17 (`tests/postgres.test.ts`, in CI).

`neon_auth` is Neon Auth's schema, not ours. The baseline still makes a
stand-in `neon_auth.users_sync` where Neon Auth isn't on (tests, local
Postgres), because production had it in 2026-10. Since
`0023_drop_admin_tables`, nothing of the site's references it, and the
snapshot (`src/schema-snapshot.ts`) compares only `public` and `planning`.
So Neon Auth on or off changes nothing the migrations or tests check; a
test drops the schema to show it.

### Running them

```sh
DATABASE_URL=postgres://… bun run migrate --dry-run   # what would run
DATABASE_URL=postgres://… bun run migrate             # run it
```

A migration reaches production before the code that needs it: the app on
Vercel builds and serves against production's database (previews too), so
code that reads a new column fails until it exists. Once a pull request with
a migration is approved and green, check out its final head commit and run
both against production; the dry run must list exactly that pull request's
migrations as pending. Then merge, and push nothing to the branch in between,
since production records each migration by name. This works because the code
already on `main` must keep running on the migrated schema: add before
using, and split a drop or rename into a migration after the code stops
using the old shape.

`DATABASE_URL` comes from the environment only: the script does not read
`.env` files. The record of applied migrations is `effect_sql.migrations`, in
its own schema like drizzle's `drizzle.__drizzle_migrations`, so neither tool
sees the other's and drizzle-kit, which manages `public`, leaves it alone.

### Stamping production at the cutover

Production already has the baseline's schema, so the baseline must be recorded
there, not run (running it would fail on the first existing table, and
`migrate` refuses to try). `stamp` records the pending migrations as applied
without running them, and only if the live schema is exactly what they create:

```sh
DATABASE_URL=… bun run migrate stamp --dry-run   # reads only: shows any difference
DATABASE_URL=… bun run migrate stamp             # records 0001_baseline (and any later ones)
```

It builds the expected schema by applying the migrations to an in-process
PGlite, then, through the migrator itself, inserts the records and compares
production's catalog to the expected schema in the same transaction: on any
difference it fails and records nothing. It changes no table of the app's.
To undo it, delete the stamped rows from `effect_sql.migrations` (or drop the
`effect_sql` schema). After the stamp, `bun run migrate` applies later
migrations, and drizzle's migrations stop. Production was stamped at
`0001_baseline` on 2026-10-04.

### In CI, once a Neon credential exists

Each pull request gets a Neon branch of production: create it, run
`bun run migrate` against it (the branch inherits production's record, so only
the pull request's new migrations run), run the tests against it, then delete
the branch. On deploy, `bun run migrate` runs against production before the new
Worker goes live. Neither job exists yet.
