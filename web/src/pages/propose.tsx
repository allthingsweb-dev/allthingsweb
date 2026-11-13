import type { PortraitsById } from "allthings-core/src/portraits.ts";
import {
  formatLabels,
  type ProposalField,
  ProposalFormat,
  proposalLimits,
} from "allthings-core/src/proposals.ts";
import { aboutPath, everyTalk } from "../links.ts";
import { ogCards } from "../og/cards.ts";
import { codeOfConductPath } from "./code-of-conduct.tsx";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import { privacyPath } from "./privacy.tsx";
import type { Theme } from "./theme.ts";

/**
 * /propose: anyone may propose a talk, on a page that works without a
 * script, at a phone's width first. "An open door and a high bar": the
 * page says what we look for, and the form asks for just enough to judge
 * a talk by and to answer its speaker. It posts to itself
 * (routes.ts's `proposeForm`), which hands what was sent to
 * src/proposals.ts's takeProposal, as every way in does, and answers with
 * this page again: thanks, or the form as it was sent with each problem
 * beside its field. Nothing stored is ever shown.
 *
 * `trap` is a field no person sees or fills (hidden, out of the tab order,
 * and labelled to leave empty): a form that comes back with it filled was
 * filled by a script, which is thanked and kept nowhere.
 */

/** Where the page is, and where its form posts. */
export const proposePath = "/propose";

/** The field only a script fills. */
export const trapField = "website";

/** What a form sent, as text, field by field: what the page fills its form back in with. */
export type ProposeValues = Readonly<Partial<Record<ProposalField, string>>>;

/** What the page says above its form, after a post. */
export type ProposeNotice =
  | { readonly kind: "sent"; readonly text: string }
  | { readonly kind: "problem"; readonly text: string };

export interface ProposeProps {
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
  /** What was sent, to fill the form back in; empty for a new form. */
  readonly values?: ProposeValues;
  /** Each field's problem, as readProposal said it. */
  readonly problems?: Readonly<Partial<Record<ProposalField, string>>>;
  readonly notice?: ProposeNotice;
}

/** A field's problem beside it, tied to it for screen readers. */
const Problem = ({
  field,
  problems,
}: {
  readonly field: ProposalField;
  readonly problems: ProposeProps["problems"];
}) => {
  const problem = problems?.[field];
  return problem === undefined ? (
    ""
  ) : (
    <strong id={`${field}-problem`} safe>
      {problem}
    </strong>
  );
};

/** Attributes that mark a field with a problem as invalid, and point at it. */
const invalid = (
  field: ProposalField,
  problems: ProposeProps["problems"],
): Record<string, string> =>
  problems?.[field] === undefined
    ? {}
    : { "aria-invalid": "true", "aria-describedby": `${field}-problem` };

