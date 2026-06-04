"use client";

/**
 * Admin KPI Dashboard
 *
 * Uses firebase/firestore v10 getCountFromServer for all aggregate counts.
 * Bar charts are pure CSS (divs) — no chart library.
 */

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  getCountFromServer,
  getDocs,
  orderBy,
  limit,
  Timestamp,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiStats {
  totalUsers: number | null;
  totalLearners: number | null;
  totalCohorts: number | null;
  totalCourses: number | null;
  publishedCourses: number | null;
  totalAttempts: number | null;
}

interface DayCount {
  label: string; // e.g. "Mon"
  date: string;  // e.g. "Jun 2"
  count: number;
}

interface CourseCompletion {
  courseId: string;
  title: string;
  completed: number;
  enrolled: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dayStart(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

function dayEnd(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [kpi, setKpi] = useState<KpiStats | null>(null);
  const [signups, setSignups] = useState<DayCount[]>([]);
  const [completions, setCompletions] = useState<CourseCompletion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // ── KPI aggregates ────────────────────────────────────────────────────
        const [
          usersResult,
          learnersResult,
          cohortsResult,
          coursesResult,
          publishedResult,
          attemptsResult,
        ] = await Promise.allSettled([
          getCountFromServer(collection(db, "users")),
          getCountFromServer(
            query(collection(db, "users"), where("role", "==", "learner"))
          ),
          getCountFromServer(collection(db, "cohorts")),
          getCountFromServer(collection(db, "courses")),
          getCountFromServer(
            query(collection(db, "courses"), where("status", "==", "published"))
          ),
          getCountFromServer(collection(db, "attempts")),
        ]);

        const countOrNull = (r: PromiseSettledResult<{ data(): { count: number } }>) =>
          r.status === "fulfilled" ? r.value.data().count : null;

        setKpi({
          totalUsers: countOrNull(usersResult),
          totalLearners: countOrNull(learnersResult),
          totalCohorts: countOrNull(cohortsResult),
          totalCourses: countOrNull(coursesResult),
          publishedCourses: countOrNull(publishedResult),
          totalAttempts: countOrNull(attemptsResult),
        });

        // ── Sign-ups last 7 days ──────────────────────────────────────────────
        const today = new Date();
        const dayCounts: DayCount[] = [];

        // Run 7 count queries in parallel — one per day
        const dayPromises = Array.from({ length: 7 }, (_, i) => {
          const offset = 6 - i; // 0 = today, 6 = 6 days ago
          const d = new Date(today);
          d.setDate(today.getDate() - offset);
          return getCountFromServer(
            query(
              collection(db, "users"),
              where("createdAt", ">=", Timestamp.fromDate(dayStart(d))),
              where("createdAt", "<=", Timestamp.fromDate(dayEnd(d)))
            )
          ).then((snap) => ({
            label: DAY_LABELS[d.getDay()],
            date: shortDate(d),
            count: snap.data().count,
          }));
        });

        const resolved = await Promise.all(dayPromises);
        setSignups(resolved);

        // ── Completions by course (top 10) ────────────────────────────────────
        const coursesQ = query(
          collection(db, "courses"),
          orderBy("createdAt", "desc"),
          limit(10)
        );
        const courseDocs = await getDocs(coursesQ);

        const completionPromises = courseDocs.docs.map(async (d) => {
          const data = d.data() as { title: string };
          const [enrolledSnap, completedSnap] = await Promise.all([
            getCountFromServer(
              query(collection(db, "enrollments"), where("courseId", "==", d.id))
            ),
            getCountFromServer(
              query(
                collection(db, "enrollments"),
                where("courseId", "==", d.id),
                where("progressPct", ">=", 100)
              )
            ),
          ]);
          return {
            courseId: d.id,
            title: data.title,
            enrolled: enrolledSnap.data().count,
            completed: completedSnap.data().count,
          };
        });

        const courseCompletions = await Promise.all(completionPromises);
        // Filter to courses with at least 1 enrollment so chart is meaningful
        setCompletions(courseCompletions.filter((c) => c.enrolled > 0));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Chart helpers ───────────────────────────────────────────────────────────

  const signupMax = Math.max(...signups.map((d) => d.count), 1);
  const completionMax = Math.max(...completions.map((c) => c.enrolled), 1);

  return (
    <AdminShell>
      {/* Page hero */}
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex-1">
          <span className="kicker">ADMIN · OVERVIEW</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Dashboard
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#CFE0D5" }}>
            Live platform metrics — counts sourced from Firestore aggregates.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      )}

      {error && (
        <div
          className="rounded-lg p-4 text-sm mb-6"
          style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}
        >
          {error}
        </div>
      )}

