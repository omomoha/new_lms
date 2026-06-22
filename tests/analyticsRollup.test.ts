/**
 * Unit tests — analytics rollup math (Phase 4 — Workstream D).
 *
 * Mirrors the style of progress.test.ts / gamification.test.ts: pure functions,
 * no Firebase. Pins the leadership-metric formulae and at-risk thresholds so
 * they can't silently drift.
 */

import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  WEEK_MS,
  AT_RISK,
  activeLearners,
  completionFunnel,
  avgProgress,
  timeOnTask,
  quizPassRate,
  assessEnrollmentRisk,
  detectAtRisk,
  estimateTokens,
  rollupAiUsage,
  TOKEN_PRICES,
  type EnrollmentRec,
  type ProgressRec,
  type AttemptRec,
} from "../functions/src/analyticsRollup";

const NOW = 1_700_000_000_000; // fixed epoch ms

function enr(over: Partial<EnrollmentRec> = {}): EnrollmentRec {
  return {
    userId: "u1",
    courseId: "c1",
    cohortId: "co1",
    progressPct: 0,
    updatedAtMs: NOW,
    dueAtMs: null,
    ...over,
  };
}
function prog(over: Partial<ProgressRec> = {}): ProgressRec {
  return {
    userId: "u1",
    lessonId: "l1",
    courseId: "c1",
    positionSec: 0,
    completedAtMs: null,
    updatedAtMs: NOW,
    ...over,
  };
}
function att(over: Partial<AttemptRec> = {}): AttemptRec {
  return { userId: "u1", courseId: "c1", passed: true, submittedAtMs: NOW, ...over };
}

describe("activeLearners (DAU/WAU)", () => {
  it("is empty for no progress", () => {
    expect(activeLearners([], NOW)).toEqual({ dau: 0, wau: 0 });
  });

  it("counts distinct learners within the day and week windows", () => {
    const p = [
      prog({ userId: "u1", updatedAtMs: NOW - 1 * DAY_MS + 1 }), // today (just inside)
      prog({ userId: "u2", updatedAtMs: NOW - 3 * DAY_MS }), // this week only
      prog({ userId: "u3", updatedAtMs: NOW - 10 * DAY_MS }), // outside both
    ];
    expect(activeLearners(p, NOW)).toEqual({ dau: 1, wau: 2 });
  });

  it("dedupes a learner with multiple progress docs", () => {
    const p = [
      prog({ userId: "u1", updatedAtMs: NOW }),
      prog({ userId: "u1", updatedAtMs: NOW - 1000 }),
    ];
    expect(activeLearners(p, NOW)).toEqual({ dau: 1, wau: 1 });
  });

  it("uses completedAt when it is the more recent signal", () => {
    const p = [prog({ userId: "u9", updatedAtMs: 0, completedAtMs: NOW })];
    expect(activeLearners(p, NOW).dau).toBe(1);
  });

  it("ignores future timestamps and the exact week boundary edge", () => {
    expect(activeLearners([prog({ updatedAtMs: NOW + DAY_MS })], NOW).dau).toBe(0);
    // exactly WEEK_MS old → still within the <= window
    expect(activeLearners([prog({ updatedAtMs: NOW - WEEK_MS })], NOW).wau).toBe(1);
  });
});

describe("completionFunnel", () => {
  it("is all-zero for no enrollments", () => {
    expect(completionFunnel([])).toEqual({
      enrolled: 0,
      started: 0,
      completed: 0,
      completionPct: 0,
    });
  });

  it("counts started (>0) and completed (>=100) correctly", () => {
    const e = [
      enr({ progressPct: 0 }),
      enr({ progressPct: 1 }),
      enr({ progressPct: 50 }),
      enr({ progressPct: 100 }),
      enr({ progressPct: 100 }),
    ];
    expect(completionFunnel(e)).toEqual({
      enrolled: 5,
      started: 4, // progressPct > 0: 1, 50, 100, 100
      completed: 2,
      completionPct: 40,
    });
  });

  it("rounds completion percentage", () => {
    const e = [enr({ progressPct: 100 }), enr(), enr()]; // 1/3
    expect(completionFunnel(e).completionPct).toBe(33);
  });
});

describe("avgProgress", () => {
  it("is 0 when empty", () => {
    expect(avgProgress([])).toBe(0);
  });
  it("rounds the mean", () => {
    expect(avgProgress([enr({ progressPct: 10 }), enr({ progressPct: 25 })])).toBe(18);
  });
});

describe("timeOnTask", () => {
  it("sums positions and averages over learners with activity", () => {
    const p = [
      prog({ userId: "u1", positionSec: 100 }),
      prog({ userId: "u1", positionSec: 200 }),
      prog({ userId: "u2", positionSec: 300 }),
      prog({ userId: "u3", positionSec: 0 }), // no activity → not counted
    ];
    const r = timeOnTask(p);
    expect(r.totalSeconds).toBe(600);
    expect(r.learners).toBe(2);
    expect(r.avgSecondsPerLearner).toBe(300);
  });

  it("ignores negative / non-finite positions", () => {
    const p = [prog({ positionSec: -5 }), prog({ positionSec: NaN })];
    expect(timeOnTask(p)).toEqual({
      totalSeconds: 0,
      avgSecondsPerLearner: 0,
      learners: 0,
    });
  });
});

