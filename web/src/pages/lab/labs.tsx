import { Cursor } from "../evening-row.tsx";
import { LabDocument, type LabPage } from "./lab.tsx";
import { labPath, labRoot } from "./paths.ts";

/**
 * The lab's root, /lab: every exploration, each a line and a link to its
 * own index. A new lab is one entry here and the routes under its path.
 * Like every lab page it is public, unlinked from the site and asks search
 * engines to stay out.
 */

/** One exploration in the lab. */
export interface Lab {
  /** Its name, as at/<name> lists it. */
  readonly name: string;
  /** Its own index. */
  readonly path: `/${string}`;
  /** What it explores, in one line. */
  readonly line: string;
}

/** Every exploration, the first one first. */
export const labs: ReadonlyArray<Lab> = [
  {
    name: "home",
    path: labPath,
    line: "Heroes for the home page that show at a glance how big allthings is, each a whole home page with real photos, real numbers and the real next evening.",
  },
];

/** /lab: every exploration, with its line. */
export function labRootPage(page: LabPage): string {
  return LabDocument({
    title: "lab",
    description: "Explorations for allthings.dev, each with its own index.",
    path: labRoot,
    page,
    children: (
      <div class="lab-index">
        <div class="lab-index-head">
          <p class="at-type-meta">every exploration</p>
          <h1 class="lab-index-name">
            allthings<span class="slash">/</span>lab
            <Cursor />
          </h1>
          <p class="lab-index-lead">
            Explorations for the site, each with its own index. They are public,
            linked from nowhere on the site, and kept out of search.
          </p>
        </div>
        <ol class="lab-variants">
          {labs.map((lab) => (
            <li>
              <a href={lab.path}>
                <span class="lab-variant-name">
                  at<span class="slash">/</span>
                  <span safe>{lab.name}</span>
                </span>
                <span class="lab-variant-pitch" safe>
                  {lab.line}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    ),
  });
}
