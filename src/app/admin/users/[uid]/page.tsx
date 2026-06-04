"use client";

/**
 * Individual Learner Analytics — Admin
 *
 * Displays a full analytics profile for a single learner:
 *  - Hero header: name, email, role badge, cohort chips, KPI mini-cards.
 *  - Per-course enrollment progress rows with status badges.
 *  - Assessment attempts list (queried by userId only — single-field, no composite index),
 *    sorted client-side by submittedAt desc.
 *  - Pre→post score lift highlight per course (moss color).
 *
 * Firestore strategy: NO composite indexes used.
 *  - User doc: single getDoc.
 *  - Cohorts: full getDocs (small collection, admin access).
 *  - Courses: getDocs then filter client-side (avoids where+orderBy composite).
 *  - Enrollments: batched getDoc per `${uid}_${courseId}` — direct doc reads, no query.
 *  - Attempts: query where("userId","==",uid) only (single-field index, always exists),
 *    sort client-side.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { AppUser, Cohort, Course, Enrollment, Attempt } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CourseRow {
  courseId: string;
  title: string;
  progressPct: number;
  status: "not-started" | "in-progress" | "completed";
  completedAtLabel: string | null;
}

interface AttemptRow extends Attempt {
  id: string;
  courseTitle: string;
}

interface LiftRow {
  courseId: string;
  courseTitle: string;
  preScore: number;
  preTotal: number;
  postScore: number;
  postTotal: number;
  liftPct: number; // postPct - prePct
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(ts: { toDate?: () => Date } | null | undefined): string {
  if (!ts || typeof ts.toDate !== "function") return "—";
  return ts.toDate().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function pct(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LearnerAnalyticsPage() {
  const params = useParams();
  const router = useRouter();
  const uid = params.uid as string;

  const [user, setUser] = useState<AppUser | null>(null);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [courseRows, setCourseRows] = useState<CourseRow[]>([]);
  const [attemptRows, setAttemptRows] = useState<AttemptRow[]>([]);
  const [lifts, setLifts] = useState<LiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // KPIs
  const [kpiCoursesAssigned, setKpiCoursesAssigned] = useState(0);
  const [kpiAvgProgress, setKpiAvgProgress] = useState(0);
  const [kpiAttempts, setKpiAttempts] = useState(0);
  const [kpiBestPost, setKpiBestPost] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Load user doc
      const userSnap = await getDoc(doc(db, "users", uid));
      if (!userSnap.exists()) {
        router.push("/admin/users");
        return;
      }
      const userData = userSnap.data() as AppUser;
      const appUser: AppUser = {
        ...userData,
        uid: userSnap.id,
        cohortIds: Array.isArray(userData.cohortIds) ? userData.cohortIds : [],
      };
      setUser(appUser);

      // 2. Load all cohorts (to label chips)
      const cohortsSnap = await getDocs(collection(db, "cohorts"));
      const allCohorts = cohortsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cohort));
      setCohorts(allCohorts);

      // 3. Determine assigned courses: union of courses from all the user's cohorts.
      //    Each cohort has a courseIds array. Dedupe by courseId.
      //    We fetch all courses (admin) and filter client-side — no composite index needed.
      const coursesSnap = await getDocs(collection(db, "courses"));
      const allCourses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Course));

      const userCohortIds = appUser.cohortIds;
      const userCohorts = allCohorts.filter((c) => userCohortIds.includes(c.id));
      const assignedCourseIdSet = new Set<string>(
        userCohorts.flatMap((c) => (Array.isArray(c.courseIds) ? c.courseIds : []))
      );
      const assignedCourses = allCourses.filter((c) => assignedCourseIdSet.has(c.id));

      // 4. Fetch enrollments via direct getDoc for each assigned course
      const enrollmentResults = await Promise.all(
        assignedCourses.map((c) =>
          getDoc(doc(db, "enrollments", `${uid}_${c.id}`)).then((snap) => ({
            courseId: c.id,
            enrollment: snap.exists() ? (snap.data() as Enrollment) : null,
          }))
        )
      );

      // Build course rows
      const rows: CourseRow[] = assignedCourses.map((c) => {
        const res = enrollmentResults.find((r) => r.courseId === c.id);
        const enr = res?.enrollment ?? null;
        const progressPct = enr ? (enr.progressPct ?? 0) : 0;
        let status: CourseRow["status"] = "not-started";
        if (progressPct >= 100) status = "completed";
        else if (progressPct > 0) status = "in-progress";
        return {
          courseId: c.id,
          title: c.title,
          progressPct,
          status,
          completedAtLabel: progressPct >= 100 ? formatDate(enr?.updatedAt) : null,
        };
      });
      // Sort: completed last, then by progress desc
      rows.sort((a, b) => {
        if (a.status === "completed" && b.status !== "completed") return 1;
        if (b.status === "completed" && a.status !== "completed") return -1;
        return b.progressPct - a.progressPct;
      });
      setCourseRows(rows);

      // KPI: courses assigned, avg progress
      setKpiCoursesAssigned(assignedCourses.length);
      const avgProgress =
        rows.length > 0
          ? Math.round(rows.reduce((s, r) => s + r.progressPct, 0) / rows.length)
          : 0;
      setKpiAvgProgress(avgProgress);

      // 5. Fetch attempts — single-field where("userId","==",uid), no composite index
      const attemptsSnap = await getDocs(
        query(collection(db, "attempts"), where("userId", "==", uid))
      );

      // Build course title lookup map
      const courseTitleMap = new Map(allCourses.map((c) => [c.id, c.title]));

      const rawAttempts: AttemptRow[] = attemptsSnap.docs.map((d) => {
        const data = d.data() as Attempt;
        return {
          ...data,
          id: d.id,
          courseTitle: courseTitleMap.get(data.courseId) ?? data.courseId,
        };
      });
      // Sort client-side: most recent first
      rawAttempts.sort((a, b) => {
        const aMs = a.submittedAt?.toDate?.()?.getTime() ?? 0;
        const bMs = b.submittedAt?.toDate?.()?.getTime() ?? 0;
        return bMs - aMs;
      });
      setAttemptRows(rawAttempts);

      // KPI: attempt count, best post score
      setKpiAttempts(rawAttempts.length);
      const postAttempts = rawAttempts.filter((a) => a.kind === "post" && a.total > 0);
      const bestPost =
        postAttempts.length > 0
          ? Math.max(...postAttempts.map((a) => pct(a.score, a.total)))
          : null;
      setKpiBestPost(bestPost);

      // 6. Compute pre→post lift per course
      const liftRows: LiftRow[] = [];
      const courseIdsWithBoth = new Set(
        rawAttempts
          .filter((a) => a.kind === "pre")
          .map((a) => a.courseId)
          .filter((cId) => rawAttempts.some((a) => a.kind === "post" && a.courseId === cId))
      );
      courseIdsWithBoth.forEach((cId) => {
        // Best pre and best post per course
        const pres = rawAttempts.filter((a) => a.kind === "pre" && a.courseId === cId);
        const posts = rawAttempts.filter((a) => a.kind === "post" && a.courseId === cId);
        if (pres.length === 0 || posts.length === 0) return;
        const bestPre = pres.reduce((best, a) =>
          pct(a.score, a.total) > pct(best.score, best.total) ? a : best
        );
        const bestPostRow = posts.reduce((best, a) =>
          pct(a.score, a.total) > pct(best.score, best.total) ? a : best
        );
        liftRows.push({
          courseId: cId,
          courseTitle: courseTitleMap.get(cId) ?? cId,
          preScore: bestPre.score,
          preTotal: bestPre.total,
          postScore: bestPostRow.score,
          postTotal: bestPostRow.total,
          liftPct: pct(bestPostRow.score, bestPostRow.total) - pct(bestPre.score, bestPre.total),
        });
      });
      liftRows.sort((a, b) => b.liftPct - a.liftPct);
      setLifts(liftRows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load learner analytics");
    } finally {
      setLoading(false);
    }
  }, [uid, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <AdminShell>
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </AdminShell>
    );
  }

  if (!user) return null;

  const userCohortList = cohorts.filter((c) => user.cohortIds.includes(c.id));

  // ── KPI cards data ───────────────────────────────────────────────────────────
  const kpiCards = [
    { label: "Courses", value: kpiCoursesAssigned.toString() },
    { label: "Avg Progress", value: `${kpiAvgProgress}%` },
    { label: "Attempts", value: kpiAttempts.toString() },
    { label: "Best Post", value: kpiBestPost !== null ? `${kpiBestPost}%` : "—" },
  ];

  return (
    <AdminShell>
      {/* ── Page hero ──────────────────────────────────────────────────────── */}
      <div className="page-hero mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <span className="kicker">ADMIN · USERS · LEARNER</span>
            <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight truncate">
              {user.name || user.email}
            </h1>
            <p className="mt-1 text-sm flex items-center gap-2 flex-wrap" style={{ color: "#CFE0D5" }}>
              <span>{user.email}</span>
              <Badge
                label={user.role}
                variant={user.role === "admin" ? "success" : "default"}
              />
            </p>
            {/* Cohort chips */}
            {userCohortList.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {userCohortList.map((c) => (
                  <span
                    key={c.id}
                    className="px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: c.color || "#2C7A6B" }}
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            )}
            {/* KPI mini-cards */}
            <div className="flex flex-wrap gap-3 mt-4">
              {kpiCards.map((k) => (
                <div
                  key={k.label}
                  className="rounded-lg px-4 py-2 flex flex-col"
                  style={{ backgroundColor: "rgba(255,255,255,0.12)", minWidth: "80px" }}
                >
                  <span className="font-serif-brand text-2xl font-semibold text-white leading-none">
                    {k.value}
                  </span>
                  <span className="text-xs mt-0.5" style={{ color: "#CFE0D5" }}>
                    {k.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => router.push("/admin/users")}
            className="btn-secondary text-xs self-start flex-shrink-0"
            style={{ color: "white", borderColor: "rgba(255,255,255,0.3)" }}
          >
            &larr; All Users
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Course progress card ─────────────────────────────────────────────── */}
      <div className="card mb-4">
        <h2 className="font-medium mb-4" style={{ color: "#1E302C" }}>
          Course progress
        </h2>
        {courseRows.length === 0 ? (
          <p className="text-sm py-2" style={{ color: "#5E6E69" }}>
            No courses assigned to this learner&apos;s cohorts yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {courseRows.map((row) => {
              const statusBadge =
                row.status === "completed"
                  ? { label: `Completed at 100%`, variant: "success" as const }
                  : row.status === "in-progress"
                  ? { label: "In progress", variant: "warning" as const }
                  : { label: "Not started", variant: "default" as const };
              return (
                <div key={row.courseId} className="flex items-center gap-3">
                  <span
                    className="text-xs font-medium w-36 flex-shrink-0 truncate"
                    style={{ color: "#1E302C" }}
                    title={row.title}
                  >
                    {row.title}
                  </span>
                  {/* Progress bar track */}
                  <div
                    className="flex-1 rounded-sm relative"
                    style={{ height: "18px", backgroundColor: "#E7F1DE" }}
                  >
                    <div
                      className="absolute top-0 left-0 h-full rounded-sm transition-all"
                      style={{
                        width: `${row.progressPct}%`,
                        backgroundColor: row.status === "completed" ? "#8FB85C" : "#2C7A6B",
                      }}
                    />
                  </div>
                  <span
                    className="text-xs font-semibold w-10 flex-shrink-0 text-right tabular-nums"
                    style={{ color: "#13403A" }}
                  >
                    {row.progressPct}%
                  </span>
                  <div className="flex-shrink-0 w-36 text-right">
                    <Badge label={statusBadge.label} variant={statusBadge.variant} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Pre→post lift card ───────────────────────────────────────────────── */}
      {lifts.length > 0 && (
        <div className="card mb-4">
          <h2 className="font-medium mb-4" style={{ color: "#1E302C" }}>
            Assessment lift{" "}
            <span className="text-xs font-normal ml-1" style={{ color: "#5E6E69" }}>
              pre → post per course
            </span>
          </h2>
          <div className="flex flex-col gap-2">
            {lifts.map((lr) => {
              const prePct = pct(lr.preScore, lr.preTotal);
              const postPct = pct(lr.postScore, lr.postTotal);
              const positive = lr.liftPct >= 0;
              return (
                <div
                  key={lr.courseId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{ backgroundColor: "#F2F8EC", border: "1px solid #D4E8C0" }}
                >
                  <span
                    className="text-xs font-medium flex-1 min-w-0 truncate"
                    style={{ color: "#1E302C" }}
                    title={lr.courseTitle}
                  >
                    {lr.courseTitle}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: "#5E6E69" }}>
                    Pre: {prePct}%
                  </span>
                  <span className="text-xs" style={{ color: "#9EB3AD" }}>→</span>
                  <span className="text-xs tabular-nums" style={{ color: "#5E6E69" }}>
                    Post: {postPct}%
                  </span>
                  <span
                    className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: positive ? "#8FB85C" : "#FEE2E2",
                      color: positive ? "white" : "#991B1B",
                    }}
                  >
                    {positive ? "+" : ""}{lr.liftPct}pp
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Attempts card ────────────────────────────────────────────────────── */}
      <div className="card mb-4">
        <h2 className="font-medium mb-4" style={{ color: "#1E302C" }}>
          Assessment attempts
          <span
            className="ml-2 px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ backgroundColor: "#E7F1DE", color: "#13403A" }}
          >
            {attemptRows.length}
          </span>
        </h2>
        {attemptRows.length === 0 ? (
          <p className="text-sm py-2" style={{ color: "#5E6E69" }}>
            No assessment attempts recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: "1px solid #DDE6DF" }}>
                  <th className="text-left pb-2 font-semibold pr-3" style={{ color: "#5E6E69" }}>Course</th>
                  <th className="text-left pb-2 font-semibold pr-3" style={{ color: "#5E6E69" }}>Kind</th>
                  <th className="text-right pb-2 font-semibold pr-3" style={{ color: "#5E6E69" }}>Score</th>
                  <th className="text-center pb-2 font-semibold pr-3" style={{ color: "#5E6E69" }}>Pass</th>
                  <th className="text-right pb-2 font-semibold" style={{ color: "#5E6E69" }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {attemptRows.map((a) => {
                  const scorePct = pct(a.score, a.total);
                  const kindVariant =
                    a.kind === "pre"
                      ? "default"
                      : a.kind === "post"
                      ? "success"
                      : "warning";
                  return (
                    <tr key={a.id} style={{ borderBottom: "1px solid #F0F4F1" }}>
                      <td className="py-2 pr-3 truncate max-w-[160px]" style={{ color: "#1E302C" }}>
                        {a.courseTitle}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge label={a.kind} variant={kindVariant} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={{ color: "#13403A" }}>
                        {a.score}/{a.total}{" "}
                        <span className="font-normal" style={{ color: "#5E6E69" }}>
                          ({scorePct}%)
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-center">
                        {a.passed ? (
                          <span style={{ color: "#8FB85C" }} aria-label="passed">&#10003;</span>
                        ) : (
                          <span style={{ color: "#C9772F" }} aria-label="failed">&#10007;</span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums" style={{ color: "#5E6E69" }}>
                        {formatDate(a.submittedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
