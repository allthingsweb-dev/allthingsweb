import type { Issue } from "../src/letter.ts";

/**
 * December 2026: a draft until Erik's y (approvals.json). Written from what
 * is public on November 13: the guide's three-star entries and the year's
 * page. Our next evening isn't public yet, so it isn't here.
 */
export default {
  month: "2026-12",
  title: "Miami, Portland, Raleigh",
  happenings: [
    {
      name: "AI Engineer Miami",
      text: "G2i runs two conferences in Miami in one week, and this is the first: Monday and Tuesday, April 26 and 27, talks from engineers who ship AI.",
      source: { _tag: "guide", id: "ai-engineer-miami" },
    },
    {
      name: "React Miami",
      text: "The second, Thursday and Friday: React's best speakers, and a crowd that makes the trip worth it. Take Wednesday for the beach.",
      source: { _tag: "guide", id: "react-miami" },
    },
    {
      name: "All Things Open",
      text: "Raleigh, North Carolina, October 17 to 19: the people who make open source, on the tools and the work behind them. No relation, despite the name.",
      source: { _tag: "guide", id: "all-things-open" },
    },
    {
      name: "Chain React",
      text: "Portland, Oregon: the React Native conference, where the people who build React Native come to talk about it. Expo, which hosted our evening in January, helps run it. The 2027 dates aren't out yet; [the guide](https://allthings.dev/guide#chain-react) will have them when they are.",
      source: { _tag: "guide", id: "chain-react" },
    },
  ],
  closing:
    "2,852 times this year, someone said “I’m in.” Seven evenings, sixteen people on stage, and [the whole year on one page](https://allthings.dev/year/2026), photos and all. Thank you for coming, and for staying for the second drink.",
} satisfies Issue;
