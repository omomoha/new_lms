"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  doc, getDoc, collection, getDocs, query, orderBy
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import type { Course, CourseModule, Lesson, Enrollment, LessonProgress } from "@/types";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import { ProgressBar } from "@/components/ui/ProgressBar";

export default function CoursePage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;
  const { appUser } = useAuth();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [lessonMap, setLessonMap] = useState<Record<string, Lesson[]>>({});
  const [progressMap, setProgressMap] = useState<Record<string, LessonProgress>>({});
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appUser) return;
    (async () => {
      setLoading(true);
      try {
        const courseSnap = await getDoc(doc(db, "courses", courseId));
        if (!courseSnap.exists()) { router.push("/learn"); return; }
        setCourse(courseSnap.data() as Course);

        const modSnap = await getDocs(
          query(collection(db, "courses", courseId, "modules"), orderBy("order"))
        );
        const mods = modSnap.docs.map((d) => d.data() as CourseModule);
        setModules(mods);

        const lMap: Record<string, Lesson[]> = {};
        for (const mod of mods) {
          const lSnap = await getDocs(
            query(collection(db, "courses", courseId, "modules", mod.id, "lessons"), orderBy("order"))
          );
          lMap[mod.id] = lSnap.docs.map((d) => d.data() as Lesson);
        }
        setLessonMap(lMap);

        // Fetch enrollment
        const enrollSnap = await getDoc(doc(db, "enrollments", `${appUser.uid}_${courseId}`));
        if (enrollSnap.exists()) setEnrollment(enrollSnap.data() as Enrollment);

        // Fetch all lesson progress docs for this user/course
        // (In production, query progress where userId==appUser.uid && courseId==courseId)
        const allLessons = Object.values(lMap).flat();
        const pMap: Record<string, LessonProgress> = {};
        await Promise.all(
          allLessons.map(async (l) => {
            const pSnap = await getDoc(doc(db, "progress", `${appUser.uid}_${l.id}`));
            if (pSnap.exists()) pMap[l.id] = pSnap.data() as LessonProgress;
          })
        );
        setProgressMap(pMap);
      } finally {
        setLoading(false);
      }
    })();
  }, [appUser, courseId, router]);

  if (loading) return (
    <LearnerShell>
      <div className="flex justify-center py-20"><Spinner /></div>
    </LearnerShell>
  );

  if (!course) return null;

  const firstLesson = Object.values(lessonMap).flat()[0];

  return (
    <LearnerShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Course header hero */}
        <div className="page-hero mb-6">
          <Link href="/learn" className="text-xs font-medium hover:underline mb-3 inline-block" style={{ color: "#8FB85C" }}>
            ← My Courses
          </Link>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">{course.title}</h1>
          {course.description && (
            <p className="text-sm mt-1" style={{ color: "#CFE0D5" }}>{course.description}</p>
          )}
          {enrollment && (
            <div className="mt-3 max-w-xs">
              <div className="flex justify-between text-xs mb-1" style={{ color: "#CFE0D5" }}>
                <span>Your progress</span>
                <span>{enrollment.progressPct}%</span>
              </div>
              <ProgressBar pct={enrollment.progressPct} />
            </div>
          )}
        </div>

        {/* Start / Continue button */}
        {firstLesson && (
          <Link
            href={`/learn/course/${courseId}/lesson/${enrollment?.lastLessonId ?? firstLesson.id}`}
            className="btn-primary mb-8 inline-block"
          >
            {enrollment?.lastLessonId ? "Continue Learning" : "Start Course"}
          </Link>
        )}

        {/* Module / Lesson tree */}
        <div className="space-y-4">
          {modules.map((mod) => (
            <div key={mod.id} className="card overflow-hidden !p-0">
              <div className="px-4 sm:px-5 py-3 border-b" style={{ borderColor: "#DDE6DF", backgroundColor: "#F5F7F4" }}>
                <h2 className="font-semibold text-sm" style={{ color: "#13403A" }}>{mod.title}</h2>
              </div>
              <ul className="space-y-0.5 p-3">
                {(lessonMap[mod.id] ?? []).map((lesson) => {
                  const progress = progressMap[lesson.id];
                  const done = !!progress?.completedAt;
                  const isCurrent = enrollment?.lastLessonId === lesson.id;
                  return (
                    <li key={lesson.id}>
                      <Link
                        href={`/learn/course/${courseId}/lesson/${lesson.id}`}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
                        style={
                          isCurrent
                            ? { backgroundColor: "#E7F1DE", color: "#13403A", fontWeight: 500 }
                            : { color: "#1E302C" }
                        }
                      >
                        <span
                          className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                          style={
                            done
                              ? { backgroundColor: "#8FB85C", color: "#fff" }
                              : isCurrent
                              ? { border: "2px solid #13403A" }
                              : { border: "2px solid #DDE6DF" }
                          }
                        >
                          {done ? "✓" : ""}
                        </span>
                        <span className="flex-1 truncate">{lesson.title}</span>
                        <span className="text-xs uppercase" style={{ color: "#5E6E69" }}>{lesson.type}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </LearnerShell>
  );
}
