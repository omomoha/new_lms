/**
 * Per-cohort course due-date utilities.
 * Pure functions — importable in tests without Firebase.
 *
 * Cohort docs may carry an optional map field
 * `courseDueDates: { [courseId]: Timestamp }`. These helpers resolve the
 * effective due date for a course across all of a learner's cohorts (the
 * EARLIEST one wins) and turn it into a small display badge.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Structural stand-in for a Firestore Timestamp — anything with toMillis().
 * Keeps this module free of firebase imports.
 */
export interface DueTimestampLike {
  toMillis(): number;
}

/** The slice of a cohort doc this module cares about. */
export interface DueDateCohort {
  courseDueDates?: Record<string, DueTimestampLike>;
}

export type DueTone = "muted" | "warn" | "overdue";

export interface DueBadgeInfo {
  label: string;
  tone: DueTone;
}

/** Formats a millis timestamp into a short human date, e.g. "12 Jun 2026". */
export type DueDateFormatter = (millis: number) => string;

/**
 * Default short-date formatter — en-GB so output is deterministic
 * ("12 Jun 2026") regardless of the host's default locale.
 */
export const formatShortDate: DueDateFormatter = (millis) =>
  new Date(millis).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/**
 * Earliest due date (epoch millis) for a course across the user's cohorts.
 * Returns null when no cohort sets a due date for that course.
 */
export function resolveDueDate(
  courseId: string,
  cohorts: Array<DueDateCohort>
): number | null {
  let earliest: number | null = null;
  for (const cohort of cohorts) {
    const ts = cohort.courseDueDates?.[courseId];
    if (!ts) continue;
    const millis = ts.toMillis();
    if (!Number.isFinite(millis)) continue;
    if (earliest === null || millis < earliest) earliest = millis;
  }
  return earliest;
}

/**
 * Build the due-date badge for a course card.
 *
 * Returns null when there is no due date OR the course is complete
 * (progressPct >= 100). Otherwise:
 *  - overdue (now strictly past due):  "Overdue — was due 12 Jun 2026"
 *  - warn (due within 7 days):         "Due today" / "Due in Nd"
 *  - muted (further out):              "Due 12 Jun 2026"
 */
export function dueBadge(
  dueMillis: number | null,
  nowMillis: number,
  progressPct: number,
  format: DueDateFormatter = formatShortDate
): DueBadgeInfo | null {
  if (dueMillis === null || progressPct >= 100) return null;

  if (nowMillis > dueMillis) {
    return { label: `Overdue — was due ${format(dueMillis)}`, tone: "overdue" };
  }

  const daysLeft = Math.floor((dueMillis - nowMillis) / DAY_MS);
  if (daysLeft === 0) {
    return { label: "Due today", tone: "warn" };
  }
  if (daysLeft <= 7) {
    return { label: `Due in ${daysLeft}d`, tone: "warn" };
  }

  return { label: `Due ${format(dueMillis)}`, tone: "muted" };
}
