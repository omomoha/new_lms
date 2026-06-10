"use client";

/**
 * Assessment Insights — Admin
 *
 * Pre → post assessment analytics, chart-style:
 *  - Cohort dropdown filters everything (or "All cohorts").
 *  - Cohort view: per-course avg pre vs post score, avg time-to-complete
 *    pre vs post, improvement rate, average lift.
 *  - Individual view: per-learner table (pre %, post %, Δ, durations) with a
 *    learner selector to chart one person's pre vs post per course.
 *
 * Methodology: baseline = FIRST pre attempt; outcome = LATEST post attempt.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { AppUser, Cohort, Course, Assessment, Attempt } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { PairedBarChart, DeltaBadge } from "@/components/ui/PairedBarChart";
import DownloadCsvButton from "@/components/admin/DownloadCsvButton";
import type { CsvField } from "@/lib/csvExport";

interface Row {
  uid: string;
  name: string;
  cohortIds: string[];
  courseId: string;
  courseTitle: string;
  prePct: number | null;
  postPct: number | null;
  delta: number | null;       // post − pre, in points
  preDur: number | null;      // seconds
  postDur: number | null;
}

const fmtDur = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;

/** Column order for the insights CSV export. */
const INSIGHTS_CSV_HEADERS = [
  "learner",
  "course",
  "cohorts",
  "pre_pct",
  "post_pct",
  "improvement_points",
  "pre_duration_sec",
  "post_duration_sec",
];

/** Filename-safe slug for the export scope (cohort / learner name). */
const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "scope";

