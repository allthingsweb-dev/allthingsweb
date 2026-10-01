---
name: event-briefing
description: Brief someone before an All Things Web event: who is speaking and why it matters, the schedule, where to go, and how to get in. Use when someone is attending, or considering, a specific All Things Web event and wants to prepare.
---

1. Identify the event. If the person names it loosely, call `list_events` (upcoming first, then past) and match on name or date; confirm when more than one fits.
2. Call `get_event` with its slug.
3. Write a short briefing:
   - When and where: the local date and time (America/Los_Angeles) and the venue name and address. Note that hosting companies sometimes use a different floor or entrance than the street address suggests; tell the person to check the RSVP page for check-in details.
   - Talks: each talk's title, its speakers with their titles, and one or two sentences on what it covers, taken from the description.
   - Who to meet: the speakers, with their public links, and the hosting company.
   - Getting in: registration happens at `rsvpUrl`. If the event is past, say so and share `recordingUrl` when there is one.
4. Close with how to stay in touch: the Discord and Luma links from `get_community`, and the code of conduct link for anyone attending for the first time.

Use only what the tools return. When a speaker has no bio or a talk has no description, leave it out rather than filling the gap.
