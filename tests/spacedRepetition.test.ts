/**
 * Unit tests — spacedRepetition (SM-2-lite scheduling)
 */

import { describe, it, expect } from "vitest";
import {
  initialState,
  review,
  isDue,
  EASE_FLOOR,
  EASE_CAP,
  DEFAULT_EASE,
  type CardSchedule,
} from "../src/lib/spacedRepetition";

const NOW = new Date("2026-06-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe("initialState", () => {
  it("returns a new card due immediately with default ease", () => {
    const s = initialState();
    expect(s).toEqual({ interval: 0, ease: DEFAULT_EASE, reps: 0 });
  });
});

describe("review — first review path", () => {
  it("good on a new card → 1 day, reps 1, ease unchanged", () => {
    const r = review(initialState(), "good", NOW);
    expect(r.interval).toBe(1);
    expect(r.reps).toBe(1);
    expect(r.ease).toBe(DEFAULT_EASE);
    expect(r.due.getTime()).toBe(NOW.getTime() + 1 * DAY_MS);
  });

  it("second good → 3 days", () => {
    const first = review(initialState(), "good", NOW);
    const second = review(first, "good", NOW);
    expect(second.interval).toBe(3);
    expect(second.reps).toBe(2);
  });

  it("third good → interval × ease (3 × 2.5 = 7.5 days)", () => {
    let s: CardSchedule = initialState();
    s = review(s, "good", NOW);
    s = review(s, "good", NOW);
    const third = review(s, "good", NOW);
    expect(third.interval).toBeCloseTo(7.5, 5);
    expect(third.reps).toBe(3);
  });

  it("easy on a new card → 4 days and ease bumped", () => {
    const r = review(initialState(), "easy", NOW);
    expect(r.interval).toBe(4);
    expect(r.reps).toBe(1);
    expect(r.ease).toBeCloseTo(DEFAULT_EASE + 0.15, 5);
  });

  it("hard on a new card → minimum 1 day interval", () => {
    const r = review(initialState(), "hard", NOW);
    expect(r.interval).toBe(1);
    expect(r.reps).toBe(1);
    expect(r.ease).toBeCloseTo(DEFAULT_EASE - 0.15, 5);
  });
});

describe("review — again resets the card", () => {
  it("resets interval and reps, schedules ~10 minutes out", () => {
    const mature: CardSchedule = { interval: 21, ease: 2.5, reps: 5 };
    const r = review(mature, "again", NOW);
    expect(r.interval).toBe(0);
    expect(r.reps).toBe(0);
    expect(r.ease).toBeCloseTo(2.3, 5);
    expect(r.due.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
  });

  it("a good after again follows the graduating steps again (1 day)", () => {
    const mature: CardSchedule = { interval: 21, ease: 2.5, reps: 5 };
    const lapsed = review(mature, "again", NOW);
    const relearned = review(lapsed, "good", NOW);
    expect(relearned.interval).toBe(1);
    expect(relearned.reps).toBe(1);
  });
});

describe("review — ease floor and cap", () => {
  it("repeated again never drops ease below the floor", () => {
    let s: CardSchedule = initialState();
    for (let i = 0; i < 20; i++) {
      s = review(s, "again", NOW);
    }
    expect(s.ease).toBe(EASE_FLOOR);
  });

  it("repeated hard never drops ease below the floor", () => {
    let s: CardSchedule = initialState();
    for (let i = 0; i < 20; i++) {
      s = review(s, "hard", NOW);
    }
    expect(s.ease).toBe(EASE_FLOOR);
  });

  it("repeated easy never raises ease above the cap", () => {
    let s: CardSchedule = initialState();
    for (let i = 0; i < 20; i++) {
      s = review(s, "easy", NOW);
    }
    expect(s.ease).toBe(EASE_CAP);
  });
});

describe("review — due date calculation", () => {
  it("due is now + interval days for graded reviews", () => {
    const s: CardSchedule = { interval: 10, ease: 2.0, reps: 3 };
    const r = review(s, "good", NOW);
    expect(r.interval).toBeCloseTo(20, 5); // 10 × 2.0
    expect(r.due.getTime()).toBe(NOW.getTime() + r.interval * DAY_MS);
  });

  it("hard multiplies the interval by 1.2", () => {
    const s: CardSchedule = { interval: 10, ease: 2.0, reps: 3 };
    const r = review(s, "hard", NOW);
    expect(r.interval).toBeCloseTo(12, 5);
    expect(r.due.getTime()).toBe(NOW.getTime() + 12 * DAY_MS);
  });

  it("easy multiplies by ease × 1.3", () => {
    const s: CardSchedule = { interval: 10, ease: 2.0, reps: 3 };
    const r = review(s, "easy", NOW);
    expect(r.interval).toBeCloseTo(26, 5); // 10 × 2.0 × 1.3
  });

  it("does not mutate the input state", () => {
    const s: CardSchedule = { interval: 5, ease: 2.5, reps: 2 };
    review(s, "easy", NOW);
    expect(s).toEqual({ interval: 5, ease: 2.5, reps: 2 });
  });
});

describe("review — monotonic interval growth", () => {
  it("intervals strictly grow under repeated good answers", () => {
    let s: CardSchedule = initialState();
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      s = review(s, "good", NOW);
      expect(s.interval).toBeGreaterThan(prev);
      prev = s.interval;
    }
  });

  it("intervals never shrink under repeated hard answers (≥ 1 day)", () => {
    let s: CardSchedule = initialState();
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      s = review(s, "hard", NOW);
      expect(s.interval).toBeGreaterThanOrEqual(Math.max(prev, 1));
      prev = s.interval;
    }
  });
});

describe("isDue", () => {
  it("is true when due is in the past or exactly now", () => {
    expect(isDue({ due: new Date(NOW.getTime() - 1000) }, NOW)).toBe(true);
    expect(isDue({ due: new Date(NOW.getTime()) }, NOW)).toBe(true);
  });

  it("is false when due is in the future", () => {
    expect(isDue({ due: new Date(NOW.getTime() + 1000) }, NOW)).toBe(false);
  });

  it("a card graded again is not due immediately but is due in 10 minutes", () => {
    const r = review(initialState(), "again", NOW);
    expect(isDue(r, NOW)).toBe(false);
    expect(isDue(r, new Date(NOW.getTime() + 10 * 60 * 1000))).toBe(true);
  });
});
