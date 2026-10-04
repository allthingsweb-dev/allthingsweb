---
name: find-events
description: Find upcoming All Things Web events in San Francisco and help someone decide which to attend. Use when someone asks about web development, JavaScript, TypeScript, React or AI engineering meetups, hackathons or community events in San Francisco or the Bay Area.
---

All Things Web is an open community in San Francisco for people who build software, from first-time attendees to maintainers of widely used open-source projects. Events are free; hosting companies provide the space, food and drinks.

1. Call `list_events` with `when: "upcoming"`. Events are sorted soonest first, and live events are included with `status: "live"`.
2. If nothing is upcoming, say so plainly, point to the Luma calendar from `get_community` (`links.events`), and offer recent past events (`when: "past"`) as a sense of what the community runs.
3. For events that match the person's interests, call `get_event` to see the talks, speakers and hosting company.
4. Present each event with its name, local date and time in `timeZone` (America/Los_Angeles), venue, and what makes it worth going: the talk topics and who is speaking. Never invent speakers, topics or capacity.
5. Always send people to the event's `rsvpUrl` to register. Registration and availability live there; this plugin cannot register anyone.

When a field is null, leave it out rather than guessing.
