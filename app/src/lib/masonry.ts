/**
 * Deals items into the given columns round-robin, so neighbouring items land
 * side by side and every column stays within one item of the others.
 */
export function distributeIntoColumns<Item, Column>(
  items: readonly Item[],
  columns: readonly Column[],
): { column: Column; items: Item[] }[] {
  return columns.map((column, columnIndex) => ({
    column,
    items: items.filter((_, index) => index % columns.length === columnIndex),
  }));
}
