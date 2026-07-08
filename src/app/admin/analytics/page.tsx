"use client";

/**
 * /admin/analytics — Deeper analytics & reporting (Phase 4 — Workstream D).
 *
 * Reads PRE-AGGREGATED docs from the admin-only `analytics/` collection
 * (written hourly by the analyticsAggregation Cloud Function) — no live scans
 * of enrollments/progress/attempts, so the page stays cheap at 5k learners.
 *
 * Gated behind the `analyticsDashboard` feature flag so it can ship dark.
 * Admin-only: AdminShell redirects non-admins and firestore.rules restricts
 * analytics/ reads to admins.
 *
 * Metrics shown:
 *   • Active learners (DAU / WAU)        • Course completion % + funnel
 *   • Cohort-vs-cohort comparison        • Time-on-task
 *   • At-risk learners                   • Quiz pass rates
 *   • AI tutor usage + estimated cost
 */

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { PairedBarChart } from "@/components/ui/PairedBarChart";
import DownloadCsvButton from "@/components/admin/DownloadCsvButton";
import {
  buildCourseAnalyticsCsv,
  buildCohortAnalyticsCsv,
  buildAtRiskCsv,
} from "@/lib/csvExport";
import { getFeatureFlag } from "@/lib/featureFlags";
import type { AnalyticsOverview, AtRiskReason } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number | undefined | null): string {
  return typeof n === "number" ? n.toLocaleString() : "—";
}

/** Seconds → "Xh Ym" / "Ym" / "Zs" for time-on-task display. */
function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "0s";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const REASON_LABEL: Record<AtRiskReason, string> = {
  stalled: "Stalled",
  overdue: "Overdue",
  low_scores: "Low scores",
};

const REASON_STYLE: Record<AtRiskReason, { bg: string; fg: string }> = {
  stalled: { bg: "#FEF3C7", fg: "#92400E" },
  overdue: { bg: "#FDE8E8", fg: "#B91C1C" },
  low_scores: { bg: "#E7F1DE", fg: "#2C7A6B" },
};

