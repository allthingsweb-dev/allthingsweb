/**
 * Deals items into `columnCount` columns round-robin, so neighbouring items
 * land side by side and every column stays within one item of the others.
 */
export function distributeIntoColumns<T>(
  items: readonly T[],
  columnCount: number,
): T[][] {
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new RangeError("columnCount must be a positive integer");
  }

  const columns = Array.from({ length: columnCount }, (): T[] => []);
  items.forEach((item, index) => {
    columns[index % columnCount]!.push(item);
  });
  return columns;
}
