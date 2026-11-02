import type { PeopleView } from "allthings-core/src/people-directory.ts";
import { lineText } from "allthings-core/src/now.ts";
import { Cursor } from "../evening-row.tsx";
import { simpleMonth } from "../time.ts";
import { LabDocument, type LabPage } from "./lab.tsx";
import { labRoot, nowLabPath, nowLabPersonPath } from "./paths.ts";

/**
 * /lab/now: the pilot of "Now" (docs/now.md), what people who spoke at
 * allthings do now. Each person with a record links to their page as it
 * would be with its Now section (/lab/now/<slug>); people's own pages
 * leave it out until Erik says yes.
 */

/** Everyone in the people page's directory with a record, by name. */
const withNow = (people: PeopleView) =>
  [...people.organizers, ...people.speakers, ...people.coHosts]
    .flatMap((person) =>
      person.now === null ? [] : [{ ...person, now: person.now }],
    )
    .toSorted((a, b) => a.name.localeCompare(b.name));

/** The lab's index of people with a record, each with its line as it reads. */
export function nowLabPage(people: PeopleView, page: LabPage): string {
  const listed = withNow(people);
  return LabDocument({
    title: "lab/now",
    description: "What people who spoke at allthings do now, on their pages.",
    path: nowLabPath,
    page,
    children: (
      <div class="lab-index">
        <div class="lab-index-head">
          <p class="at-type-meta">
            <a href={labRoot}>the lab</a> · now
          </p>
          <h1 class="lab-index-name">
            allthings<span class="slash">/</span>now
            <Cursor />
          </h1>
          <p class="lab-index-lead">
            What people who spoke at allthings do now, after their bio on their
            page: a line with every fact linked to where it was read, their
            latest work, and the month it was checked.
          </p>
        </div>
        <ol class="lab-variants">
          {listed.map((person) => (
            <li>
              <a href={nowLabPersonPath(person.slug)}>
                <span class="lab-variant-name" safe>
                  {person.name}
                </span>
                <span class="lab-variant-pitch" safe>
                  {`${lineText(person.now.line)} As of ${simpleMonth(person.now.checkedOn)}.`}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    ),
  });
}
