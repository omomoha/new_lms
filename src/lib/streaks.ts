/**
 * Streak calculation utilities.
 * Pure functions — importable in tests without Firebase.
 *
 * A "streak" is a run of consecutive calendar days (local time) on which the
 * learner completed at least one lesson. The current streak counts back from
 * today, or from yesterday when the learner hasn't completed anything yet
 * today (so a live streak isn't shown as broken before the day is over).
 */

export const WEEKLY_GOAL = 5;

export interface StreakStats {
  /** Consecutive active days ending today (or yesterday if today inactive). */
  currentStreak: number;
  /** Longest run of consecutive active days ever. */
  longestStreak: number;
  /** True when at least one lesson was completed today (local time). */
  activeToday: boolean;
  /** Number of lesson completions since Monday 00:00 local time. */
  thisWeekCount: number;
  /** Weekly lesson-completion goal (constant). */
  weeklyGoal: number;
}

/** Local-time midnight for the calendar day containing `d`. */
function localMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local midnight `n` days after the given local midnight (DST-safe). */
function addDays(midnight: Date, n: number): Date {
  return new Date(
    midnight.getFullYear(),
    midnight.getMonth(),
    midnight.getDate() + n
  );
}

/**
 * Compute streak statistics from raw lesson-completion timestamps.
 * Duplicate completions on the same calendar day count as ONE day for
 * streak purposes, but each completion counts toward the weekly total.
 */
export function computeStreaks(completionDates: Date[], now: Date): StreakStats {
  const valid = completionDates.filter(
    (d) => d instanceof Date && !Number.isNaN(d.getTime())
  );

  // Unique active days, keyed by local-midnight epoch millis.
  const daySet = new Set<number>(valid.map((d) => localMidnight(d).getTime()));
  const days = Array.from(daySet).sort((a, b) => a - b);

  // ── Longest streak ─────────────────────────────────────────────────────────
  let longestStreak = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    const isConsecutive =
      i > 0 && addDays(new Date(days[i - 1]), 1).getTime() === days[i];
    run = isConsecutive ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
  }

  // ── Current streak ─────────────────────────────────────────────────────────
  const today = localMidnight(now);
  const activeToday = daySet.has(today.getTime());

  let cursor: Date | null = null;
  if (activeToday) {
    cursor = today;
  } else if (daySet.has(addDays(today, -1).getTime())) {
    cursor = addDays(today, -1);
  }

  let currentStreak = 0;
  while (cursor !== null && daySet.has(cursor.getTime())) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  // ── This week (Monday 00:00 local → now) ──────────────────────────────────
  const dowFromMonday = (today.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const weekStart = addDays(today, -dowFromMonday).getTime();
  const thisWeekCount = valid.filter((d) => {
    const day = localMidnight(d).getTime();
    return day >= weekStart && day <= today.getTime();
  }).length;

  return {
    currentStreak,
    longestStreak,
    activeToday,
    thisWeekCount,
    weeklyGoal: WEEKLY_GOAL,
  };
}
