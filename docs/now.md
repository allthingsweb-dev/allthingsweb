# Now

Where the people who spoke at allthings are now: a short, dated, sourced note on their page, after their bio. Lydia Hallie is on Claude Code at Anthropic; Matt Palmer joined Cursor eleven days before SpaceX bought it. The talk they gave us is a year old; what they make now is worth a link.

## What a person's "now" is

One record per person, read on one day:

- **line**: one or two sentences, present tense, in the site's voice (brand/foundations.md). Every fact in it is a link to where it was read: `Matt [joined Cursor](https://x.com/mattyp/status/2084398105802448903) in August.`
- **links**: up to four pieces of their own recent work, latest first: a post, an article, a video, a talk or a podcast, each with its title, its date as the page gives it (a day, or only a month) and its URL. A link is its own source.
- **checkedOn**: the day it was all read. The page says "as of 2026.11".

## Rules

- Public, professional work only, from the person's own channels (their site, X, Bluesky, LinkedIn, GitHub, YouTube, their employer's posts) or reputable press. Nothing personal: no family, homes, money or health.
- No guessing. A fact no source states is left out, never softened into the copy. Fast-moving company news (a new job, an acquisition, a rename) is checked against the company's own post or the press, and named as they name it.
- The copy carries no caveats about sources; the links do that job. Plain, specific, short, community diction: at/effect, not "the Effect San Francisco meetup".
- Anyone can ask for theirs to be changed or taken down, and it is, at once.

## Where it lives

The record is a fact like a title or a bio, so it goes through the people pipeline that already carries those, with their sources: `core/backfill/people.json`, applied by `bun run people` (`core/src/people-enrichment.ts`) in one transaction.

- **Stored** in one column, `profiles.now` (jsonb), so clearing it is one field.
- **In the file**, each entry may have a `now`:
  - a record, as above: written whenever it differs from what is stored, since nothing else writes this column;
  - `null`: cleared, and kept off. The person asked, or a record went wrong. Refreshes skip them;
  - absent: never researched; nothing is written.
- **Checked** by the schema the file is decoded with: at most two sentences and 280 characters of text, at least one source in the line, https only, at most four links, real calendar days, `checkedOn` not in the future.

To take someone's down: set their entry's `now` to `null`, then `bun run people`. The page drops it within about two minutes (the page store's refresh).

## On the page

A "Now · as of 2026.11" section after the bio: the line, with its facts linked, then the links as the talks elsewhere are listed (date, title, kind). Nothing shows for a person without one.

Until Erik has reviewed the pilot, people's pages don't show it. `/lab/now` does: the lab's person pages with the section, for the people who have a record. Lab pages are public, linked from nowhere and kept out of search. Turning it on for every page is one line in the person route.

## Refreshing

`bun run people stale --days 90` lists the people whose record was checked more than 90 days ago, with their current record, as JSON for an agent. `--speakers` adds everyone who has spoken at one of our evenings and has no record yet. It reads the file, and the database only for `--speakers`.

There is no scheduled job yet. One would run weekly:

1. List the stale records.
2. For each person, an agent re-reads their channels under the rules above and rewrites the record, or leaves it as it was and moves `checkedOn` when nothing changed.
3. It opens one pull request with the changed entries of `people.json`, through CodeRabbit like any other.
4. After merge, the maintainer applies it (`bun run people --dry-run`, then `bun run people`); the backfills run as the database owner.

## The pilot

Six speakers, checked 2026-11-02: Lydia Hallie, Matt Palmer, Lee Robinson, Evan Bacon, Michael Arnaldi and Rhys Sullivan. They are in `people.json` and on `/lab/now`, and wait for Erik's yes before people's pages show them.
