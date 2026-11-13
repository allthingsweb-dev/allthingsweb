/**
 * Edit distance between two words, counting a swap of neighboring letters
 * as one edit (optimal string alignment), so "evnets" is one edit from
 * "events".
 */
export function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The known word a mistyped one most likely meant, or undefined when none is
 * close: one that starts with it ("speaker" for "speakers"), else the
 * nearest within two edits, and never further than a third of its length
 * plus one, so short typos don't match everything. Ties go to the earlier
 * candidate.
 */
export function suggest(
  typed: string,
  candidates: readonly string[],
): string | undefined {
  const word = typed.toLowerCase();
  if (word === "") return undefined;
  const prefixed = candidates.find(
    (candidate) => word.length >= 3 && candidate.startsWith(word),
  );
  if (prefixed !== undefined) return prefixed;
  const limit = Math.min(2, Math.floor(word.length / 3) + 1);
  let best: { candidate: string; edits: number } | undefined;
  for (const candidate of candidates) {
    const edits = distance(word, candidate);
    if (edits <= limit && (best === undefined || edits < best.edits)) {
      best = { candidate, edits };
    }
  }
  return best?.candidate;
}
