/**
 * Course search utilities.
 * Pure functions — importable in tests without Firebase.
 *
 * Matching is substring-based on normalized text (no RegExp built from user
 * input), so special regex characters in the query can never throw or change
 * the match semantics.
 */

/** Minimal searchable shape — courses satisfy this. */
export interface Searchable {
  title: string;
  description?: string;
}

/**
 * Normalize text for matching: Unicode NFD decomposition, strip combining
 * diacritical marks, lowercase. "Café" → "cafe".
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Filter items by a free-text query against title + description.
 * Case- and diacritic-insensitive. Empty/whitespace query returns all items.
 */
export function filterCourses<T extends Searchable>(
  items: T[],
  query: string
): T[] {
  const q = normalizeForSearch(query.trim());
  if (!q) return items;
  return items.filter((item) =>
    normalizeForSearch(`${item.title} ${item.description ?? ""}`).includes(q)
  );
}
