/**
 * Restores a stored column selection. Columns added (or renamed) after it was saved
 * are shown: hiding is an explicit choice, a new column must not start hidden.
 * Older data has no `knownHeaders`; if some stored header no longer exists the
 * columns changed since, so every header it does not list counts as new.
 */
export function restoreVisibleHeaders(
  allHeaders: string[],
  alwaysVisibleHeaders: string[],
  stored: string[],
  knownHeaders?: string[],
) {
  const available = new Set(allHeaders);
  const storedSet = new Set(stored);
  const known = new Set(
    knownHeaders ?? (stored.every((header) => available.has(header)) ? allHeaders : stored),
  );
  const visible = allHeaders.filter((header) => storedSet.has(header) || !known.has(header));
  if (visible.length === 0) return new Set(allHeaders);
  return new Set([...visible, ...alwaysVisibleHeaders]);
}
