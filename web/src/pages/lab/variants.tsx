import { Cursor } from "../evening-row.tsx";
import { ContactSheet } from "./contact-sheet.tsx";
import { DepthField } from "./depth-field.tsx";
import { Faces, facesHero } from "./faces.tsx";
import {
  type LabData,
  LabDocument,
  type LabPage,
  labPath,
  variantPath,
} from "./lab.tsx";
import { SlashGrid } from "./slash-grid.tsx";
import { YearEndRetro } from "./year-end-retro.tsx";
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
  /**
   * Whether it runs the lab's script (src/client/lab.ts): its page loads
   * it, and its policy lets this site's scripts run.
   */
  readonly scripted?: true;
}

/** The lab's heroes, in the index's order: the conservative ones first. */
export const variants: ReadonlyArray<Variant> = [
  {
    name: "wall",
    pitch:
      "The old site’s idea done right: a full-bleed Night wall of crowds from many evenings, each tile slowly crossing to another and leading to its evening, the tally below.",
    render: Wall,
  },
  {
    name: "contact-sheet",
    pitch:
      "Today’s Swiss index with a contact sheet of every evening we’ve held, in order: a frame each for the latest, dated and leading to it, and a last one on to all of them.",
    render: ContactSheet,
  },
  {
    name: "slash-grid",
    pitch:
      "A grid of the community’s photos cut on the slash’s slant, each leading to its evening, beside the lockup, with the tally as a band of numbers on the page’s grid.",
    render: SlashGrid,
  },
  {
    name: "depth-field",
    pitch:
      "After localfirstconf’s liquid blob: light that runs together over Night and follows your pointer or finger, its blobs lenses onto the evenings’ photos. Interactive, in WebGL.",
    render: DepthField,
    scripted: true,
  },
  {
    name: "faces",
    pitch:
      "The wordmark across the page, its letters made of the faces of the people who have been on stage, drifting slowly.",
    render: Faces,
  },
  {
    name: "faces-mix",
    pitch:
      "The faces and the evenings’ crowds together in the letters: every crowd a big tile among four faces.",
    render: facesHero({ mix: true }),
  },
  {
    name: "faces-fluid",
    pitch:
      "The mix inside the letters as a fluid: stir it with the pointer or a finger and the photos swirl, then heal. Interactive, in WebGL.",
    render: facesHero({ mix: true, engine: "fluid" }),
    scripted: true,
  },
  {
    name: "faces-springs",
    pitch:
      "The mix as tiles on springs: the pointer scatters them out of the letters and they spring back to their places. Interactive, in WebGL.",
    render: facesHero({ mix: true, engine: "springs" }),
    scripted: true,
  },
  {
    name: "faces-ripples",
    pitch:
      "The mix under water: the pointer drops ripples that bend the photos and catch the light along their crests. Interactive, in WebGL.",
    render: facesHero({ mix: true, engine: "ripples" }),
    scripted: true,
  },
];

/**
 * Designs taken out of the running for home but kept for another page,
 * each still at its address, under the index's "Saved" heading.
 */
export const saved: ReadonlyArray<Variant & { readonly note: string }> = [
  {
    name: "year-end-retro",
    note: "Saved for the year-end retro",
    pitch:
      "One statement of the year’s real numbers, how many people said “I’m in” over how many evenings, in a slowly swaying field of photos: for a December retro or holiday party page.",
    render: YearEndRetro,
  },
];

/** The variant named `name`, if there is one. */
export const variantNamed = (name: string): Variant | undefined =>
  [...variants, ...saved].find((variant) => variant.name === name);

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
    script: variant.scripted,
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
        {saved.length === 0 ? (
          ""
        ) : (
          <section class="lab-saved" aria-labelledby="saved">
            <h2 id="saved" class="at-type-meta">
              Saved
            </h2>
            <ol class="lab-variants">
              {saved.map((variant) => (
                <li>
                  <a href={variantPath(variant.name)}>
                    <span class="lab-variant-name">
                      at<span class="slash">/</span>
                      <span safe>{variant.name}</span>
                    </span>
                    <span class="lab-variant-pitch">
                      <strong safe>{variant.note}.</strong>{" "}
                      <span safe>{variant.pitch}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    ),
  });
}
