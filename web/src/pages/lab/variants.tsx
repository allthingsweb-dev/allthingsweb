import { Cursor } from "../evening-row.tsx";
import { ContactSheet } from "./contact-sheet.tsx";
import { DepthField } from "./depth-field.tsx";
import { Faces } from "./faces.tsx";
import {
  type LabData,
  LabDocument,
  type LabPage,
  labPath,
  variantPath,
} from "./lab.tsx";
import { SlashBand } from "./slash-band.tsx";
import { Wall } from "./wall.tsx";

/** One of the lab's heroes, with the one line the lab's index says of it. */
export interface Variant {
  /** Its name, and its path under /lab/home. */
  readonly name: string;
  readonly pitch: string;
  readonly render: (props: {
    readonly data: LabData;
    readonly images: LabPage["images"];
  }) => JSX.Element;
}

/** The lab's heroes, in the index's order: the conservative ones first. */
export const variants: ReadonlyArray<Variant> = [
  {
    name: "wall",
    pitch:
      "The old site’s idea done right: a full-bleed Night wall of crowds from many evenings, each tile slowly crossing to another, the tally below.",
    render: Wall,
  },
  {
    name: "contact-sheet",
    pitch:
      "Today’s Swiss index, with a contact sheet of thirty-six dated frames beside the hero, each leading to its evening, and a bold band of numbers.",
    render: ContactSheet,
  },
  {
    name: "slash-band",
    pitch:
      "The slash drawn huge as a breathing neon tube behind the lockup, the tally in columns, and a drifting band of photos cut on the slash’s slant.",
    render: SlashBand,
  },
  {
    name: "depth-field",
    pitch:
      "Photos hanging at different depths in a slowly swaying 3D field around one statement made of the real numbers.",
    render: DepthField,
  },
  {
    name: "faces",
    pitch:
      "The wordmark across the page, its letters filled with a moving mosaic of the people who have been on stage and the crowds who came.",
    render: Faces,
  },
];

/** The variant named `name`, if there is one. */
export const variantNamed = (name: string): Variant | undefined =>
  variants.find((variant) => variant.name === name);

/** A variant's whole page. */
export function variantPage(
  variant: Variant,
  data: LabData,
  page: LabPage,
): string {
  return LabDocument({
    title: `lab/${variant.name}`,
    description: variant.pitch,
    path: variantPath(variant.name),
    page,
    children: variant.render({ data, images: page.images }),
  });
}

/** /lab/home: every variant, each with its line, and today's home to compare. */
export function labIndexPage(page: LabPage): string {
  return LabDocument({
    title: "lab",
    description: "Experimental heroes for the home page.",
    path: labPath,
    page,
    children: (
      <div class="lab-index">
        <div class="lab-index-head">
          <p class="at-type-meta">the home lab</p>
          <h1 class="lab-index-name">
            allthings<span class="slash">/</span>lab
            <Cursor />
          </h1>
          <p class="lab-index-lead">
            Heroes for the home page, each a whole home page with real photos,
            real numbers and the real next evening. None of it is linked from
            the site.
          </p>
        </div>
        <ol class="lab-variants">
          {variants.map((variant) => (
            <li>
              <a href={variantPath(variant.name)}>
                <span class="lab-variant-name">
                  at<span class="slash">/</span>
                  <span safe>{variant.name}</span>
                </span>
                <span class="lab-variant-pitch" safe>
                  {variant.pitch}
                </span>
              </a>
            </li>
          ))}
          <li>
            <a href="/">
              <span class="lab-variant-name">
                at<span class="slash">/</span>home
              </span>
              <span class="lab-variant-pitch">
                Today’s home, to compare: three hand-picked rooms beside the
                lockup.
              </span>
            </a>
          </li>
        </ol>
      </div>
    ),
  });
}
