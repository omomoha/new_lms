/**
 * Resume ("Continue learning") selection logic.
 * Pure functions — importable in tests without Firebase.
 */

/** Minimal shape the picker needs — dashboard course rows satisfy this. */
export interface ResumeCandidate {
  id: string;
  title: string;
  progressPct: number;
  hasAccess: boolean;
  /** Enrollment `updatedAt` as epoch milliseconds, when available. */
  updatedAtMillis?: number | null;
  /** Enrollment `lastLessonId`, when available. */
  lastLessonId?: string | null;
}

/** How the resume course was chosen — drives the card label. */
export type ResumeBasis = "recency" | "progress";

export interface ResumeSelection<T extends ResumeCandidate = ResumeCandidate> {
  course: T;
  basis: ResumeBasis;
}

function hasTimestamp(c: ResumeCandidate): boolean {
  return (
    typeof c.updatedAtMillis === "number" &&
    Number.isFinite(c.updatedAtMillis) &&
    c.updatedAtMillis > 0
  );
}

/**
 * Pick the course a learner should resume:
 *  - only accessible courses that are in progress (0 < progressPct < 100)
 *  - prefer the most recently touched enrollment (updatedAtMillis desc)
 *  - if no candidate has a usable timestamp, fall back to the highest
 *    progressPct ("Pick up where you left off")
 * Ties keep the first candidate (stable with the caller's ordering).
 * Returns null when nothing is in progress.
 */
export function pickResumeCourse<T extends ResumeCandidate>(
  candidates: T[]
): ResumeSelection<T> | null {
  const inProgress = candidates.filter(
    (c) => c.hasAccess && c.progressPct > 0 && c.progressPct < 100
  );
  if (inProgress.length === 0) return null;

  const withTime = inProgress.filter(hasTimestamp);
  if (withTime.length > 0) {
    const course = withTime.reduce((best, c) =>
      (c.updatedAtMillis ?? 0) > (best.updatedAtMillis ?? 0) ? c : best
    );
    return { course, basis: "recency" };
  }

  const course = inProgress.reduce((best, c) =>
    c.progressPct > best.progressPct ? c : best
  );
  return { course, basis: "progress" };
}
