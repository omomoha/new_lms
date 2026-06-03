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
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">
            Welcome back{appUser?.name ? `, ${appUser.name.split(" ")[0]}` : ""}
          </h1>
          <p className="text-sm text-gray-500">Continue your learning journey</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : courses.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-2">🎓</p>
            <p>No courses assigned yet. Check back soon.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {courses.map((c) => (
              <Link
                key={c.id}
                href={`/learn/course/${c.id}`}
                className="card hover:shadow-md transition-shadow group"
              >
                {/* Course thumbnail placeholder */}
                <div className="w-full h-32 bg-gradient-to-br from-brand-primary to-brand-dark rounded-lg mb-3 flex items-center justify-center">
                  <span className="text-3xl">📖</span>
                </div>
                <h2 className="font-medium text-gray-900 group-hover:text-brand-primary mb-1 line-clamp-2">
                  {c.title}
                </h2>
                {c.description && (
                  <p className="text-sm text-gray-500 line-clamp-2 mb-3">{c.description}</p>
                )}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress</span>
                    <span>{c.progressPct}%</span>
                  </div>
                  <ProgressBar pct={c.progressPct} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </LearnerShell>
  );
}
