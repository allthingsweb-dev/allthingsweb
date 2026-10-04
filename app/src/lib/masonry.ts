export type Placement<Item> = {
  item: Item;
  index: number;
  /** Whether the item sits in this column under each of the column counts. */
  shownAt: boolean[];
};

/**
 * Deals items round-robin into columns for several column counts at once (one
 * per breakpoint), so a single set of columns serves every layout. Column `c`
 * lists, in order, each item that lands in it under any of the counts.
 */
export function placeInColumns<Item>(
  items: readonly Item[],
  columnCounts: readonly number[],
): Placement<Item>[][] {
  const columnTotal = Math.max(0, ...columnCounts);
  return Array.from({ length: columnTotal }, (_, column) =>
    items.flatMap((item, index) => {
      const shownAt = columnCounts.map((count) => index % count === column);
      return shownAt.includes(true) ? [{ item, index, shownAt }] : [];
    }),
  );
}
