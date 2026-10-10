import { HomeBand } from "../home.tsx";
import { type LetterEngine, LetterStage, letterTiles } from "../letters.tsx";
import type { ImageMode } from "../picture.tsx";
import { type LabData, NextEvening, Tally } from "./lab.tsx";

/**
 * faces: the wordmark across the page, its letters made of the community
 * (letters.tsx). In faces alone, of the people who have been on stage; in
 * the mix, of them and the crowds of the evenings, a crowd to every four
 * faces. With an engine, the letters' photos move with the pointer: a
 * fluid it stirs, tiles on springs it scatters, water it ripples.
 */

/** allthings/_, broken onto three lines where the stylesheet asks. */
function Word() {
  return (
    <>
      all
      <br class="letters-break" />
      things
      <br class="letters-break" />
      <span class="slash">/</span>
      <span class="at-cursor" aria-hidden="true">
        _
      </span>
    </>
  );
}

/** A faces hero: faces alone or mixed with crowds, still or with an engine. */
export const facesHero =
  ({
    mix,
    engine,
  }: {
    readonly mix: boolean;
    readonly engine?: LetterEngine;
  }) =>
  ({
    data: { home, community },
    images,
  }: {
    readonly data: LabData;
    readonly images: ImageMode;
  }) => {
    const tiles = letterTiles(
      community.faces.map((face) => face.photo),
      community.wall.map((photo) => photo.photo),
      mix,
    );
    return (
      <div class="lab-home">
        <section class="faces" aria-labelledby="faces-word">
          <LetterStage
            id="faces-word"
            tiles={tiles}
            images={images}
            engine={engine}
          >
            <Word />
          </LetterStage>
          <NextEvening next={home.next} slot={false} />
        </section>
        <Tally tally={community.tally} kind="band" />
        <HomeBand home={home} />
      </div>
    );
  };

/** faces: the faces alone, drifting. */
export const Faces = facesHero({ mix: false });
