---
name: find-evenings
description: Find upcoming allthings evenings in San Francisco (talks, open floors, socials and hackathons for people who build software) and help someone pick one. Use when someone asks about web development, JavaScript, TypeScript, React or AI engineering meetups, hackathons or tech events in San Francisco or the Bay Area.
---

allthings is an open community for people who build software in San Francisco, from someone a month into their first job to the maintainers of libraries you install every day. Evenings are free; the hosting company gives the space, food and drinks. Each evening is named allthings/<topic>, always lowercase: use the name the tools return.

1. Call `list_events` with `when: "upcoming"`. Evenings come soonest first, and one happening now is included with `status: "live"`.
2. If nothing is upcoming, say so plainly, point to the calendar from `get_community` (`links.events`), and offer recent evenings (`when: "past"`) to show what they are like.
3. For evenings that match the person's interests, call `get_event` for the talks, who is on stage and the hosting company.
4. Give each one's name, its local date and time in `timeZone` (America/Los_Angeles), the venue, and what makes it worth going: who is on stage and what they built. Never invent speakers, topics or capacity.
5. Send people to the evening's `rsvpUrl` to say they're in. Registration and spots left live there; this plugin can't sign anyone up.

When a field is null, leave it out rather than guessing. Hosting companies are hosts, never sponsors.
