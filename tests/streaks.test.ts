/**
 * Unit tests — streak calculation utilities
 */

import { describe, it, expect } from "vitest";
import { computeStreaks, WEEKLY_GOAL } from "../src/lib/streaks";

// Fixed "now": Wednesday 10 June 2026, 18:00 local time.
const NOW = new Date(2026, 5, 10, 18, 0, 0);

/** Local date helper relative to NOW's calendar (June 2026). */
function on(day: number, hour = 12, minute = 0): Date {
  return new Date(2026, 5, day, hour, minute, 0);
}

describe("computeStreaks", () => {
  it("returns all zeroes for an empty history", () => {
    const s = computeStreaks([], NOW);
    expect(s.currentStreak).toBe(0);
    expect(s.longestStreak).toBe(0);
    expect(s.activeToday).toBe(false);
    expect(s.thisWeekCount).toBe(0);
    expect(s.weeklyGoal).toBe(5);
    expect(WEEKLY_GOAL).toBe(5);
  });

  it("ignores invalid dates", () => {
    const s = computeStreaks([new Date(NaN)], NOW);
    expect(s.currentStreak).toBe(0);
    expect(s.longestStreak).toBe(0);
    expect(s.thisWeekCount).toBe(0);
  });

  it("handles a single completion today", () => {
    const s = computeStreaks([on(10, 9)], NOW);
    expect(s.currentStreak).toBe(1);
    expect(s.longestStreak).toBe(1);
    expect(s.activeToday).toBe(true);
    expect(s.thisWeekCount).toBe(1);
  });

  it("keeps the streak alive when only yesterday is active (today not over)", () => {
    const s = computeStreaks([on(9)], NOW);
    expect(s.currentStreak).toBe(1);
    expect(s.activeToday).toBe(false);
  });

  it("treats a completion 2 days ago as a broken streak", () => {
    const s = computeStreaks([on(8)], NOW);
    expect(s.currentStreak).toBe(0);
    expect(s.longestStreak).toBe(1);
    expect(s.activeToday).toBe(false);
  });

  it("a gap splits runs: counts only the run touching today/yesterday", () => {
    // Active: Jun 6, 7 — gap on 8 — active 9, 10.
    const s = computeStreaks([on(6), on(7), on(9), on(10)], NOW);
    expect(s.currentStreak).toBe(2);
    expect(s.longestStreak).toBe(2);
    expect(s.activeToday).toBe(true);
  });

  it("counts a multi-week run spanning month boundaries", () => {
    // 14 consecutive days: 28 May → 10 June (today).
    const dates: Date[] = [];
    for (let i = 0; i < 14; i++) {
      dates.push(new Date(2026, 4, 28 + i, 10)); // rolls over into June
    }
    const s = computeStreaks(dates, NOW);
    expect(s.currentStreak).toBe(14);
    expect(s.longestStreak).toBe(14);
    expect(s.activeToday).toBe(true);
    // Current week is Mon 8 → Wed 10: three of those days fall inside it.
    expect(s.thisWeekCount).toBe(3);
  });

  it("collapses duplicate same-day completions for streaks but counts each for the weekly total", () => {
    const s = computeStreaks(
      [on(10, 8), on(10, 12), on(10, 16), on(9, 9), on(9, 20)],
      NOW
    );
    expect(s.currentStreak).toBe(2);
    expect(s.longestStreak).toBe(2);
    expect(s.thisWeekCount).toBe(5); // every completion counts toward the goal
  });

  it("tracks the longest streak separately from the current one", () => {
    // 5-day run long ago (May 1–5) + a single completion today.
    const past = [1, 2, 3, 4, 5].map((d) => new Date(2026, 4, d, 10));
    const s = computeStreaks([...past, on(10)], NOW);
    expect(s.currentStreak).toBe(1);
    expect(s.longestStreak).toBe(5);
  });

  it("handles day boundaries: 23:59 and 00:00 land on adjacent days", () => {
    const s = computeStreaks([on(9, 23, 59), on(10, 0, 1)], NOW);
    expect(s.currentStreak).toBe(2);
    expect(s.longestStreak).toBe(2);
    expect(s.activeToday).toBe(true);
  });

  it("excludes last week's completions from thisWeekCount", () => {
    // NOW is Wednesday Jun 10 → week starts Monday Jun 8.
    // Sunday Jun 7 is last week; Mon 8 and Tue 9 are this week.
    const s = computeStreaks([on(7), on(8), on(8, 15), on(9)], NOW);
    expect(s.thisWeekCount).toBe(3);
    expect(s.currentStreak).toBe(3); // Sun–Tue run still counts back from yesterday
    expect(s.longestStreak).toBe(3);
  });

  it("works when 'now' is a Monday (week resets)", () => {
    const monday = new Date(2026, 5, 8, 9, 0, 0); // Monday 8 June 2026
    const s = computeStreaks([on(7), on(8, 8)], monday);
    expect(s.thisWeekCount).toBe(1); // only Monday's completion
    expect(s.currentStreak).toBe(2); // Sunday + Monday
    expect(s.activeToday).toBe(true);
  });
});
