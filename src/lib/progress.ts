/**
 * Progress calculation utilities.
 * Pure functions — importable in tests without Firebase.
 */

/**
 * Calculate overall course progress as a percentage.
 * @param completedLessonIds  Set of lesson IDs the learner has completed
 * @param allLessonIds        All lesson IDs in the course (order preserved)
 * @returns                   0–100 rounded to nearest integer
 */
export function calcProgressPct(
  completedLessonIds: string[],
  allLessonIds: string[]
): number {
  if (allLessonIds.length === 0) return 0;
  const completedSet = new Set(completedLessonIds);
  const completed = allLessonIds.filter((id) => completedSet.has(id)).length;
  return Math.round((completed / allLessonIds.length) * 100);
}

/**
 * Determine whether a video should be considered "watched" based on position.
 * A lesson is complete when the learner has watched ≥80% of the video.
 */
export function isVideoWatched(positionSec: number, durationSec: number): boolean {
  if (durationSec <= 0) return false;
  return positionSec / durationSec >= 0.8;
}

/**
 * Throttle helper — returns true if enough time has passed since lastSaved.
 * Used to throttle Firestore writes on video timeupdate events.
 */
export function shouldSaveProgress(
  lastSavedAt: number,
  nowMs: number,
  intervalMs = 5000
): boolean {
  return nowMs - lastSavedAt >= intervalMs;
}
