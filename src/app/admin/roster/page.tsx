"use client";

/**
 * Learner Roster — Admin
 *
 * Aggregates all users, cohorts, enrollments, and attempts into a single
 * sortable/filterable table. All data loaded via full-collection getDocs —
 * NO composite-index queries.
 *
 * Columns:
 *   Name / Email / Role | Cohorts | Avg Progress | Completed | Attempts | Last Activity | View
 *
 * Footer: row count + client-side CSV export.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { AppUser, Cohort, Enrollment, Attempt } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import DownloadCsvButton from "@/components/admin/DownloadCsvButton";
import type { CsvField } from "@/lib/csvExport";

// ─── Per-user aggregated row ──────────────────────────────────────────────────

interface RosterRow {
  uid: string;
  name: string;
  email: string;
  role: AppUser["role"];
  cohorts: Cohort[];
  enrollments: Enrollment[];
  avgProgress: number;        // mean progressPct across enrollments
  completedCount: number;     // enrollments where progressPct >= 100
  enrolledCount: number;
  totalAttempts: number;
  passedAttempts: number;
  bestPostPct: number | null; // best post-assessment %, or null if none
  lastActivityMs: number | null; // latest submittedAt ms
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pct(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

function formatDateMs(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Column order for the roster CSV export. */
const ROSTER_CSV_HEADERS = [
  "name",
  "email",
  "role",
  "cohorts",
  "avg_progress_pct",
  "courses_completed",
  "courses_enrolled",
  "attempts",
  "attempts_passed",
  "best_post_pct",
  "last_activity",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function RosterPage() {
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [cohortMap, setCohortMap] = useState<Map<string, Cohort>>(new Map());
  const [allCohorts, setAllCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [cohortFilter, setCohortFilter] = useState<string>(""); // "" = All

  // ── Load & aggregate ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Parallel full-collection reads — no composite index required
      const [usersSnap, cohortsSnap, enrollmentsSnap, attemptsSnap] =
        await Promise.all([
          getDocs(collection(db, "users")),
          getDocs(collection(db, "cohorts")),
          getDocs(collection(db, "enrollments")),
          getDocs(collection(db, "attempts")),
        ]);

      // Build lookup maps
      const cMap = new Map<string, Cohort>();
      const cohortList: Cohort[] = [];
      cohortsSnap.docs.forEach((d) => {
        const cohort = { id: d.id, ...d.data() } as Cohort;
        cMap.set(d.id, cohort);
        cohortList.push(cohort);
      });
      // Sort cohorts alphabetically for the filter dropdown
      cohortList.sort((a, b) => a.name.localeCompare(b.name));
      setCohortMap(cMap);
      setAllCohorts(cohortList);

      // Key enrollments by userId — doc IDs are `${userId}_${courseId}` but
      // each enrollment doc also carries a userId field. We bucket by userId.
      const enrollmentsByUser = new Map<string, Enrollment[]>();
      enrollmentsSnap.docs.forEach((d) => {
        const enr = d.data() as Enrollment;
        // Defensive: derive userId from field first, then fall back to doc-id prefix
        const uid =
          enr.userId ||
          (d.id.includes("_") ? d.id.split("_")[0] : null);
        if (!uid) return;
        if (!enrollmentsByUser.has(uid)) enrollmentsByUser.set(uid, []);
        enrollmentsByUser.get(uid)!.push(enr);
      });

      // Key attempts by userId
      const attemptsByUser = new Map<string, Attempt[]>();
      attemptsSnap.docs.forEach((d) => {
        const attempt = d.data() as Attempt;
        if (!attempt.userId) return;
        if (!attemptsByUser.has(attempt.userId))
          attemptsByUser.set(attempt.userId, []);
        attemptsByUser.get(attempt.userId)!.push(attempt);
      });

      // Build roster rows
      const rosterRows: RosterRow[] = usersSnap.docs.map((d) => {
        const data = d.data() as AppUser;
        const uid = d.id;
        const cohortIds: string[] = Array.isArray(data.cohortIds)
          ? data.cohortIds
          : [];

        const userCohorts = cohortIds
          .map((id) => cMap.get(id))
          .filter((c): c is Cohort => c !== undefined);

        const userEnrollments = enrollmentsByUser.get(uid) ?? [];
        const enrolledCount = userEnrollments.length;
        const completedCount = userEnrollments.filter(
          (e) => (e.progressPct ?? 0) >= 100
        ).length;
        const avgProgress =
          enrolledCount > 0
            ? Math.round(
                userEnrollments.reduce((s, e) => s + (e.progressPct ?? 0), 0) /
                  enrolledCount
              )
            : 0;

        const userAttempts = attemptsByUser.get(uid) ?? [];
        const totalAttempts = userAttempts.length;
        const passedAttempts = userAttempts.filter((a) => a.passed).length;

        const postAttempts = userAttempts.filter(
          (a) => a.kind === "post" && a.total > 0
        );
        const bestPostPct =
          postAttempts.length > 0
            ? Math.max(...postAttempts.map((a) => pct(a.score, a.total)))
            : null;

        const lastActivityMs =
          userAttempts.length > 0
            ? Math.max(
                ...userAttempts.map(
                  (a) => a.submittedAt?.toDate?.()?.getTime() ?? 0
                )
              ) || null
            : null;

        return {
          uid,
          name: data.name ?? "",
          email: data.email ?? "",
          role: data.role ?? "learner",
          cohorts: userCohorts,
          enrollments: userEnrollments,
          avgProgress,
          completedCount,
          enrolledCount,
          totalAttempts,
          passedAttempts,
          bestPostPct,
          lastActivityMs,
        };
      });

      // Sort: admins first, then by name
      rosterRows.sort((a, b) => {
        if (a.role === "admin" && b.role !== "admin") return -1;
        if (b.role === "admin" && a.role !== "admin") return 1;
        return (a.name || a.email).localeCompare(b.name || b.email);
      });

      setRows(rosterRows);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load roster data"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const matchesSearch =
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q);
      const matchesCohort =
        !cohortFilter ||
        r.cohorts.some((c) => c.id === cohortFilter);
      return matchesSearch && matchesCohort;
    });
  }, [rows, search, cohortFilter]);

  // ── CSV Export ──────────────────────────────────────────────────────────────
  // Rows mirror ROSTER_CSV_HEADERS; built from the filtered view so the export
  // respects the active search/cohort filter. Quoting + injection-guarding is
  // handled centrally by src/lib/csvExport.ts.
  const csvRows = useMemo<CsvField[][]>(
    () =>
      filtered.map((r) => [
        r.name,
        r.email,
        r.role,
        r.cohorts.map((c) => c.name).join("; "),
        r.avgProgress,
        r.completedCount,
        r.enrolledCount,
        r.totalAttempts,
        r.passedAttempts,
        r.bestPostPct,
        r.lastActivityMs !== null
          ? new Date(r.lastActivityMs).toISOString().slice(0, 10)
          : null,
      ]),
    [filtered]
  );
  const csvFilename = `roster-${new Date().toISOString().slice(0, 10)}.csv`;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <AdminShell>
      {/* ── Page hero ──────────────────────────────────────────────────────── */}
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <span className="kicker">ADMIN · ROSTER</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Learner Roster
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Aggregated progress, assessments, and last activity across all
            learners.
          </p>
        </div>
        {/* Search + cohort filter */}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <input
            className="input-field sm:w-56"
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="input-field sm:w-44"
            value={cohortFilter}
            onChange={(e) => setCohortFilter(e.target.value)}
            aria-label="Filter by cohort"
          >
            <option value="">All cohorts</option>
            {allCohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <DownloadCsvButton
            filename={csvFilename}
            headers={ROSTER_CSV_HEADERS}
            rows={csvRows}
            loading={loading}
            emptyReason="No learners match the current filter — nothing to export."
            className="!py-2"
          />
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-brand-muted">
          <div
            className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-accent"
          />
          <p>No learners found{search || cohortFilter ? " for this filter" : ""}.</p>
        </div>
      ) : (
        <>
          {/* ── Table ────────────────────────────────────────────────────── */}
          <div className="card p-0 overflow-hidden">
            {/* Horizontal scroll wrapper for narrow viewports */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr
                    style={{
                      borderBottom: "2px solid #DDE6DF",
                      backgroundColor: "#F2F8EC",
                    }}
                  >
                    <th
                      className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wide text-brand-muted"
                    >
                      Learner
                    </th>
                    <th
                      className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide text-brand-muted"
                    >
                      Cohorts
                    </th>
                    <th
                      className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide"
                      style={{ color: "#5E6E69", minWidth: "160px" }}
                    >
                      Progress
                    </th>
                    <th
                      className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide text-brand-muted"
                    >
                      Assessments
                    </th>
                    <th
                      className="text-left px-3 py-3 font-semibold text-xs uppercase tracking-wide text-brand-muted"
                    >
                      Last Activity
                    </th>
                    <th className="px-4 py-3 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, idx) => (
                    <tr
                      key={r.uid}
                      style={{
                        borderBottom:
                          idx < filtered.length - 1
                            ? "1px solid #EEF3EE"
                            : "none",
                        backgroundColor: idx % 2 === 1 ? "#FAFCF9" : "white",
                      }}
                    >
                      {/* ── Learner: name + email + role badge ── */}
                      <td className="px-4 py-3 max-w-[200px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="font-medium truncate text-brand-ink"
                            title={r.name || r.email}
                          >
                            {r.name || r.email}
                          </span>
                          <Badge
                            label={r.role}
                            variant={r.role === "admin" ? "success" : "default"}
                          />
                        </div>
                        <p
                          className="text-xs truncate mt-0.5 text-brand-muted"
                          title={r.email}
                        >
                          {r.email}
                        </p>
                      </td>

                      {/* ── Cohort chips ── */}
                      <td className="px-3 py-3 max-w-[180px]">
                        {r.cohorts.length === 0 ? (
                          <span className="text-xs text-brand-muted">
                            —
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {r.cohorts.map((c) => (
                              <span
                                key={c.id}
                                className="px-2 py-0.5 rounded-full text-xs font-medium text-white whitespace-nowrap"
                                style={{
                                  backgroundColor: c.color || "#2C7A6B",
                                }}
                              >
                                {c.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* ── Progress: bar + % + completed/total ── */}
                      <td className="px-3 py-3" style={{ minWidth: "180px" }}>
                        {r.enrolledCount === 0 ? (
                          <span className="text-xs text-brand-muted">
                            No enrollments
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <div className="flex-1">
                                <ProgressBar pct={r.avgProgress} />
                              </div>
                              <span
                                className="text-xs font-semibold tabular-nums w-10 text-right flex-shrink-0 text-brand-primary"
                              >
                                {r.avgProgress}%
                              </span>
                            </div>
                            <p className="text-xs text-brand-muted">
                              {r.completedCount}/{r.enrolledCount} completed
                            </p>
                          </div>
                        )}
                      </td>

                      {/* ── Assessments: attempts · passed + best post pill ── */}
                      <td className="px-3 py-3">
                        {r.totalAttempts === 0 ? (
                          <span
                            className="text-xs text-brand-muted"
                            aria-label="No attempts"
                          >
                            —
                          </span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span
                              className="text-xs tabular-nums text-brand-ink"
                            >
                              {r.totalAttempts} attempt
                              {r.totalAttempts !== 1 ? "s" : ""} ·{" "}
                              {r.passedAttempts} passed
                            </span>
                            {r.bestPostPct !== null && (
                              <span
                                className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums w-fit bg-brand-mint text-brand-primary"
                              >
                                Best post: {r.bestPostPct}%
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* ── Last activity ── */}
                      <td
                        className="px-3 py-3 text-xs tabular-nums whitespace-nowrap text-brand-muted"
                      >
                        {formatDateMs(r.lastActivityMs)}
                      </td>

                      {/* ── View link ── */}
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/users/${r.uid}`}
                          className="btn-secondary text-xs whitespace-nowrap"
                        >
                          View &rarr;
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Footer: count + export ── */}
            <div
              className="flex items-center justify-between px-4 py-3 border-t text-xs"
              style={{ borderColor: "#DDE6DF", backgroundColor: "#F2F8EC" }}
            >
              <span className="text-brand-muted">
                {filtered.length === rows.length
                  ? `${rows.length} learner${rows.length !== 1 ? "s" : ""}`
                  : `${filtered.length} of ${rows.length} learners`}
              </span>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}