/** The proposal page, whole, in the site's frame. */
export function proposePage({
  origin,
  theme,
  portraits,
  images,
  values = {},
  problems,
  notice,
}: ProposeProps): string {
  const sent = notice?.kind === "sent";
  const line = (
    field: ProposalField,
    label: string,
    hint: string,
    options: {
      readonly type?: "text" | "email";
      readonly max: number;
      readonly required?: boolean;
      readonly autocomplete?: string;
    },
  ) => (
    <label>
      <strong safe>{label}</strong>
      <span class="at-type-meta" safe>
        {hint}
      </span>
      <input
        type={options.type ?? "text"}
        name={field}
        value={values[field] ?? ""}
        maxlength={String(options.max)}
        required={options.required === true}
        autocomplete={options.autocomplete ?? "off"}
        {...invalid(field, problems)}
      />
      <Problem field={field} problems={problems} />
    </label>
  );
  const text = (
    field: ProposalField,
    label: string,
    hint: string,
    options: {
      readonly max: number;
      readonly min?: number;
      readonly required?: boolean;
      readonly rows: number;
    },
  ) => (
    <label>
      <strong safe>{label}</strong>
      <span class="at-type-meta" safe>
        {hint}
      </span>
      <textarea
        name={field}
        rows={String(options.rows)}
        maxlength={String(options.max)}
        {...(options.min === undefined
          ? {}
          : { minlength: String(options.min) })}
        required={options.required === true}
        {...invalid(field, problems)}
        safe
      >
        {values[field] ?? ""}
      </textarea>
      <Problem field={field} problems={problems} />
    </label>
  );
  const format = values.format ?? "talk";
  return Document({
    meta: {
      title: gatheringTitle("propose a talk"),
      description:
        "Propose a talk for an allthings evening in San Francisco: anyone may, and we pick the ones people will still talk about on the way home.",
      path: proposePath,
      image: ogCards.propose,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <article class="propose">
        <div class="intro">
          <h1 class="lockup at-type-event-lockup">propose a talk</h1>
          <p class="lead at-type-lead">
            An open door and a high bar. Anyone may propose a talk; we pick the
            ones people will still talk about on the way home.
          </p>
        </div>
        <div class="prose">
          <h2 id="looking-for">What we look for</h2>
          <ul>
            <li>
              Something you built, broke or worked out the hard way, that people
              who build software can take home and use.
            </li>
            <li>
              Open source you work on, above all if it hasn't been on our stage
              yet.
            </li>
            <li>
              A first talk is welcome. Tell us what you'd say, and we'll help
              you shape it.
            </li>
            <li>Not a pitch for a product. Show the work instead.</li>
          </ul>
          <p>
            See <a href={everyTalk}>every talk</a> given at our evenings, and{" "}
            <a href={aboutPath}>who we are</a>. Speakers and guests follow the{" "}
            <a href={codeOfConductPath}>code of conduct</a>.
          </p>
          <h2 id="after">After you send it</h2>
          <p>
            Erik and Andre read every proposal and reply by email. When a talk
            fits an evening, we work out the date with you. Only we read what
            you send, and none of it shows on the site unless you give the talk
            (<a href={privacyPath}>privacy</a>).
          </p>
          <p>
            From an agent, the <code>propose_talk</code> tool on{" "}
            <code>allthings.dev/mcp</code> sends the same proposal.
          </p>
        </div>
        <section class="prose" aria-labelledby="send">
          <h2 id="send">Your proposal</h2>
          {notice === undefined ? (
            ""
          ) : (
            <p role={sent ? "status" : "alert"}>
              <strong safe>{notice.text}</strong>
            </p>
          )}
          {sent ? (
            ""
          ) : (
            <form class="form" method="post" action={proposePath}>
              {line("title", "Title", "What the talk is called.", {
                max: proposalLimits.title,
                required: true,
              })}
              <label>
                <strong>Format</strong>
                <select name="format" {...invalid("format", problems)}>
                  {ProposalFormat.literals.map((value) => (
                    <option value={value} selected={format === value} safe>
                      {formatLabels[value]}
                    </option>
                  ))}
                </select>
                <Problem field="format" problems={problems} />
              </label>
              {text(
                "abstract",
                "Abstract",
                "What it's about, and what people will leave knowing. A few sentences.",
                {
                  min: proposalLimits.abstractMin,
                  max: proposalLimits.abstract,
                  required: true,
                  rows: 7,
                },
              )}
              {line("name", "Your name", "As you'd like it on the evening.", {
                max: proposalLimits.name,
                required: true,
                autocomplete: "name",
              })}
              {line(
                "email",
                "Your email",
                "Only the organizers see it. We reply here.",
                {
                  type: "email",
                  max: proposalLimits.email,
                  required: true,
                  autocomplete: "email",
                },
              )}
              {text(
                "about",
                "About you",
                "What you build, and where. Optional.",
                { max: proposalLimits.about, rows: 3 },
              )}
              {text(
                "links",
                "Links",
                `Your site, GitHub, the project the talk is about: https links, one a line, up to ${proposalLimits.links}. Optional.`,
                {
                  max: (proposalLimits.link + 1) * proposalLimits.links,
                  rows: 3,
                },
              )}
              {text(
                "notes",
                "Notes for us",
                "Dates that work, a co-speaker, anything else. Optional.",
                { max: proposalLimits.notes, rows: 3 },
              )}
              <div class="propose-trap" hidden>
                <label>
                  Leave this empty
                  <input
                    type="text"
                    name={trapField}
                    value=""
                    tabindex="-1"
                    autocomplete="off"
                  />
                </label>
              </div>
              <button class="button" type="submit">
                send the proposal
              </button>
            </form>
          )}
        </section>
      </article>
    ),
  });
}
