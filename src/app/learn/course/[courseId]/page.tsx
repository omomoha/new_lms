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
        {/* Course header */}
        <div className="mb-6">
          <Link href="/learn" className="text-sm text-brand-primary hover:underline mb-2 inline-block">
            ← My Courses
          </Link>
          <h1 className="text-xl font-semibold text-gray-900">{course.title}</h1>
          {course.description && (
            <p className="text-gray-500 text-sm mt-1">{course.description}</p>
          )}
          {enrollment && (
            <div className="mt-3 max-w-xs">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
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
            <div key={mod.id} className="card">
              <h2 className="font-medium text-gray-900 mb-3">{mod.title}</h2>
              <ul className="space-y-1">
                {(lessonMap[mod.id] ?? []).map((lesson) => {
                  const progress = progressMap[lesson.id];
                  const done = !!progress?.completedAt;
                  const isCurrent = enrollment?.lastLessonId === lesson.id;
                  return (
                    <li key={lesson.id}>
                      <Link
                        href={`/learn/course/${courseId}/lesson/${lesson.id}`}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                          isCurrent
                            ? "bg-brand-light text-brand-primary font-medium"
                            : "hover:bg-gray-50 text-gray-700"
                        }`}
                      >
                        <span className={`w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${
                          done
                            ? "bg-brand-accent text-white"
                            : isCurrent
                            ? "border-2 border-brand-primary"
                            : "border-2 border-gray-300"
                        }`}>
                          {done ? "✓" : ""}
                        </span>
                        <span className="flex-1 truncate">{lesson.title}</span>
                        <span className="text-xs text-gray-400 uppercase">{lesson.type}</span>
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
