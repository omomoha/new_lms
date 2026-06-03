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

export default function LearnDashboard() {
  const { appUser } = useAuth();
  const [courses, setCourses] = useState<Array<Course & { progressPct: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appUser) return;
    (async () => {
      setLoading(true);
      try {
        // Firestore rules are NOT filters: learners may only run queries whose
        // constraints provably satisfy the rules. So query published courses
        // assigned to the learner's cohorts directly.
        if (!appUser.cohortIds || appUser.cohortIds.length === 0) {
          setCourses([]);
          return;
        }
        const courseSnap = await getDocs(
          query(
            collection(db, "courses"),
            where("status", "==", "published"),
            // array-contains-any supports at most 10 values
            where("assignedCohortIds", "array-contains-any", appUser.cohortIds.slice(0, 10))
          )
        );
        const enrolled = courseSnap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Course)
        );

        // Fetch enrollments for progress
        const withProgress = await Promise.all(
          enrolled.map(async (c) => {
            const enrollId = `${appUser.uid}_${c.id}`;
            const enrollSnap = await getDoc(doc(db, "enrollments", enrollId));
            const enrollment = enrollSnap.exists()
              ? (enrollSnap.data() as Enrollment)
              : null;
            return { ...c, progressPct: enrollment?.progressPct ?? 0 };
          })
        );
        setCourses(withProgress);
      } finally {
        setLoading(false);
      }
    })();
  }, [appUser]);

  return (
    <LearnerShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Learner hero band */}
        <div className="page-hero mb-6">
          <span className="kicker">MY LEARNING</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Welcome back{appUser?.name ? `, ${appUser.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "#CFE0D5" }}>Continue your learning journey</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : courses.length === 0 ? (
          <div className="text-center py-20" style={{ color: "#5E6E69" }}>
            <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4" style={{ backgroundColor: "#8FB85C" }} />
            <p>No courses assigned yet. Check back soon.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {courses.map((c) => (
              <Link
                key={c.id}
                href={`/learn/course/${c.id}`}
                className="card hover:shadow-md transition-shadow group overflow-hidden !p-0"
              >
                {/* Ink → teal gradient thumbnail */}
                <div
                  className="w-full h-28 rounded-t-xl flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, #13403A 0%, #2C7A6B 100%)" }}
                >
                  <div className="w-10 h-10 rounded-sm rotate-45 opacity-30" style={{ backgroundColor: "#8FB85C" }} />
                </div>
                <div className="px-4 sm:px-5 pb-4 pt-3">
                  <h2 className="font-medium mb-1 line-clamp-2 group-hover:text-brand-teal transition-colors" style={{ color: "#1E302C" }}>
                    {c.title}
                  </h2>
                  {c.description && (
                    <p className="text-sm line-clamp-2 mb-3" style={{ color: "#5E6E69" }}>{c.description}</p>
                  )}
                  <div>
                    <div className="flex justify-between text-xs mb-1" style={{ color: "#5E6E69" }}>
                      <span>Progress</span>
                      <span style={{ color: "#2C7A6B", fontWeight: 600 }}>{c.progressPct}%</span>
                    </div>
                    <ProgressBar pct={c.progressPct} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </LearnerShell>
  );
}
