---
name: evening-briefing
description: Brief someone before an all things evening in San Francisco: who is on stage and what they built, the schedule, where to go and how to get in. Use when someone is going to, or considering, a specific all things event, meetup or hackathon and wants to prepare.
---

1. Identify the evening. If the person names it loosely, call `list_events` (upcoming first, then past) and match on name or date; confirm when more than one fits.
2. Call `get_event` with its slug.
3. Write a short briefing:
   - When and where: the local date and time (America/Los_Angeles) and the venue's name and address. Hosts sometimes use a different floor or entrance than the street address suggests, so point the person to the `rsvpUrl` page for check-in details.
   - Talks: each talk's title, who gives it and their title, and a sentence or two on what it covers, taken from its description.
   - Who to meet: the speakers, with their public links, and the hosting company.
   - Getting in: saying you're in happens at `rsvpUrl`. If the evening is past, say so and share `recordingUrl` when there is one.
4. Close with where people talk between evenings: the Discord and calendar links from `get_community`, and the code of conduct for anyone coming for the first time.

Use only what the tools return. When a speaker has no bio or a talk has no description, leave it out rather than filling the gap. Hosting companies are hosts, never sponsors.
