# Event formats

<!-- Generated from core/src/formats.ts by `bun run formats:doc` in core. Edit the module, not this file. -->

What each kind of evening is: its definition, what it needs before it goes out, how long it runs, the schedule it starts from, and the rules everyone who comes is told. The completeness report, readiness, the event page and the promo drafts all read them from core/src/formats.ts. A rule applies to evenings that start on or after its day.

## talks

A lineup on stage: talks, panels and fireside chats, with time before and after to meet people.

- On stage: its talks.
- Needs, beyond what every evening needs: talks, each with its speakers.

### Length and schedule

- Runs 3 hours by default, doors to close. Another length is advised on, never refused.

Its schedule starts from:

- +0:00 Doors open: food, drinks and people
- +0:45 On stage
- +2:15 Time to talk, until close

### Rules

As everyone who comes is told them:

- None of its own.

## open floor

No lineup: anyone can get up and show what they're building.

- On stage: an open floor, with any demos we know of.
- Needs, beyond what every evening needs: nothing.

### Length and schedule

- Runs 3 hours by default, doors to close. Another length is advised on, never refused.

Its schedule starts from:

- +0:00 Doors open: food, drinks and people
- +0:45 Open floor: anyone can show what they're building
- +2:15 Time to talk, until close

### Rules

As everyone who comes is told them:

- None of its own.

## social evening

No stage: an evening to meet people over food and drinks, sometimes around a game such as trivia.

- On stage: nothing.
- Needs, beyond what every evening needs: nothing.

### Length and schedule

- Runs 3 hours by default, doors to close. Another length is advised on, never refused.

Its schedule starts from:

- +0:00 Doors open: food, drinks and people

### Rules

As everyone who comes is told them:

- None of its own.

## hackathon

Teams build something in a set time, then show it, and judges pick the winners after auditing every project.

- On stage: nothing.
- Needs, beyond what every evening needs: a schedule on its page; a description that carries each of its rules, word for word.

### lightning (the default)

The usual: an evening, with 90 minutes to 2 hours of hacking.

- Runs 3 hours by default, doors to close, up to 4 hours. Another length is advised on, never refused.

Its schedule starts from:

- +0:00 Doors open: food, drinks and forming teams
- +0:15 Kickoff: the theme, the rules and how judging works
- +0:25 Hacking
- +2:05 Submissions close: each team's public repository
- +2:10 Judging: judges run and audit every project, while everyone eats and shows their project at an open demo table
- +2:45 Awards

### full-day

A whole day of hacking: only worth it when it's a big deal, otherwise it's long and drawn out.

- Runs 8 hours by default, doors to close, and may run through the day. Another length is advised on, never refused.
- Readiness asks to confirm it: "A full-day hackathon should be a big deal, or it drags: confirm it's meant to run all day, not as a lightning one."

Its schedule starts from:

- +0:00 Doors open: breakfast and forming teams
- +0:30 Kickoff: the theme, the rules and how judging works
- +1:00 Hacking, with lunch
- +5:30 Submissions close: each team's public repository
- +5:45 Judging: judges run and audit every project, while everyone eats and watches lightning talks and open demos
- +7:15 Finalists demo
- +7:45 Awards

### Rules

As everyone who comes is told them:

- **Projects must be open source to be judged: a public repository under an OSI-approved license.** From 2026-10-06 on. Agents make it easy to build a demo that doesn't really work. Open code lets us check a project with automated tools and tests, CodeRabbit's review, and by checking it out ourselves, to judge how real it is.
- **Projects are judged on whether they work before how they look, then on how useful and how creative they are: judges run each project and its tests, and read its code and CodeRabbit's review.** From 2026-10-06 on. A vibe-coded demo can look finished and not work. Auditing every project (does it run, do its tests pass, what CodeRabbit and its code say) tells the working, useful and creative ones from the rest.
- **Start from at/hack v1.0.0 (https://github.com/allthingsweb-dev/hack), or include its files.** From 2026-10-06 on. Every project starts from the same files, so judges can run and audit each one the same way.
