# Event formats

<!-- Generated from core/src/formats.ts by `bun run formats:doc` in core. Edit the module, not this file. -->

What each kind of evening is: its definition, what it needs before it goes out, how long it runs, the schedule it starts from, and the rules everyone who comes is told. The completeness report, readiness, the event page and the promo drafts all read them from core/src/formats.ts. A rule applies to evenings that start on or after its day.

## talks

A lineup on stage: talks, panels and fireside chats, with time before and after to meet people.

- On stage: its talks.
- Runs 3 hours, doors to close.
- Needs, beyond what every evening needs: talks, each with its speakers.

Its schedule starts from:

- +0:00 Doors open: food, drinks and people
- +0:45 On stage
- +2:15 Time to talk, until close

Its rules, as everyone who comes is told them:

- None of its own.

## open floor

No lineup: anyone can get up and show what they're building.

- On stage: an open floor, with any demos we know of.
- Runs 3 hours, doors to close.
- Needs, beyond what every evening needs: nothing.

Its schedule starts from:

- +0:00 Doors open: food, drinks and people
- +0:45 Open floor: anyone can show what they're building
- +2:15 Time to talk, until close

Its rules, as everyone who comes is told them:

- None of its own.

## social evening

No stage: an evening to meet people over food and drinks, sometimes around a game such as trivia.

- On stage: nothing.
- Runs 3 hours, doors to close.
- Needs, beyond what every evening needs: nothing.

Its schedule starts from:

- +0:00 Doors open: food, drinks and people

Its rules, as everyone who comes is told them:

- None of its own.

## hackathon

Teams build something in a set time, then show it, and judges pick the winners.

- On stage: nothing.
- Runs 8 hours, doors to close, and may run through the day.
- Needs, beyond what every evening needs: a schedule on its page; a description that carries each of its rules, word for word.

Its schedule starts from:

- +0:00 Doors open: food, drinks and forming teams
- +0:30 Kickoff: the theme, the rules and how judging works
- +1:00 Hacking
- +6:00 Submissions close: each team's public repository
- +6:15 Demos
- +7:30 Judging and awards

Its rules, as everyone who comes is told them:

- **Projects must be open source to be judged: a public repository under an OSI-approved license.** From 2026-10-06 on. Agents make it easy to build a demo that doesn't really work. Open code lets us check a project with automated tools and tests, CodeRabbit's review, and by checking it out ourselves, to judge how real it is.
