import {
  clock,
  defaultMinutes,
  finishBy,
  type Goal,
  goalLabels,
  Goal as Goals,
  type Rule,
  rules,
} from "allthings-core/src/coaching.ts";
import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { discord, mcpPath } from "../links.ts";
import { ogCards } from "../og/cards.ts";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import type { Theme } from "./theme.ts";

/**
 * /coach: what a good talk looks like on our stage, and how to check
 * yours before you're on it. Everything it says a check looks for is read
 * from core's src/coaching.ts (the slot's lengths, each rule's `good` and
 * `why`, the goals), the same rules the MCP server's coach_talk runs, so
 * the page and the coaching never differ. It isn't in the header, which
 * would overflow a narrow phone: /about's "Take the stage" links here.
 */

export interface CoachProps {
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
}

/** Where the coaching page is. */
export const coachPath = "/coach";

const openFloor = {
  format: "open-floor",
  minutes: defaultMinutes["open-floor"],
} as const;

/** Every talk's rules, in coaching's order. */
const everyTalk = rules.filter((rule) => rule.goal === null);

/** The rules for `goal`, in coaching's order. */
const forGoal = (goal: Goal): ReadonlyArray<Rule> =>
  rules.filter((rule) => rule.goal === goal);

function RuleItem({ rule }: { readonly rule: Rule }) {
  return (
    <li>
      <strong safe>{rule.good}</strong> <span safe>{rule.why}</span>
    </li>
  );
}

/** The coaching page, whole, in the site's frame. */
export function coachPage({
  origin,
  theme,
  portraits,
  images,
}: CoachProps): string {
  const slot = clock(openFloor.minutes * 60);
  return Document({
    meta: {
      title: gatheringTitle("coach"),
      description:
        "What a good talk looks like on an allthings stage, and how to check yours before you're on it.",
      path: coachPath,
      image: ogCards.coach,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <article class="coach">
        <div class="intro">
          <h1 class="lockup at-type-event-lockup">coach</h1>
          <p class="lead at-type-lead">
            Show what you built and how. Here is what that looks like on our
            stage, and how to check your talk before you're on it.
          </p>
        </div>
        <div class="prose">
          <h2 id="slot">Your slot</h2>
          <ul>
            <li safe>
              {`An open floor gives each speaker ${openFloor.minutes} minutes. The timer starts at your first words, and at ${slot} the screen switches to the timer, mid-demo or not.`}
            </li>
            <li safe>
              {`A talk in an evening's lineup has the length we agree with you, often about ${defaultMinutes.talk} minutes. It ends on time too.`}
            </li>
            <li safe>
              {`Plan to finish early: by ${clock(finishBy(openFloor))} of ${slot}, and by 90% of a longer slot.`}
            </li>
          </ul>
          <h2 id="good">What good looks like</h2>
          <ul>
            {everyTalk.map((rule) => (
              <RuleItem rule={rule} />
            ))}
          </ul>
          <h2 id="goals">For what you want from it</h2>
          {Goals.literals.map((goal) => (
            <>
              <h3 safe>{goalLabels[goal]}</h3>
              <ul>
                {forGoal(goal).map((rule) => (
                  <RuleItem rule={rule} />
                ))}
              </ul>
            </>
          ))}
          <h2 id="check">Check yours</h2>
          <p>
            Send your slot, your title, an outline or your slides, and a
            rehearsal's transcript (plain text, WebVTT or SRT) to{" "}
            <code>coach_talk</code>, a tool on our MCP server at{" "}
            <code safe>{`${origin}${mcpPath}`}</code>. Any agent can call it:{" "}
            <code>bunx allthings mcp</code> prints the line to add it. You get
            back what to change first, with what was measured.
          </p>
          <p>
            The checks are the ones on this page, and the same talk always gets
            the same answer. Nothing you send is kept or logged.
          </p>
          <h2 id="after">After your talk</h2>
          <p>
            Send the organizers your slides and the repo: your talk's page on
            allthings.dev carries its recording and what you share.
          </p>
          <p class="fact-links">
            <a href={discord}>
              pitch a talk on discord <span aria-hidden="true">→</span>
            </a>
          </p>
        </div>
      </article>
    ),
  });
}
