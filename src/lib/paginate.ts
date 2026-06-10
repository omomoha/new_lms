/**
 * paginate — pure logic for splitting converted document HTML (mammoth DOCX
 * output) into reader-friendly "pages".
 *
 * Rules:
 *  - A new page starts at every h1/h2 heading (chapter-like breaks), unless
 *    the current page is still empty.
 *  - A page also breaks once its accumulated visible-text length exceeds
 *    `charBudget` (long unbroken documents still paginate).
 *  - Headings are never left dangling at the very end of a page: if a page
 *    would end with a heading block, the heading moves to the next page.
 *
 * No DOM or firebase imports — unit-testable in isolation.
 */

export interface DocBlock {
  /** Lowercase tag name of the top-level element, e.g. "p", "h1", "table". */
  tag: string;
  /** Serialized outer HTML of the block (already sanitized by the caller). */
  html: string;
  /** Visible text length of the block. */
  textLength: number;
}

const HEADING_BREAKS = new Set(["h1", "h2"]);
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export const DEFAULT_CHAR_BUDGET = 3500;

/** Split blocks into pages (arrays of blocks). Never returns an empty list
 *  for non-empty input; empty input yields []. */
export function paginateBlocks(
  blocks: DocBlock[],
  charBudget: number = DEFAULT_CHAR_BUDGET
): DocBlock[][] {
  const budget = Math.max(500, charBudget);
  const pages: DocBlock[][] = [];
  let current: DocBlock[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length > 0) {
      pages.push(current);
      current = [];
      currentChars = 0;
    }
  };

  for (const block of blocks) {
    const isChapterBreak = HEADING_BREAKS.has(block.tag);
    if ((isChapterBreak && current.length > 0) || currentChars >= budget) {
      flush();
    }
    current.push(block);
    currentChars += block.textLength;
  }
  flush();

  // Move dangling headings (heading as the last block of a page) onto the
  // next page so a section title is never separated from its content.
  for (let i = 0; i < pages.length - 1; i++) {
    const page = pages[i];
    while (page.length > 1 && HEADING_TAGS.has(page[page.length - 1].tag)) {
      pages[i + 1].unshift(page.pop() as DocBlock);
    }
  }

  return pages;
}

/** Clamp a 1-based page number into [1, total]. total === 0 returns 1. */
export function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page)) return 1;
  if (total <= 0) return 1;
  return Math.min(Math.max(Math.round(page), 1), total);
}
