"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, getDocs, doc, getDoc, query, where } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import type { Course, Enrollment } from "@/types";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { EntityThumb } from "@/components/ui/Thumb";
import ResumeCard from "@/components/learn/ResumeCard";
import CourseSearch from "@/components/learn/CourseSearch";
import StreakCard from "@/components/learn/StreakCard";
import { pickResumeCourse } from "@/lib/resume";
import { filterCourses } from "@/lib/search";

type CourseWithAccess = Course & {
  progressPct: number;
  hasAccess: boolean;
  updatedAtMillis: number | null;
  lastLessonId: string | null;
};

export default function LearnDashboard() {
  const { appUser } = useAuth();
  const [courses, setCourses] = useState<CourseWithAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!appUser) return;
    (async () => {
      setLoading(true);
      try {
        // Query ALL published courses — rules now allow learners to read any
        // published course doc so this query is valid even with no cohortIds.
        const courseSnap = await getDocs(
          query(
            collection(db, "courses"),
            where("status", "==", "published")
          )
        );
        const allPublished = courseSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Course)
        );

        // Determine access with FRESH cohort membership — appUser is cached at
        // sign-in, and an admin may have assigned cohorts since then. Fall back
        // to the cached value if the fresh read fails.
        let userCohortIds: string[] = Array.isArray(appUser.cohortIds)
          ? appUser.cohortIds
          : [];
        try {
          const meSnap = await getDoc(doc(db, "users", appUser.uid));
          if (meSnap.exists()) {
            const fresh = (meSnap.data() as { cohortIds?: unknown }).cohortIds;
            if (Array.isArray(fresh)) userCohortIds = fresh as string[];
          }
        } catch (err: unknown) {
          // Keep cached membership but leave a trace for debugging —
          // a silently stale list here looks like "missing courses" to users.
          console.warn("LearnDashboard: fresh cohort read failed, using cached:", err);
        }

        // Fetch enrollments for progress (only matters for accessible courses)
        const withAccessAndProgress = await Promise.all(
          allPublished.map(async (c) => {
            const hasAccess =
              (c.assignedCohortIds ?? []).some((id) => userCohortIds.includes(id));

            let progressPct = 0;
            let updatedAtMillis: number | null = null;
            let lastLessonId: string | null = null;
            if (hasAccess) {
              const enrollId = `${appUser.uid}_${c.id}`;
              const enrollSnap = await getDoc(doc(db, "enrollments", enrollId));
              if (enrollSnap.exists()) {
                const enrollment = enrollSnap.data() as Enrollment;
                progressPct = enrollment.progressPct ?? 0;
                lastLessonId = enrollment.lastLessonId ?? null;
                // updatedAt may be missing on legacy docs — guard the call
                updatedAtMillis = enrollment.updatedAt?.toMillis?.() ?? null;
              }
            }

            return { ...c, progressPct, hasAccess, updatedAtMillis, lastLessonId };
          })
        );

        // Sort: accessible first, then locked
        withAccessAndProgress.sort((a, b) => {
          if (a.hasAccess === b.hasAccess) return 0;
          return a.hasAccess ? -1 : 1;
        });

        setCourses(withAccessAndProgress);
      } catch (err: unknown) {
        console.error("LearnDashboard load failed:", err);
        setLoadError(
          err instanceof Error ? err.message : "Failed to load courses"
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [appUser]);

  // Resume CTA: most recently touched in-progress course (pure selection
  // logic lives in src/lib/resume.ts)
  const resume = pickResumeCourse(courses);

  // Search: case/diacritic-insensitive filter over title + description
  const visibleCourses = filterCourses(courses, searchQuery);
  const isSearching = searchQuery.trim().length > 0;

  return (
    <LearnerShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Learner hero band */}
        <div className="page-hero mb-6">
          <span className="kicker">MY LEARNING</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Welcome back{appUser?.name ? `, ${appUser.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-brand-mist">Continue your learning journey</p>
        </div>

        {loadError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {loadError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : courses.length === 0 ? (
          <div className="text-center py-20 text-brand-muted">
            <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-accent" />
            <p>No published courses available yet. Check back soon.</p>
          </div>
        ) : (
          <>
            {/* Streak + weekly goal */}
            {appUser && <StreakCard uid={appUser.uid} />}

            {/* Resume CTA — most recently touched in-progress course */}
            {resume && (
              <ResumeCard
                courseId={resume.course.id}
                title={resume.course.title}
                description={resume.course.description}
                thumbPath={resume.course.thumbPath}
                progressPct={resume.course.progressPct}
                basis={resume.basis}
              />
            )}

            {/* Course search */}
            <CourseSearch onQueryChange={setSearchQuery} />
            <p aria-live="polite" className={isSearching ? "mb-3 text-xs text-brand-muted" : "sr-only"}>
              {isSearching
                ? `${visibleCourses.length} course${visibleCourses.length !== 1 ? "s" : ""} matching "${searchQuery.trim()}"`
                : ""}
            </p>

            {visibleCourses.length === 0 ? (
              <div className="text-center py-16 text-brand-muted">
                <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-mint" />
                <p className="text-sm">No courses match your search. Try a different term.</p>
              </div>
            ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {visibleCourses.map((c) =>
              c.hasAccess ? (
                <Link
                  key={c.id}
                  href={`/learn/course/${c.id}`}
                  className="card hover:shadow-md transition-shadow group overflow-hidden !p-0"
                >
                  {/* Course thumbnail */}
                  <div className="w-full h-28 rounded-t-xl overflow-hidden">
                    <EntityThumb
                      thumbPath={c.thumbPath}
                      seed={c.id}
                      title={c.title}
                      className="w-full h-full"
                    />
                  </div>
                  <div className="px-4 sm:px-5 pb-4 pt-3">
                    <h2 className="font-medium mb-1 line-clamp-2 group-hover:text-brand-teal transition-colors text-brand-ink">
                      {c.title}
                    </h2>
                    {c.description && (
                      <p className="text-sm line-clamp-2 mb-3 text-brand-muted">{c.description}</p>
                    )}
                    <div>
                      <div className="flex justify-between text-xs mb-1 text-brand-muted">
                        <span>Progress</span>
                        <span className="text-brand-teal font-semibold">{c.progressPct}%</span>
                      </div>
                      <ProgressBar pct={c.progressPct} />
                    </div>
                  </div>
                </Link>
              ) : (
                /* Locked course — visible but not a link */
                <div
                  key={c.id}
                  className="card overflow-hidden !p-0 opacity-70"
                  style={{ cursor: "default" }}
                >
                  {/* Locked course thumbnail — grayscale + dimmed */}
                  <div className="w-full h-28 rounded-t-xl overflow-hidden relative">
                    <div className="w-full h-full" style={{ filter: "grayscale(1) opacity(0.55)" }}>
                      <EntityThumb
                        thumbPath={c.thumbPath}
                        seed={c.id}
                        title={c.title}
                        className="w-full h-full"
                      />
                    </div>
                    {/* Padlock badge */}
                    <span
                      className="absolute top-2 right-2 text-base leading-none px-2 py-1 rounded-full font-semibold"
                      style={{ backgroundColor: "rgba(0,0,0,0.35)", color: "#fff", fontSize: "1rem" }}
                      role="img"
                      aria-label="Course locked"
                    >
                      <span aria-hidden="true">🔒</span>
                      <span className="sr-only">Course locked</span>
                    </span>
                  </div>
                  <div className="px-4 sm:px-5 pb-4 pt-3">
                    <h2 className="font-medium mb-1 line-clamp-2 text-brand-muted">
                      {c.title}
                    </h2>
                    {c.description && (
                      <p className="text-sm line-clamp-2 mb-2 text-brand-muted">{c.description}</p>
                    )}
                    <p className="text-xs text-brand-muted">
                      Not in your cohort yet — ask your admin.
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
            )}
          </>
        )}
      </div>
    </LearnerShell>
  );
}
