/**
 * Unit tests — progress calculation utilities
 */

import { describe, it, expect } from "vitest";
import { calcProgressPct, isVideoWatched, shouldSaveProgress } from "../src/lib/progress";

describe("calcProgressPct", () => {
  it("returns 0 when no lessons are completed", () => {
    expect(calcProgressPct([], ["l1", "l2", "l3"])).toBe(0);
  });

  it("returns 100 when all lessons are completed", () => {
    expect(calcProgressPct(["l1", "l2", "l3"], ["l1", "l2", "l3"])).toBe(100);
  });

  it("returns correct percentage for partial completion", () => {
    expect(calcProgressPct(["l1"], ["l1", "l2", "l3", "l4"])).toBe(25);
  });

  it("rounds to nearest integer", () => {
    // 1 of 3 = 33.33... → rounds to 33
    expect(calcProgressPct(["l1"], ["l1", "l2", "l3"])).toBe(33);
  });

  it("returns 0 when allLessonIds is empty", () => {
    expect(calcProgressPct(["l1"], [])).toBe(0);
  });

  it("ignores completed IDs not in allLessonIds", () => {
    // completed has a stale lesson ID that no longer exists in the course
    expect(calcProgressPct(["l1", "stale-id"], ["l1", "l2"])).toBe(50);
  });
});

describe("isVideoWatched", () => {
  it("returns true when position >= 80% of duration", () => {
    expect(isVideoWatched(480, 600)).toBe(true);  // 80%
    expect(isVideoWatched(599, 600)).toBe(true);  // 99.8%
  });

  it("returns false when position < 80% of duration", () => {
    expect(isVideoWatched(479, 600)).toBe(false); // 79.8%
    expect(isVideoWatched(0, 600)).toBe(false);
  });

  it("returns false when duration is 0 or negative", () => {
    expect(isVideoWatched(10, 0)).toBe(false);
    expect(isVideoWatched(10, -1)).toBe(false);
  });
});

describe("shouldSaveProgress", () => {
  it("returns true when enough time has passed", () => {
    expect(shouldSaveProgress(0, 5000, 5000)).toBe(true);
    expect(shouldSaveProgress(1000, 7000, 5000)).toBe(true);
  });

  it("returns false when not enough time has passed", () => {
    expect(shouldSaveProgress(0, 4999, 5000)).toBe(false);
    expect(shouldSaveProgress(1000, 5999, 5000)).toBe(false);
  });

  it("uses default interval of 5000ms", () => {
    expect(shouldSaveProgress(0, 5000)).toBe(true);
    expect(shouldSaveProgress(0, 4999)).toBe(false);
  });
});