      {!loading && kpi && (
        <>
          {/* ── KPI stat cards ──────────────────────────────────────────────── */}
          <section className="mb-8">
            <h2
              className="text-xs font-semibold uppercase tracking-widest mb-4"
              style={{ color: "#5E6E69" }}
            >
              Platform totals
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: "Total Users", value: kpi.totalUsers },
                { label: "Learners", value: kpi.totalLearners },
                { label: "Cohorts", value: kpi.totalCohorts },
                { label: "Courses", value: kpi.totalCourses },
                { label: "Published", value: kpi.publishedCourses },
                { label: "Attempts", value: kpi.totalAttempts },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="card !p-0 overflow-hidden flex flex-col"
                >
                  {/* Moss top rule */}
                  <div
                    className="h-1 w-full flex-shrink-0"
                    style={{ backgroundColor: "#8FB85C" }}
                  />
                  <div className="px-4 py-4 flex flex-col gap-1">
                    <span
                      className="font-serif-brand text-3xl font-semibold leading-none"
                      style={{ color: "#13403A" }}
                    >
                      {value !== null ? value.toLocaleString() : "—"}
                    </span>
                    <span
                      className="text-xs font-medium uppercase tracking-wide"
                      style={{ color: "#5E6E69" }}
                    >
                      {label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Sign-ups last 7 days ─────────────────────────────────────────── */}
          <section className="mb-8">
            <div className="card">
              <h2
                className="text-sm font-semibold mb-5"
                style={{ color: "#1E302C" }}
              >
                Sign-ups — last 7 days
              </h2>
              {/* CSS bar chart */}
              <div className="flex items-end gap-2 h-36">
                {signups.map((d) => {
                  const heightPct = signupMax > 0 ? (d.count / signupMax) * 100 : 0;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end"
                    >
                      {/* count label above bar */}
                      <span
                        className="text-xs font-semibold"
                        style={{ color: "#13403A" }}
                      >
                        {d.count}
                      </span>
                      {/* track */}
                      <div
                        className="w-full rounded-sm relative"
                        style={{
                          backgroundColor: "#E7F1DE",
                          height: "80px",
                        }}
                      >
                        {/* fill */}
                        <div
                          className="absolute bottom-0 left-0 right-0 rounded-sm transition-all"
                          style={{
                            height: `${heightPct}%`,
                            backgroundColor: "#13403A",
                          }}
                        />
                      </div>
                      {/* day label */}
                      <span
                        className="text-xs font-medium"
                        style={{ color: "#5E6E69" }}
                      >
                        {d.label}
                      </span>
                      <span
                        className="text-xs hidden sm:block"
                        style={{ color: "#5E6E69", fontSize: "10px" }}
                      >
                        {d.date}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ── Completions by course ────────────────────────────────────────── */}
          <section className="mb-8">
            <div className="card">
              <h2
                className="text-sm font-semibold mb-5"
                style={{ color: "#1E302C" }}
              >
                Completions by course{" "}
                <span
                  className="text-xs font-normal ml-1"
                  style={{ color: "#5E6E69" }}
                >
                  (top 10 by creation date, courses with enrollments)
                </span>
              </h2>

              {completions.length === 0 ? (
                <p className="text-sm" style={{ color: "#5E6E69" }}>
                  No enrollments recorded yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {completions.map((c) => {
                    const enrolledPct =
                      completionMax > 0
                        ? (c.enrolled / completionMax) * 100
                        : 0;
                    const completedPct =
                      c.enrolled > 0
                        ? (c.completed / c.enrolled) * 100
                        : 0;
                    return (
                      <div key={c.courseId} className="flex items-center gap-3">
                        {/* Course title */}
                        <span
                          className="text-xs font-medium w-36 flex-shrink-0 truncate"
                          style={{ color: "#1E302C" }}
                          title={c.title}
                        >
                          {c.title}
                        </span>
                        {/* Horizontal bar track */}
                        <div
                          className="flex-1 rounded-sm relative"
                          style={{ height: "18px", backgroundColor: "#E7F1DE" }}
                        >
                          {/* enrolled bar (mint) */}
                          <div
                            className="absolute top-0 left-0 h-full rounded-sm"
                            style={{
                              width: `${enrolledPct}%`,
                              backgroundColor: "#E7F1DE",
                              border: "1px solid #8FB85C",
                            }}
                          />
                          {/* completed bar (teal fill) */}
                          <div
                            className="absolute top-0 left-0 h-full rounded-sm"
                            style={{
                              width: `${(enrolledPct * completedPct) / 100}%`,
                              backgroundColor: "#13403A",
                            }}
                          />
                        </div>
                        {/* stats */}
                        <span
                          className="text-xs w-24 flex-shrink-0 text-right tabular-nums"
                          style={{ color: "#5E6E69" }}
                        >
                          {c.completed}/{c.enrolled} done
                        </span>
                        <span
                          className="text-xs w-10 flex-shrink-0 text-right tabular-nums font-semibold"
                          style={{ color: "#13403A" }}
                        >
                          {c.enrolled > 0
                            ? Math.round(completedPct) + "%"
                            : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}
