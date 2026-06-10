import { describe, it, expect } from "vitest";
import {
  computeXp,
  levelFor,
  BADGES,
  earnedBadges,
  LEVEL_THRESHOLDS,
  XP_PER_LESSON,
  XP_PER_QUIZ_PASS,
  XP_PER_CERTIFICATE,
  type GamificationStats,
} from "@/lib/gamification";
import * as serverRules from "../functions/src/gamificationRules";

const stats = (over: Partial<GamificationStats> = {}): GamificationStats => ({
  lessonsCompleted: 0,
  quizzesPassed: 0,
  certificates: 0,
  streakDays: 0,
  ...over,
});

describe("XP", () => {
  it("computes from the rule table", () => {
    expect(computeXp(stats({ lessonsCompleted: 3, quizzesPassed: 2, certificates: 1 }))).toBe(
      3 * XP_PER_LESSON + 2 * XP_PER_QUIZ_PASS + 1 * XP_PER_CERTIFICATE
    );
  });

  it("client and server rules stay in sync", () => {
    expect(serverRules.XP_PER_LESSON).toBe(XP_PER_LESSON);
    expect(serverRules.XP_PER_QUIZ_PASS).toBe(XP_PER_QUIZ_PASS);
    expect(serverRules.XP_PER_CERTIFICATE).toBe(XP_PER_CERTIFICATE);
    const s = { lessonsCompleted: 7, quizzesPassed: 4, certificates: 2 };
    expect(serverRules.computeXp(s)).toBe(computeXp(stats(s)));
  });
});

describe("levels", () => {
  it("starts at level 1 with 0 XP", () => {
    const l = levelFor(0);
    expect(l.level).toBe(1);
    expect(l.pct).toBe(0);
  });
  it("crosses thresholds exactly", () => {
    expect(levelFor(LEVEL_THRESHOLDS[1]).level).toBe(2);
    expect(levelFor(LEVEL_THRESHOLDS[1] - 1).level).toBe(1);
  });
  it("caps at max level with pct 100 and needed 0", () => {
    const top = levelFor(LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + 5000);
    expect(top.level).toBe(LEVEL_THRESHOLDS.length);
    expect(top.needed).toBe(0);
    expect(top.pct).toBe(100);
  });
  it("handles negative input", () => {
    expect(levelFor(-50).level).toBe(1);
  });
});

describe("badges", () => {
  it("ids are unique", () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
  });
  it("none earned with zero stats; all progress within 0-100", () => {
    const s = stats();
    expect(earnedBadges(s)).toHaveLength(0);
    for (const b of BADGES) {
      const p = b.progress(s);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });
  it("all earned with maxed stats", () => {
    const s = stats({ lessonsCompleted: 100, quizzesPassed: 50, certificates: 10, streakDays: 30 });
    expect(earnedBadges(s)).toHaveLength(BADGES.length);
  });
  it("earned implies progress 100", () => {
    const s = stats({ lessonsCompleted: 10 });
    for (const b of BADGES.filter((b) => b.earned(s))) {
      expect(b.progress(s)).toBe(100);
    }
  });
});