export default function AssessmentInsightsPage() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [cohortFilter, setCohortFilter] = useState<string>("all");
  const [learnerFilter, setLearnerFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [cohortSnap, userSnap, courseSnap, preSnap, postSnap] = await Promise.all([
          getDocs(collection(db, "cohorts")),
          getDocs(collection(db, "users")),
          getDocs(collection(db, "courses")),
          getDocs(query(collection(db, "assessments"), where("kind", "==", "pre"))),
          getDocs(query(collection(db, "assessments"), where("kind", "==", "post"))),
        ]);

        setCohorts(cohortSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cohort)));
        const users = userSnap.docs
          .map((d) => ({ ...d.data(), uid: d.id } as AppUser))
          .filter((u) => u.role !== "admin");
        const courses = new Map(
          courseSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as Course])
        );
        const pres = preSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Assessment));
        const posts = postSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Assessment));

        // Attempts per assessment (one query each; assessment count is small)
        const attemptsByAssessment = new Map<string, Attempt[]>();
        await Promise.all(
          [...pres, ...posts].map(async (a) => {
            const snap = await getDocs(
              query(collection(db, "attempts"), where("assessmentId", "==", a.id))
            );
            attemptsByAssessment.set(snap.empty ? a.id : a.id, snap.docs.map((d) => d.data() as Attempt));
          })
        );

        const pct = (at: Attempt) => (at.total > 0 ? (at.score / at.total) * 100 : 0);
        const ms = (at: Attempt) => at.submittedAt?.toMillis?.() ?? 0;

        // Build per-learner-per-course rows for every course that has a pre or post
        const courseIds = new Set([...pres, ...posts].map((a) => a.courseId));
        const built: Row[] = [];
        for (const courseId of Array.from(courseIds)) {
          const course = courses.get(courseId);
          const pre = pres.find((a) => a.courseId === courseId);
          const post = posts.find((a) => a.courseId === courseId);
          const preAttempts = pre ? attemptsByAssessment.get(pre.id) ?? [] : [];
          const postAttempts = post ? attemptsByAssessment.get(post.id) ?? [] : [];

          for (const u of users) {
            const myPre = preAttempts
              .filter((a) => a.userId === u.uid)
              .sort((x, y) => ms(x) - ms(y))[0]; // FIRST pre = true baseline
            const myPost = postAttempts
              .filter((a) => a.userId === u.uid)
              .sort((x, y) => ms(y) - ms(x))[0]; // LATEST post = outcome
            if (!myPre && !myPost) continue;

            const prePct = myPre ? pct(myPre) : null;
            const postPct = myPost ? pct(myPost) : null;
            built.push({
              uid: u.uid,
              name: u.name || u.email,
              cohortIds: u.cohortIds ?? [],
              courseId,
              courseTitle: course?.title ?? courseId,
              prePct,
              postPct,
              delta: prePct != null && postPct != null ? postPct - prePct : null,
              preDur: myPre?.durationSec ?? null,
              postDur: myPost?.durationSec ?? null,
            });
          }
        }
        setRows(built);
      } catch (err: unknown) {
        console.error("AssessmentInsights load failed:", err);
        setLoadError(err instanceof Error ? err.message : "Failed to load insights.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const cohortRows = useMemo(
    () =>
      cohortFilter === "all"
        ? rows
        : rows.filter((r) => r.cohortIds.includes(cohortFilter)),
    [rows, cohortFilter]
  );
  const visibleRows = useMemo(
    () =>
      learnerFilter === "all"
        ? cohortRows
        : cohortRows.filter((r) => r.uid === learnerFilter),
    [cohortRows, learnerFilter]
  );
  const learnersInCohort = useMemo(() => {
    const seen = new Map<string, string>();
    cohortRows.forEach((r) => seen.set(r.uid, r.name));
    return Array.from(seen, ([uid, name]) => ({ uid, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [cohortRows]);

  // ── Aggregates (cohort or individual scope = visibleRows) ─────────────────
  const stats = useMemo(() => {
    const both = visibleRows.filter((r) => r.delta !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      participants: new Set(visibleRows.map((r) => r.uid)).size,
      withBoth: both.length,
      avgLift: avg(both.map((r) => r.delta as number)),
      improvementRate: both.length
        ? (both.filter((r) => (r.delta as number) > 0).length / both.length) * 100
        : null,
      avgPre: avg(visibleRows.filter((r) => r.prePct != null).map((r) => r.prePct as number)),
      avgPost: avg(visibleRows.filter((r) => r.postPct != null).map((r) => r.postPct as number)),
      avgPreDur: avg(visibleRows.filter((r) => r.preDur != null).map((r) => r.preDur as number)),
      avgPostDur: avg(visibleRows.filter((r) => r.postDur != null).map((r) => r.postDur as number)),
    };
  }, [visibleRows]);

  // Per-course chart data within current scope
  const scoreChart = useMemo(() => {
    const byCourse = new Map<string, Row[]>();
    visibleRows.forEach((r) => {
      byCourse.set(r.courseTitle, [...(byCourse.get(r.courseTitle) ?? []), r]);
    });
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return Array.from(byCourse, ([label, rs]) => ({
      label,
      a: avg(rs.filter((r) => r.prePct != null).map((r) => r.prePct as number)),
      b: avg(rs.filter((r) => r.postPct != null).map((r) => r.postPct as number)),
    }));
  }, [visibleRows]);

  const durationChart = useMemo(() => {
    const byCourse = new Map<string, Row[]>();
    visibleRows.forEach((r) => {
      byCourse.set(r.courseTitle, [...(byCourse.get(r.courseTitle) ?? []), r]);
    });
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return Array.from(byCourse, ([label, rs]) => ({
      label,
      a: avg(rs.filter((r) => r.preDur != null).map((r) => r.preDur as number)),
      b: avg(rs.filter((r) => r.postDur != null).map((r) => r.postDur as number)),
    })).filter((d) => d.a != null || d.b != null);
  }, [visibleRows]);

  // ── CSV export (respects active cohort + learner filters) ─────────────────
  const csvRows = useMemo<CsvField[][]>(() => {
    const cohortNameById = new Map(cohorts.map((c) => [c.id, c.name]));
    return visibleRows
      .slice()
      .sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999)) // mirror the table
      .map((r) => [
        r.name,
        r.courseTitle,
        r.cohortIds
          .map((id) => cohortNameById.get(id))
          .filter((n): n is string => n !== undefined)
          .join("; "),
        r.prePct != null ? Math.round(r.prePct) : null,
        r.postPct != null ? Math.round(r.postPct) : null,
        r.delta != null ? Math.round(r.delta) : null,
        r.preDur != null ? Math.round(r.preDur) : null,
        r.postDur != null ? Math.round(r.postDur) : null,
      ]);
  }, [visibleRows, cohorts]);

  const csvFilename = useMemo(() => {
    const scope =
      learnerFilter !== "all"
        ? slugify(
            learnersInCohort.find((l) => l.uid === learnerFilter)?.name ??
              "learner"
          )
        : cohortFilter !== "all"
          ? slugify(
              cohorts.find((c) => c.id === cohortFilter)?.tag ||
                cohorts.find((c) => c.id === cohortFilter)?.name ||
                "cohort"
            )
          : "all";
    return `insights-${scope}-${new Date().toISOString().slice(0, 10)}.csv`;
  }, [learnerFilter, cohortFilter, learnersInCohort, cohorts]);

  if (loading) {
    return (
      <AdminShell>
        <div className="flex justify-center py-20"><Spinner /></div>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="page-hero mb-6">
        <span className="kicker">ADMIN · ANALYTICS</span>
        <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
          Assessment Insights
        </h1>
        <p className="text-sm mt-1 text-brand-mist">
          Pre → post improvement by cohort and by learner. Baseline = first pre-assessment
          attempt; outcome = latest post-assessment attempt.
        </p>
      </div>

      {loadError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {loadError}
        </div>
      )}

      {/* Filters */}
      <div className="card mb-4 flex flex-col sm:flex-row gap-3 sm:items-end">
        <label className="text-xs font-semibold flex-1 text-brand-muted">
          Cohort
          <select
            className="input-field mt-1"
            value={cohortFilter}
            onChange={(e) => { setCohortFilter(e.target.value); setLearnerFilter("all"); }}
          >
            <option value="all">All cohorts</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold flex-1 text-brand-muted">
          Learner (individual view)
          <select
            className="input-field mt-1"
            value={learnerFilter}
            onChange={(e) => setLearnerFilter(e.target.value)}
          >
            <option value="all">All learners — cohort view</option>
            {learnersInCohort.map((l) => (
              <option key={l.uid} value={l.uid}>{l.name}</option>
            ))}
          </select>
        </label>
        <DownloadCsvButton
          filename={csvFilename}
          headers={INSIGHTS_CSV_HEADERS}
          rows={csvRows}
          loading={loading}
          emptyReason="No assessment results for this selection — nothing to export."
          className="!py-2 self-start sm:self-auto"
        />
      </div>

      {visibleRows.length === 0 ? (
        <div className="card text-center py-14 text-sm text-brand-muted">
          No assessment attempts yet for this selection. Insights appear once learners
          take pre/post assessments.
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              {
                label: "Avg improvement",
                value: stats.avgLift != null ? `${stats.avgLift >= 0 ? "+" : ""}${Math.round(stats.avgLift)} pts` : "—",
                sub: stats.avgPre != null && stats.avgPost != null
                  ? `${Math.round(stats.avgPre)}% → ${Math.round(stats.avgPost)}%`
                  : "needs pre & post",
              },
              {
                label: "Improvement rate",
                value: stats.improvementRate != null ? `${Math.round(stats.improvementRate)}%` : "—",
                sub: `${stats.withBoth} learner-course pairs with both`,
              },
              {
                label: "Avg time — pre",
                value: stats.avgPreDur != null ? fmtDur(stats.avgPreDur) : "—",
                sub: "first attempt",
              },
              {
                label: "Avg time — post",
                value: stats.avgPostDur != null ? fmtDur(stats.avgPostDur) : "—",
                sub: "latest attempt",
              },
            ].map((kpi) => (
              <div key={kpi.label} className="card !py-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-muted">
                  {kpi.label}
                </p>
                <p className="font-serif-brand text-2xl mt-1 text-brand-primary">{kpi.value}</p>
                <p className="text-xs mt-0.5 text-brand-muted">{kpi.sub}</p>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <div className="card">
              <h2 className="font-medium mb-3 text-brand-ink">
                Average score — pre vs post (%)
              </h2>
              <PairedBarChart
                title="Average assessment score by course, pre versus post"
                data={scoreChart}
                aLabel="Pre"
                bLabel="Post"
                unit="%"
                maxY={100}
              />
            </div>
            <div className="card">
              <h2 className="font-medium mb-3 text-brand-ink">
                Average time to complete — pre vs post
              </h2>
              {durationChart.length > 0 ? (
                <PairedBarChart
                  title="Average time to complete assessments by course, pre versus post"
                  data={durationChart}
                  aLabel="Pre"
                  bLabel="Post"
                  formatValue={fmtDur}
                />
              ) : (
                <p className="text-sm py-8 text-center text-brand-muted">
                  No timing data yet — durations are recorded for attempts made from now on.
                </p>
              )}
            </div>
          </div>

          {/* Individual table */}
          <div className="card overflow-hidden !p-0">
            <div className="px-4 sm:px-5 py-3 border-b border-brand-line bg-brand-cream">
              <h2 className="font-semibold text-sm text-brand-primary">
                Individual results {learnerFilter !== "all" && "— selected learner"}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-brand-muted">
                    <th className="px-4 py-2">Learner</th>
                    <th className="px-4 py-2">Course</th>
                    <th className="px-4 py-2 text-right">Pre</th>
                    <th className="px-4 py-2 text-right">Post</th>
                    <th className="px-4 py-2 text-right">Δ</th>
                    <th className="px-4 py-2 text-right">Pre time</th>
                    <th className="px-4 py-2 text-right">Post time</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows
                    .slice()
                    .sort((a, b) => (b.delta ?? -999) - (a.delta ?? -999))
                    .map((r) => (
                      <tr key={r.uid + r.courseId} className="border-t border-brand-line">
                        <td className="px-4 py-2">
                          <Link href={`/admin/users/${r.uid}`} className="hover:underline text-brand-primary">
                            {r.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-brand-muted">{r.courseTitle}</td>
                        <td className="px-4 py-2 text-right">{r.prePct != null ? `${Math.round(r.prePct)}%` : "—"}</td>
                        <td className="px-4 py-2 text-right font-medium text-brand-primary">
                          {r.postPct != null ? `${Math.round(r.postPct)}%` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right"><DeltaBadge delta={r.delta} /></td>
                        <td className="px-4 py-2 text-right text-brand-muted">
                          {r.preDur != null ? fmtDur(r.preDur) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-brand-muted">
                          {r.postDur != null ? fmtDur(r.postDur) : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
