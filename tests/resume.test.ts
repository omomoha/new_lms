/**
 * Unit tests — resume ("Continue learning") selection logic
 */

import { describe, it, expect } from "vitest";
import { pickResumeCourse, type ResumeCandidate } from "../src/lib/resume";

function candidate(overrides: Partial<ResumeCandidate> & { id: string }): ResumeCandidate {
  return {
    title: `Course ${overrides.id}`,
    progressPct: 0,
    hasAccess: true,
    updatedAtMillis: null,
    lastLessonId: null,
    ...overrides,
  };
}

describe("pickResumeCourse", () => {
  it("returns null for an empty list", () => {
    expect(pickResumeCourse([])).toBeNull();
  });

  it("returns null when nothing is in progress (0% and 100% excluded)", () => {
    const result = pickResumeCourse([
      candidate({ id: "a", progressPct: 0 }),
      candidate({ id: "b", progressPct: 100 }),
    ]);
    expect(result).toBeNull();
  });

  it("ignores inaccessible (locked) courses even when in progress", () => {
    const result = pickResumeCourse([
      candidate({ id: "locked", progressPct: 50, hasAccess: false }),
    ]);
    expect(result).toBeNull();
  });

  it("picks the most recently touched course when timestamps exist", () => {
    const result = pickResumeCourse([
      candidate({ id: "old", progressPct: 90, updatedAtMillis: 1_000 }),
      candidate({ id: "recent", progressPct: 10, updatedAtMillis: 9_000 }),
      candidate({ id: "mid", progressPct: 50, updatedAtMillis: 5_000 }),
    ]);
    expect(result?.course.id).toBe("recent");
    expect(result?.basis).toBe("recency");
  });

  it("prefers timestamped candidates over untimestamped ones", () => {
    const result = pickResumeCourse([
      candidate({ id: "no-time", progressPct: 99, updatedAtMillis: null }),
      candidate({ id: "with-time", progressPct: 5, updatedAtMillis: 1_000 }),
    ]);
    expect(result?.course.id).toBe("with-time");
    expect(result?.basis).toBe("recency");
  });

  it("falls back to highest progressPct when no timestamps exist", () => {
    const result = pickResumeCourse([
      candidate({ id: "low", progressPct: 20 }),
      candidate({ id: "high", progressPct: 80 }),
      candidate({ id: "mid", progressPct: 50 }),
    ]);
    expect(result?.course.id).toBe("high");
    expect(result?.basis).toBe("progress");
  });

  it("treats non-positive / non-finite timestamps as missing", () => {
    const result = pickResumeCourse([
      candidate({ id: "zero-ts", progressPct: 70, updatedAtMillis: 0 }),
      candidate({ id: "nan-ts", progressPct: 30, updatedAtMillis: Number.NaN }),
    ]);
    // No usable timestamps → progress fallback
    expect(result?.course.id).toBe("zero-ts");
    expect(result?.basis).toBe("progress");
  });

  it("skips completed and not-started courses while choosing", () => {
    const result = pickResumeCourse([
      candidate({ id: "done", progressPct: 100, updatedAtMillis: 99_000 }),
      candidate({ id: "fresh", progressPct: 0, updatedAtMillis: 98_000 }),
      candidate({ id: "active", progressPct: 33, updatedAtMillis: 1_000 }),
    ]);
    expect(result?.course.id).toBe("active");
  });

  it("keeps the first candidate on ties (stable)", () => {
    const result = pickResumeCourse([
      candidate({ id: "first", progressPct: 50, updatedAtMillis: 5_000 }),
      candidate({ id: "second", progressPct: 50, updatedAtMillis: 5_000 }),
    ]);
    expect(result?.course.id).toBe("first");
  });

  it("returns the full candidate object (extra fields preserved)", () => {
    const input = [
      { ...candidate({ id: "x", progressPct: 40, updatedAtMillis: 1 }), thumbPath: "p.png" },
    ];
    const result = pickResumeCourse(input);
    expect(result?.course.thumbPath).toBe("p.png");
  });
});
