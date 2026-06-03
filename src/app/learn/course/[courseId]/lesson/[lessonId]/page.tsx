"use client";

/**
 * Lesson Player page.
 * Renders the correct lesson type (video, text, etc.) with a sidebar
 * showing the full module/lesson tree with completion state.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  doc, getDoc, collection, getDocs, query, orderBy
} from "firebase/firestore";
import DOMPurify from "isomorphic-dompurify"; // Fix #6: sanitize text-lesson HTML
import db from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import type { Course, CourseModule, Lesson, LessonProgress, Enrollment } from "@/types";
import LearnerShell from "@/components/layout/LearnerShell";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { Spinner } from "@/components/ui/Spinner";
import { ProgressBar } from "@/components/ui/ProgressBar";

export default function LessonPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;
  const lessonId = params.lessonId as string;
  const { appUser } = useAuth();

  const [course, setCourse] = useState<Course | null>(null);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [lessonMap, setLessonMap] = useState<Record<string, Lesson[]>>({});
  const [progressMap, setProgressMap] = useState<Record<string, LessonProgress>>({});
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const allLessonIds = Object.values(lessonMap).flat().map((l) => l.id);

  const load = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    try {
      const courseSnap = await getDoc(doc(db, "courses", courseId));
      if (!courseSnap.exists()) { router.push("/learn"); return; }
      setCourse(courseSnap.data() as Course);

      const modSnap = await getDocs(
        query(collection(db, "courses", courseId, "modules"), orderBy("order"))
      );
      const mods = modSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CourseModule));
      setModules(mods);

      const lMap: Record<string, Lesson[]> = {};
      let foundLesson: Lesson | null = null;
      for (const mod of mods) {
        const lSnap = await getDocs(
          query(collection(db, "courses", courseId, "modules", mod.id, "lessons"), orderBy("order"))
        );
        const lessons = lSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lesson));
        lMap[mod.id] = lessons;
        const match = lessons.find((l) => l.id === lessonId);
        if (match) foundLesson = match;
      }
      setLessonMap(lMap);
      setLesson(foundLesson);

      const enrollSnap = await getDoc(doc(db, "enrollments", `${appUser.uid}_${courseId}`));
      if (enrollSnap.exists()) setEnrollment(enrollSnap.data() as Enrollment);

      // Progress for sidebar completion states
      const allLessons = Object.values(lMap).flat();
      const pMap: Record<string, LessonProgress> = {};
      await Promise.all(
        allLessons.map(async (l: import("@/types").Lesson) => {
          const snap = await getDoc(doc(db, "progress", `${appUser.uid}_${l.id}`));
          if (snap.exists()) pMap[l.id] = snap.data() as LessonProgress;
        })
      );
      setProgressMap(pMap);
    } finally {
      setLoading(false);
    }
  }, [appUser, courseId, lessonId, router]);

  useEffect(() => { load(); }, [load]);

  // Navigate to next lesson after completion
  const handleLessonComplete = () => {
    const flat = Object.values(lessonMap).flat();
    const idx = flat.findIndex((l) => l.id === lessonId);
    const next = flat[idx + 1];
    if (next) router.push(`/learn/course/${courseId}/lesson/${next.id}`);
  };

  if (loading) return (
    <LearnerShell>
      <div className="flex justify-center py-20"><Spinner /></div>
    </LearnerShell>
  );

  if (!lesson || !course) return (
    <LearnerShell>
      <div className="flex justify-center py-20 text-gray-400">Lesson not found.</div>
    </LearnerShell>
  );

  const SidebarContent = () => (
    <nav className="h-full overflow-y-auto p-4 space-y-4">
      <div className="mb-2">
        <Link href={`/learn/course/${courseId}`} className="text-xs text-brand-primary hover:underline">
          ← {course.title}
        </Link>
        {enrollment && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Progress</span><span>{enrollment.progressPct}%</span>
            </div>
            <ProgressBar pct={enrollment.progressPct} />
          </div>
        )}
      </div>
      {modules.map((mod) => (
        <div key={mod.id}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
            {mod.title}
          </p>
          <ul className="space-y-0.5">
            {(lessonMap[mod.id] ?? []).map((l) => {
              const done = !!progressMap[l.id]?.completedAt;
              const current = l.id === lessonId;
              return (
                <li key={l.id}>
                  <Link
                    href={`/learn/course/${courseId}/lesson/${l.id}`}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
                      current
                        ? "bg-brand-primary text-white"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-xs ${
                      done ? "bg-brand-accent text-white" : current ? "bg-white/20" : "border border-gray-300"
                    }`}>
                      {done ? "✓" : ""}
                    </span>
                    <span className="truncate text-xs">{l.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <LearnerShell>
      {/* Mobile header with sidebar toggle */}
      <div className="lg:hidden flex items-center px-4 py-2 border-b border-gray-200 bg-white">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="text-sm text-brand-primary font-medium mr-3"
        >
          ☰ Contents
        </button>
        <h2 className="text-sm font-medium text-gray-900 truncate">{lesson.title}</h2>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-72 bg-white shadow-xl">
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex h-[calc(100vh-7rem)]">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-72 flex-shrink-0 border-r border-gray-200 bg-white flex-col">
          <SidebarContent />
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
          <h1 className="text-lg font-semibold text-gray-900 mb-4">{lesson.title}</h1>

          {/* Fix #5: only render VideoPlayer once allLessonIds is populated */}
          {lesson.type === "video" && lesson.videoPath && appUser ? (
            allLessonIds.length > 0 && (
              <VideoPlayer
                userId={appUser.uid}
                courseId={courseId}
                lessonId={lessonId}
                videoPath={lesson.videoPath}
                allLessonIds={allLessonIds}
                onComplete={handleLessonComplete}
              />
            )
          ) : lesson.type === "text" && lesson.textContent ? (
            // Fix #6: sanitize HTML before rendering to prevent XSS
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(lesson.textContent),
              }}
            />
          ) : lesson.type === "video" && !lesson.videoPath ? (
            <div className="w-full aspect-video bg-gray-100 rounded-xl flex items-center justify-center text-gray-400">
              Video not yet uploaded.
            </div>
          ) : (
            <div className="card text-center py-12 text-gray-400">
              <p className="text-3xl mb-2">📄</p>
              <p className="text-sm">
                {lesson.fileUrl ? (
                  <a href={lesson.fileUrl} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">
                    Open {lesson.type} resource →
                  </a>
                ) : (
                  `Content type "${lesson.type}" — file not yet attached.`
                )}
              </p>
            </div>
          )}
        </main>
      </div>
    </LearnerShell>
  );
}