// ─── Small inline stat card (matches admin/page.tsx) ──────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card !p-0 overflow-hidden flex flex-col">
      <div className="h-1 w-full flex-shrink-0 bg-brand-accent" />
      <div className="px-4 py-4 flex flex-col gap-1">
        <span className="font-serif-brand text-3xl font-semibold leading-none text-brand-primary">
          {value}
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-brand-muted">
          {label}
        </span>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminAnalyticsPage() {
  const [flagState, setFlagState] = useState<"loading" | "on" | "off">("loading");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const on = await getFeatureFlag("analyticsDashboard");
      if (!active) return;
      setFlagState(on ? "on" : "off");
      if (!on) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "analytics", "overview"));
        if (!active) return;
        if (snap.exists()) {
          setData(snap.data() as AnalyticsOverview);
        } else {
          setError(
            "No analytics have been computed yet. The hourly aggregation " +
              "function writes analytics/overview on its next run."
          );
        }
      } catch (err) {
        console.error("AdminAnalytics: load failed:", err);
        if (active) setError("Could not load analytics. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const generatedAt =
    data?.generatedAt && typeof (data.generatedAt as unknown) === "object"
      ? // Firestore Timestamp → JS Date
        (data.generatedAt as { toDate?: () => Date }).toDate?.()
      : null;

  // Cohort comparison: completion % vs avg progress %, side by side.
  const cohortChartData = (data?.cohorts ?? []).map((c) => ({
    label: c.name,
    a: c.avgProgress,
    b: c.completionPct,
  }));

  const courseCsv = buildCourseAnalyticsCsv(data?.courses ?? []);
  const cohortCsv = buildCohortAnalyticsCsv(data?.cohorts ?? []);
  const atRiskCsv = buildAtRiskCsv(data?.atRisk.learners ?? []);

  const completionMax = Math.max(
    ...(data?.courses ?? []).map((c) => c.enrolled),
    1
  );

  return (
    <AdminShell>
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <span className="kicker">ADMIN · ANALYTICS</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Analytics &amp; Reporting
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Pre-aggregated leadership metrics — refreshed hourly.
            {generatedAt && (
              <>
                {" "}
                Last updated{" "}
                {generatedAt.toLocaleString("en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                .
              </>
            )}
          </p>
        </div>
      </div>

      {(flagState === "loading" || (flagState === "on" && loading)) && (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      )}

      {flagState === "off" && (
        <div className="card text-center py-12 text-brand-muted">
          <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-mint" />
          <p>
            The analytics dashboard isn&apos;t enabled yet. Turn on the{" "}
            <code>analyticsDashboard</code> feature flag in{" "}
            <code>settings/features</code> to enable it.
          </p>
        </div>
      )}

      {flagState === "on" && !loading && error && (
        <div className="rounded-lg p-4 text-sm mb-6 bg-amber-100 text-amber-900">
          {error}
        </div>
      )}

      {flagState === "on" && !loading && data && (
        <>
          {/* ── Headline KPIs ──────────────────────────────────────────────── */}
          <section className="mb-8">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-4 text-brand-muted">
              Engagement
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard label="Active today (DAU)" value={fmtNum(data.activeLearners.dau)} />
              <StatCard label="Active this week (WAU)" value={fmtNum(data.activeLearners.wau)} />
              <StatCard label="Learners" value={fmtNum(data.totals.learners)} />
              <StatCard label="Enrollments" value={fmtNum(data.completion.enrolled)} />
              <StatCard
                label="Completion rate"
                value={`${data.completion.completionPct}%`}
              />
              <StatCard label="At-risk" value={fmtNum(data.atRisk.total)} />
            </div>
          </section>

          {/* ── Completion funnel + time-on-task + quiz ────────────────────── */}
          <section className="mb-8 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card">
              <h2 className="text-sm font-semibold mb-4 text-brand-ink">
                Completion funnel
              </h2>
              {(["enrolled", "started", "completed"] as const).map((stage) => {
                const v = data.completion[stage];
                const pct =
                  data.completion.enrolled > 0
                    ? Math.round((v / data.completion.enrolled) * 100)
                    : 0;
                return (
                  <div key={stage} className="mb-3 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="capitalize text-brand-ink">{stage}</span>
                      <span className="tabular-nums text-brand-muted">
                        {fmtNum(v)} ({pct}%)
                      </span>
                    </div>
                    <div
                      className="rounded-sm relative"
                      style={{ height: "14px", backgroundColor: "#E7F1DE" }}
                    >
                      <div
                        className="absolute top-0 left-0 h-full rounded-sm"
                        style={{ width: `${pct}%`, backgroundColor: "#13403A" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold mb-4 text-brand-ink">
                Time-on-task
              </h2>
              <p className="font-serif-brand text-3xl font-semibold text-brand-primary leading-none">
                {fmtDuration(data.timeOnTask.totalSeconds)}
              </p>
              <p className="text-xs text-brand-muted mt-1">total watched</p>
              <p className="text-sm text-brand-ink mt-4">
                {fmtDuration(data.timeOnTask.avgSecondsPerLearner)} avg /
                active learner
              </p>
              <p className="text-xs text-brand-muted mt-1">
                across {fmtNum(data.timeOnTask.learners)} learner(s) with activity
              </p>
            </div>

            <div className="card">
              <h2 className="text-sm font-semibold mb-4 text-brand-ink">
                Quiz pass rate
              </h2>
              <p className="font-serif-brand text-3xl font-semibold text-brand-primary leading-none">
                {data.quiz.passRate}%
              </p>
              <p className="text-xs text-brand-muted mt-1">
                {fmtNum(data.quiz.passed)} of {fmtNum(data.quiz.attempts)} attempts
                passed
              </p>
            </div>
          </section>

          {/* ── AI tutor usage ─────────────────────────────────────────────── */}
          <section className="mb-8">
            <div className="card">
              <h2 className="text-sm font-semibold mb-1 text-brand-ink">
                AI tutor usage
              </h2>
              <p className="text-xs text-brand-muted mb-4">
                Token counts &amp; cost are <strong>estimates</strong> (~4 chars/token
                over persisted turns at Sonnet pricing) — for trend visibility, not
                billing.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard label="Conversations" value={fmtNum(data.aiUsage.conversations)} />
                <StatCard label="Learners reached" value={fmtNum(data.aiUsage.learners)} />
                <StatCard label="Questions asked" value={fmtNum(data.aiUsage.questions)} />
                <StatCard
                  label="Est. tokens"
                  value={fmtNum(
                    data.aiUsage.estInputTokens + data.aiUsage.estOutputTokens
                  )}
                />
                <StatCard
                  label="Est. cost"
                  value={`$${data.aiUsage.estCostUsd.toFixed(2)}`}
                />
                <StatCard
                  label="Satisfaction"
                  value={
                    data.aiUsage.feedbackUp + data.aiUsage.feedbackDown > 0
                      ? `${data.aiUsage.satisfactionPct}%`
                      : "—"
                  }
                />
              </div>
              {data.aiUsage.feedbackUp + data.aiUsage.feedbackDown > 0 && (
                <p className="text-xs text-brand-muted mt-3">
                  {fmtNum(data.aiUsage.feedbackUp)} 👍 ·{" "}
                  {fmtNum(data.aiUsage.feedbackDown)} 👎 on answers
                </p>
              )}
            </div>
          </section>

          {/* ── Cohort comparison ──────────────────────────────────────────── */}
          <section className="mb-8">
            <div className="card">
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-brand-ink">
                  Cohort comparison
                </h2>
                <DownloadCsvButton
                  filename={`cohort-analytics-${new Date()
                    .toISOString()
                    .slice(0, 10)}.csv`}
                  headers={cohortCsv.headers}
                  rows={cohortCsv.rows}
                  emptyReason="No cohort data to export yet."
                />
              </div>
              {cohortChartData.length > 0 ? (
                <PairedBarChart
                  data={cohortChartData}
                  aLabel="Avg progress"
                  bLabel="Completion"
                  unit="%"
                  maxY={100}
                  title="Cohort avg progress vs completion %"
                />
              ) : (
                <p className="text-sm text-brand-muted">No cohort data yet.</p>
              )}

              {data.cohorts.length > 0 && (
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-brand-muted">
                        <th className="py-2 pr-3">Cohort</th>
                        <th className="py-2 px-3 text-right">Enrolled</th>
                        <th className="py-2 px-3 text-right">Completion</th>
                        <th className="py-2 px-3 text-right">Avg progress</th>
                        <th className="py-2 px-3 text-right">DAU</th>
                        <th className="py-2 px-3 text-right">WAU</th>
                        <th className="py-2 pl-3 text-right">At-risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.cohorts.map((c) => (
                        <tr key={c.cohortId} className="border-t border-brand-mint/40">
                          <td className="py-2 pr-3 text-brand-ink">{c.name}</td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {fmtNum(c.enrolled)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {c.completionPct}%
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {c.avgProgress}%
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {fmtNum(c.dau)}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {fmtNum(c.wau)}
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums text-brand-primary font-semibold">
                            {fmtNum(c.atRiskCount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          {/* ── Per-course completion ──────────────────────────────────────── */}
          <section className="mb-8">
            <div className="card">
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-brand-ink">
                  Course completion &amp; quiz pass rates
                </h2>
                <DownloadCsvButton
                  filename={`course-analytics-${new Date()
                    .toISOString()
                    .slice(0, 10)}.csv`}
                  headers={courseCsv.headers}
                  rows={courseCsv.rows}
                  emptyReason="No course data to export yet."
                />
              </div>
              {data.courses.length === 0 ? (
                <p className="text-sm text-brand-muted">No course data yet.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {data.courses.map((c) => {
                    const enrolledPct = (c.enrolled / completionMax) * 100;
                    return (
                      <div key={c.courseId} className="flex items-center gap-3">
                        <span
                          className="text-xs font-medium w-36 flex-shrink-0 truncate text-brand-ink"
                          title={c.title}
                        >
                          {c.title}
                        </span>
                        <div
                          className="flex-1 rounded-sm relative"
                          style={{ height: "18px", backgroundColor: "#E7F1DE" }}
                        >
                          <div
                            className="absolute top-0 left-0 h-full rounded-sm"
                            style={{
                              width: `${enrolledPct}%`,
                              backgroundColor: "#E7F1DE",
                              border: "1px solid #8FB85C",
                            }}
                          />
                          <div
                            className="absolute top-0 left-0 h-full rounded-sm"
                            style={{
                              width: `${(enrolledPct * c.completionPct) / 100}%`,
                              backgroundColor: "#13403A",
                            }}
                          />
                        </div>
                        <span className="text-xs w-24 flex-shrink-0 text-right tabular-nums text-brand-muted">
                          {c.completed}/{c.enrolled} done
                        </span>
                        <span className="text-xs w-12 flex-shrink-0 text-right tabular-nums font-semibold text-brand-primary">
                          {c.completionPct}%
                        </span>
                        <span
                          className="text-xs w-20 flex-shrink-0 text-right tabular-nums text-brand-muted hidden sm:block"
                          title="Quiz pass rate"
                        >
                          {c.quizAttempts > 0 ? `${c.quizPassRate}% quiz` : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── At-risk learners ───────────────────────────────────────────── */}
          <section className="mb-8">
            <div className="card">
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-brand-ink">
                  At-risk learners{" "}
                  <span className="text-xs font-normal text-brand-muted">
                    ({fmtNum(data.atRisk.total)} total
                    {data.atRisk.total > data.atRisk.learners.length
                      ? `, showing first ${data.atRisk.learners.length}`
                      : ""}
                    )
                  </span>
                </h2>
                <DownloadCsvButton
                  filename={`at-risk-${new Date().toISOString().slice(0, 10)}.csv`}
                  headers={atRiskCsv.headers}
                  rows={atRiskCsv.rows}
                  emptyReason="No at-risk learners to export."
                />
              </div>
              {data.atRisk.learners.length === 0 ? (
                <p className="text-sm text-brand-muted">
                  No at-risk learners — everyone&apos;s on track.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-brand-muted">
                        <th className="py-2 pr-3">Learner</th>
                        <th className="py-2 px-3">Course</th>
                        <th className="py-2 px-3">Cohort</th>
                        <th className="py-2 px-3 text-right">Progress</th>
                        <th className="py-2 pl-3">Reasons</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.atRisk.learners.map((l) => (
                        <tr
                          key={`${l.userId}_${l.courseId}`}
                          className="border-t border-brand-mint/40"
                        >
                          <td className="py-2 pr-3 font-mono text-xs text-brand-muted">
                            {l.userId.slice(0, 8)}…
                          </td>
                          <td className="py-2 px-3 text-brand-ink">{l.courseTitle}</td>
                          <td className="py-2 px-3 text-brand-muted">
                            {l.cohortName ?? "—"}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {l.progressPct}%
                          </td>
                          <td className="py-2 pl-3">
                            <span className="flex flex-wrap gap-1">
                              {l.reasons.map((r) => (
                                <span
                                  key={r}
                                  className="px-1.5 py-0.5 rounded-full text-xs font-semibold"
                                  style={{
                                    backgroundColor: REASON_STYLE[r].bg,
                                    color: REASON_STYLE[r].fg,
                                  }}
                                >
                                  {REASON_LABEL[r]}
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}
