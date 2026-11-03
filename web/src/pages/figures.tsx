import type { Tally as TallyView } from "allthings-core/src/about.ts";
import { count } from "./about.tsx";

/**
 * How big allthings is, in big numbers over mono labels: the about page's
 * tally (core's src/about.ts), under home's hero as a band, and within
 * some of the home lab's heroes (pages/lab/) as columns.
 */

/** The tally's numbers, each with what it counts; none that is zero. */
export function tallyFacts(
  tally: TallyView,
  which: ReadonlyArray<keyof TallyView> = [
    "evenings",
    "guests",
    "speakers",
    "hostingCompanies",
  ],
): ReadonlyArray<{ readonly value: string; readonly label: string }> {
  const labels: Record<keyof TallyView, string> = {
    evenings: "evenings",
    guests: "said “I’m in”",
    speakers: "people on stage",
    hostingCompanies: "hosting companies",
  };
  return which
    .filter((key) => tally[key] > 0)
    .map((key) => ({ value: count(tally[key]), label: labels[key] }));
}

/**
 * The tally as a row of big numbers over mono labels, as `kind` sets it:
 * a band under a hero, columns within one, or a compact row within
 * another band (the home lab's home-tight).
 */
export function Tally({
  tally,
  kind,
  which,
}: {
  readonly tally: TallyView;
  readonly kind: "band" | "columns" | "compact";
  readonly which?: ReadonlyArray<keyof TallyView>;
}) {
  const facts = tallyFacts(tally, which);
  if (facts.length === 0) return "";
  return (
    <section class={`figures figures-${kind}`} aria-label="So far">
      <dl>
        {facts.map(({ value, label }) => (
          <div>
            <dt class="at-type-meta" safe>
              {label}
            </dt>
            <dd safe>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
