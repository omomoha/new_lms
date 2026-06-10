/**
 * Unit tests — per-cohort course due-date utilities
 */

import { describe, it, expect } from "vitest";
import { resolveDueDate, dueBadge, type DueDateCohort } from "../src/lib/dueDates";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fake Firestore Timestamp — anything with toMillis(). */
function ts(millis: number): { toMillis(): number } {
  return { toMillis: () => millis };
}

// Fixed "now": Wednesday 10 June 2026, 12:00 local time.
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

/** Local-time millis helper relative to NOW's calendar (June 2026). */
function on(day: number, hour = 12, minute = 0): number {
  return new Date(2026, 5, day, hour, minute, 0).getTime();
}

describe("resolveDueDate", () => {
  it("returns null when no cohorts are given", () => {
    expect(resolveDueDate("c1", [])).toBeNull();
  });

  it("returns null when no cohort sets a due date for the course", () => {
    const cohorts: DueDateCohort[] = [
      {},
      { courseDueDates: {} },
      { courseDueDates: { other: ts(on(20)) } },
    ];
    expect(resolveDueDate("c1", cohorts)).toBeNull();
  });

  it("returns the due date when exactly one cohort sets it", () => {
    const cohorts: DueDateCohort[] = [
      { courseDueDates: { c1: ts(on(15)) } },
      {},
    ];
    expect(resolveDueDate("c1", cohorts)).toBe(on(15));
  });

  it("picks the EARLIEST due date across multiple cohorts", () => {
    const cohorts: DueDateCohort[] = [
      { courseDueDates: { c1: ts(on(20)) } },
      { courseDueDates: { c1: ts(on(12)) } },
      { courseDueDates: { c1: ts(on(25)) } },
    ];
    expect(resolveDueDate("c1", cohorts)).toBe(on(12));
  });

  it("resolves per course — other courses' dates don't interfere", () => {
    const cohorts: DueDateCohort[] = [
      { courseDueDates: { c1: ts(on(20)), c2: ts(on(11)) } },
    ];
    expect(resolveDueDate("c1", cohorts)).toBe(on(20));
    expect(resolveDueDate("c2", cohorts)).toBe(on(11));
  });
});

describe("dueBadge", () => {
  it("returns null when there is no due date", () => {
    expect(dueBadge(null, NOW, 0)).toBeNull();
  });

  it("returns null for a completed course even when overdue", () => {
    expect(dueBadge(on(1), NOW, 100)).toBeNull();
    expect(dueBadge(on(1), NOW, 120)).toBeNull();
  });

  it("flags overdue when now is strictly past the due date", () => {
    const badge = dueBadge(on(9, 23, 59), NOW, 40);
    expect(badge).toEqual({
      label: "Overdue — was due 9 Jun 2026",
      tone: "overdue",
    });
  });

  it("is NOT overdue at the exact due instant — shows Due today", () => {
    const badge = dueBadge(NOW, NOW, 40);
    expect(badge).toEqual({ label: "Due today", tone: "warn" });
  });

  it("shows 'Due today' when less than a full day remains", () => {
    const badge = dueBadge(NOW + DAY_MS - 1, NOW, 0);
    expect(badge).toEqual({ label: "Due today", tone: "warn" });
  });

  it("shows 'Due in 1d' at exactly one day out", () => {
    const badge = dueBadge(NOW + DAY_MS, NOW, 0);
    expect(badge).toEqual({ label: "Due in 1d", tone: "warn" });
  });

  it("warns up to and including 7 days out", () => {
    const badge = dueBadge(NOW + 7 * DAY_MS, NOW, 0);
    expect(badge).toEqual({ label: "Due in 7d", tone: "warn" });
  });

  it("goes muted past the 7-day window", () => {
    const badge = dueBadge(NOW + 8 * DAY_MS, NOW, 0);
    expect(badge).toEqual({ label: "Due 18 Jun 2026", tone: "muted" });
  });

  it("muted label uses the deterministic en-GB short date", () => {
    const badge = dueBadge(on(30), NOW, 50);
    expect(badge).toEqual({ label: "Due 30 Jun 2026", tone: "muted" });
  });

  it("accepts an injected formatter (muted)", () => {
    const badge = dueBadge(on(30), NOW, 0, (m) => `@${m}`);
    expect(badge).toEqual({ label: `Due @${on(30)}`, tone: "muted" });
  });

  it("accepts an injected formatter (overdue)", () => {
    const badge = dueBadge(on(1), NOW, 0, () => "FIXED");
    expect(badge).toEqual({ label: "Overdue — was due FIXED", tone: "overdue" });
  });

  it("still badges at 99% progress, drops at 100%", () => {
    expect(dueBadge(on(30), NOW, 99)).not.toBeNull();
    expect(dueBadge(on(30), NOW, 100)).toBeNull();
  });
});
