import type * as Contract from "allthings-core/src/contract.ts";

/**
 * What get_community says about All Things Web, copied from
 * app/src/lib/community.ts and toPublicCommunity in
 * app/src/lib/public-api/mappers.ts; the parity test holds them equal.
 */
export function community(origin: string): Contract.Community {
  return {
    name: "All Things Web",
    oneLiner: "A hacker club for everyone building the web.",
    introduction:
      "Just starting out, leading a company, or creating tools the world uses every day? Here, we meet as peers. Come learn, share what you’re building, ask questions, and find your people.",
    mission:
      "All Things Web brings the San Francisco Bay Area tech community together on a level playing field. We make room to listen, learn, collaborate, connect, show off a project, and get support—whatever your experience or job title.",
    history:
      "Erik Thorelli and Andre Landgraf started this community to help rebuild San Francisco’s local tech meetup scene after COVID disrupted it. Our roots are in Remix Bay Area and React meetups: the spirit of an old hacker club, with the tools and ideas of today.",
    independence:
      "We have never taken money or paid sponsorship. Our events are community first, and our presentations are for sharing useful ideas and real work. No shilling. No sales pitches.",
    hosting:
      "We choose hosting companies whose tools and work we admire. They welcome the community by providing space, food, and a great place to spend time together. Hosting is an in-kind contribution to the community, not a paid sponsorship or a purchased speaking slot.",
    links: {
      website: origin,
      events: "https://luma.com/allthingsweb",
      discord: "https://discord.gg/B3Sm4b5mfD",
      codeOfConduct: `${origin}/code-of-conduct`,
    },
  };
}
