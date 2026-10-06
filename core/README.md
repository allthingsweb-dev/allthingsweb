# allthings-core

The data layer the Worker (`web/`) runs on: repositories over Postgres with
Effect SQL, and the migrations that define the schema.

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
DATABASE_URL=$(op read "op://Private/allthings site_sync/credential") bun run sync:rehearse
```

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

`event_people` holds a person's part in an event as a whole: an all things
organizer, a co-host or the MC. Who was on stage, and in what capacity, is on
the talks: `talks.format` (a talk, a panel or a fireside chat) and each
speaker's `talk_speakers.role` (speaking or moderating), so a panelist is a
panel's speaker and a fireside's guest is its speaker (`src/people.ts`).
`Events.getPublished` returns all of it, with Luma's guest counts.

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

The hourly sync imports descriptions after the events and images, in a
window of their own (web/src/sync/run.ts).
To run it now, for every event, from `core/`:

```sh
DATABASE_URL=… LUMA_API_KEY=… bun run luma:descriptions --dry-run   # ask Luma, print what would change
DATABASE_URL=… LUMA_API_KEY=… bun run luma:descriptions             # write it
```

`tests/luma-descriptions.test.ts` runs the conversion, the client against
fixtures and the import against `tests/seed.sql`; nothing reaches Luma.

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
DATABASE_URL=… LUMA_API_KEY=$(op read "op://Private/allthings Luma API key/credential") \
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

The lockup is the link (brand/foundations.md, "Name"): all things/effect
lives at allthings.dev/effect. `src/short-slugs.ts` is the rule, taking
evenings in the order they start:

1. An evening's base is its topic as a URL segment (react native →
   `react-native`, web show & tell → `web-show-and-tell`), or its name
   when the name yields no topic.
2. It takes the first of these that no other evening holds and no page is
   at: the base, then the base with its month in San Francisco
   (`web-2024-11`), then the day (`web-2024-11-12`), then a count.
3. A shared evening is someone else's, never all things/anything, so its
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
either.

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

- A shared evening is named as written, never all things/<topic>
  (`eventTopic`), on its page, in lists, in feeds and on its card.
- /events and home list it in the same rows, marked "shared · by Mastra".
  Home's hero is always our next evening, and its photos are of ours.
- Its page says who organizes it, linked to their site, and has no "your
  hosts". Its structured data names the organizer, not us.
- /about's numbers count our evenings alone, and the people page lists who
  was on stage at ours; people from a shared evening are on its page.
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
DATABASE_URL=$(op read "op://Private/allthings site_reader/credential") bun run completeness          # table, then each event's gaps
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

## Planning

Every evening starts in `planning`, a Postgres schema of its own
(`migrations/0012_planning.ts`): ideas for evenings (title, pitch, program,
topic, and a status from `idea` through `drafting` to `scheduled`, or
`dropped`, linked to the draft evening it becomes and to a past one it
builds on), speakers we'd like on stage (a profile, or a contact without
one) with their topics and when they're free or not, companies we'd like
to host (one we know, or a new name) with who to talk to and when each last
hosted, and notes on the people and companies we know.

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
refused with both ids. Run it from `core/`:

```sh
DATABASE_URL=… bun run plan idea add --title "…" --pitch "…" --program social --inspired-by <slug>
DATABASE_URL=… bun run plan idea update <id> --status drafting --event <draft slug>
DATABASE_URL=… bun run plan speaker add --profile "Ada Lovelace" --topic effect \
  --window '{"startsOn":"2027-01-01","note":"free after Dec"}'
DATABASE_URL=… bun run plan speaker list --topic effect --available-on 2027-01-14
DATABASE_URL=… bun run plan host add --sponsor CodeRabbit --contact-name "…" --note "…"
DATABASE_URL=… bun run plan note add --profile "Ada Lovelace" --body "…" --author Erik
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
- once the Luma event exists, a cover

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

`0001_baseline` is production's schema on 2026-10-04, read from its catalog,
not a copy of `app/migrations`: production received changes by hand that
those files do not record. The test lists each difference with its reason.
`tests/fixtures/production-schema.txt` is that catalog plus what each later
migration adds, and the tests hold the migrations to it both in PGlite and on
Postgres 17 (`tests/postgres.test.ts`, in CI).

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
