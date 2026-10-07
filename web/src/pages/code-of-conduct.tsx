import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import { ogCards } from "../og/cards.ts";
import type { Theme } from "./theme.ts";

/**
 * /code-of-conduct: how evenings stay welcoming, and how to report a
 * concern. The words are the current site's (app/src/app/code-of-conduct),
 * under the brand's name; the MCP server's get_community links here.
 */

export interface CodeOfConductProps {
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
}

/** Where the code of conduct is. */
export const codeOfConductPath = "/code-of-conduct";

export function codeOfConductPage({
  origin,
  theme,
  portraits,
  images,
}: CodeOfConductProps): string {
  return Document({
    meta: {
      title: gatheringTitle("code of conduct"),
      description:
        "How we keep allthings welcoming, respectful, and community first, and how to report a concern.",
      path: codeOfConductPath,
      image: ogCards.codeOfConduct,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <article class="conduct">
        <div class="intro">
          <h1 class="lockup at-type-event-lockup">code of conduct</h1>
          <p class="lead at-type-lead">
            allthings is a place to learn, build, share, and connect on equal
            footing.
          </p>
        </div>
        <div class="prose">
          <p>
            Whether you are new to tech or have spent years building it, you
            deserve respect and room to participate.
          </p>
          <p>
            These expectations apply to attendees, speakers, organizers,
            volunteers, and hosting companies at our events and in our community
            spaces. Job title, reputation, and hosting contributions do not give
            anyone special treatment.
          </p>
          <h2 id="participation">How we show up</h2>
          <ul>
            <li>
              Be curious and considerate. Ask questions, listen, share what you
              know, and make room for others.
            </li>
            <li>
              Discuss ideas without belittling the people behind them. Respect
              boundaries and stop when someone asks you to.
            </li>
            <li>
              Share useful work and honest lessons. No shilling, sales pitches,
              or pressure to buy, invest, or hand over contact details.
            </li>
            <li>
              Ask before photographing or recording someone directly, and
              respect requests not to be included or tagged.
            </li>
            <li>
              Help keep the venue welcoming and accessible. Follow reasonable
              venue and organizer instructions.
            </li>
          </ul>
          <h2 id="unacceptable">Behavior we do not accept</h2>
          <p>
            Harassment, discrimination, threats, stalking, intimidation,
            unwanted sexual attention or contact, sharing private information
            without permission, and repeated disruption are not welcome. Neither
            is retaliation against someone who raises a concern or helps address
            one.
          </p>
          <h2 id="reporting">Report a concern</h2>
          <p>You can speak privately to an organizer at an event or email:</p>
          <ul>
            <li>
              Andre Landgraf (primary):{" "}
              <a href="mailto:andre@allthingsweb.dev">andre@allthingsweb.dev</a>
            </li>
            <li>
              Erik Thorelli (backup):{" "}
              <a href="mailto:erik@allthingsweb.dev">erik@allthingsweb.dev</a>
            </li>
          </ul>
          <p>
            If your concern involves one organizer, contact the other directly.
            You do not need to confront the person involved before asking for
            help. Share what happened, when and where, and how we can contact
            you safely. Reports will be handled discreetly, with information
            shared only as needed to respond.
          </p>
          <p>
            These email addresses are not an emergency service. If there is
            immediate danger, contact local emergency services or venue staff.
          </p>
          <h2 id="response">How we respond</h2>
          <p>
            Organizers will listen, consider the circumstances, and take
            proportionate action. This may include a conversation, a warning,
            asking someone to stop or leave, or restricting participation in
            future events or community spaces. Someone who is the subject of a
            report should not decide its outcome. You can use the contacts above
            to ask about a decision or raise a concern about how it was handled.
          </p>
        </div>
      </article>
    ),
  });
}