describe("quizPassRate", () => {
  it("is 0 with no attempts", () => {
    expect(quizPassRate([])).toEqual({ attempts: 0, passed: 0, passRate: 0 });
  });
  it("computes a rounded pass rate", () => {
    const a = [att({ passed: true }), att({ passed: false }), att({ passed: true })];
    expect(quizPassRate(a)).toEqual({ attempts: 3, passed: 2, passRate: 67 });
  });
});

describe("assessEnrollmentRisk", () => {
  it("never flags a completed enrollment", () => {
    expect(
      assessEnrollmentRisk(enr({ progressPct: 100, dueAtMs: NOW - DAY_MS }), [], NOW)
    ).toBeNull();
  });

  it("returns null when nothing is wrong", () => {
    expect(assessEnrollmentRisk(enr({ progressPct: 40 }), [], NOW)).toBeNull();
  });

  it("flags overdue when the due date is strictly in the past", () => {
    const r = assessEnrollmentRisk(
      enr({ progressPct: 40, dueAtMs: NOW - 1 }),
      [],
      NOW
    );
    expect(r?.reasons).toEqual(["overdue"]);
  });

  it("does NOT flag overdue exactly at the due instant", () => {
    expect(assessEnrollmentRisk(enr({ progressPct: 40, dueAtMs: NOW }), [], NOW)).toBeNull();
  });

  it("flags stalled at exactly the stalled window", () => {
    const r = assessEnrollmentRisk(
      enr({ progressPct: 40, updatedAtMs: NOW - AT_RISK.STALLED_MS }),
      [],
      NOW
    );
    expect(r?.reasons).toEqual(["stalled"]);
  });

  it("does NOT flag stalled just inside the window", () => {
    expect(
      assessEnrollmentRisk(
        enr({ progressPct: 40, updatedAtMs: NOW - AT_RISK.STALLED_MS + 1 }),
        [],
        NOW
      )
    ).toBeNull();
  });

  it("flags low_scores only at/above MIN_ATTEMPTS and below LOW_PASS_RATE", () => {
    // 1 attempt failing → below min, no flag
    expect(
      assessEnrollmentRisk(enr({ progressPct: 40 }), [att({ passed: false })], NOW)
    ).toBeNull();
    // 2 attempts, 0 passed → 0% < 50% → flag
    const r = assessEnrollmentRisk(
      enr({ progressPct: 40 }),
      [att({ passed: false }), att({ passed: false })],
      NOW
    );
    expect(r?.reasons).toEqual(["low_scores"]);
    // 2 attempts, 1 passed → 50% is NOT below 50% → no flag
    expect(
      assessEnrollmentRisk(
        enr({ progressPct: 40 }),
        [att({ passed: true }), att({ passed: false })],
        NOW
      )
    ).toBeNull();
  });

  it("accumulates multiple reasons", () => {
    const r = assessEnrollmentRisk(
      enr({
        progressPct: 20,
        dueAtMs: NOW - DAY_MS,
        updatedAtMs: NOW - AT_RISK.STALLED_MS,
      }),
      [att({ passed: false }), att({ passed: false })],
      NOW
    );
    expect(r?.reasons.sort()).toEqual(["low_scores", "overdue", "stalled"]);
  });
});

describe("detectAtRisk", () => {
  it("keys attempts by userId_courseId", () => {
    const enrollments = [
      enr({ userId: "u1", courseId: "c1", progressPct: 30 }),
      enr({ userId: "u2", courseId: "c1", progressPct: 100 }), // complete → skipped
    ];
    const map = new Map<string, AttemptRec[]>([
      ["u1_c1", [att({ passed: false }), att({ passed: false })]],
    ]);
    const out = detectAtRisk(enrollments, map, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].userId).toBe("u1");
    expect(out[0].reasons).toContain("low_scores");
  });
});

describe("estimateTokens", () => {
  it("is 0 for empty / invalid", () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(-10)).toBe(0);
    expect(estimateTokens(NaN)).toBe(0);
  });
  it("uses ~4 chars per token, rounding up", () => {
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(400)).toBe(100);
  });
});

describe("rollupAiUsage", () => {
  it("splits questions/answers and estimates cost at Sonnet pricing", () => {
    const r = rollupAiUsage({
      turns: [
        { role: "user", chars: 400 }, // 100 input tokens
        { role: "assistant", chars: 800 }, // 200 output tokens
      ],
      conversations: 1,
      learners: 1,
      feedbackUp: 3,
      feedbackDown: 1,
    });
    expect(r.questions).toBe(1);
    expect(r.answers).toBe(1);
    expect(r.estInputTokens).toBe(100);
    expect(r.estOutputTokens).toBe(200);
    const expectedCost =
      (100 / 1_000_000) * TOKEN_PRICES.inputPerMillion +
      (200 / 1_000_000) * TOKEN_PRICES.outputPerMillion;
    expect(r.estCostUsd).toBe(Math.round(expectedCost * 100) / 100);
    expect(r.satisfactionPct).toBe(75); // 3 / 4
  });

  it("reports 0 satisfaction with no feedback", () => {
    const r = rollupAiUsage({
      turns: [],
      conversations: 0,
      learners: 0,
      feedbackUp: 0,
      feedbackDown: 0,
    });
    expect(r.satisfactionPct).toBe(0);
    expect(r.estCostUsd).toBe(0);
    expect(r.totalTurns).toBe(0);
  });
});
