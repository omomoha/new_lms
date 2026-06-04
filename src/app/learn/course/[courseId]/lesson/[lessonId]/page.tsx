"use client";

/**
 * Lesson Player page.
 * Renders the correct lesson type (video, text, slides, doc, lab, quiz) with a
 * sidebar showing the full module/lesson tree with completion state.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  doc, getDoc, setDoc, updateDoc, collection, getDocs, query, orderBy, where, serverTimestamp
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { getResourceUrl, isPdf } from "@/lib/files";
import { calcProgressPct } from "@/lib/progress";
import { useAuth } from "@/contexts/AuthContext";
import type { Course, CourseModule, Lesson, LessonProgress, Enrollment, Assessment, Attempt } from "@/types";
import LearnerShell from "@/components/layout/LearnerShell";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { Spinner } from "@/components/ui/Spinner";
import { toEmbedUrl } from "@/lib/videoEmbed";
import { ProgressBar } from "@/components/ui/ProgressBar";
import QuizForm from "@/components/quiz/QuizForm";
import TextLessonContent from "@/components/lessons/TextLessonContent";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Document / slides viewer state
  const [resourceUrl, setResourceUrl] = useState<string | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [docCompleted, setDocCompleted] = useState(false);
  const [markingComplete, setMarkingComplete] = useState(false);
  const [markCompleteError, setMarkCompleteError] = useState<string | null>(null);

  // Quiz lesson state
  const [quizAssessment, setQuizAssessment] = useState<Assessment | null>(null);
  const [quizAttempt, setQuizAttempt] = useState<Attempt | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);

  const allLessonIds = Object.values(lessonMap).flat().map((l) => l.id);

  const load = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    setLoadError(null);
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

      // Quiz lesson: load assessment and latest attempt
      if (foundLesson?.type === "quiz") {
        const assessSnap = await getDocs(
          query(
            collection(db, "assessments"),
            where("courseId", "==", courseId),
            where("lessonId", "==", lessonId),
            where("kind", "==", "quiz")
          )
        );
        if (!assessSnap.empty) {
          const a = { id: assessSnap.docs[0].id, ...assessSnap.docs[0].data() } as Assessment;
          setQuizAssessment(a);

          // Load latest attempt for this user + assessment
          const attSnap = await getDocs(
            query(
              collection(db, "attempts"),
              where("userId", "==", appUser.uid),
              where("assessmentId", "==", a.id)
            )
          );
          if (!attSnap.empty) {
            // Sort by submittedAt descending to get latest
            const sorted = attSnap.docs
              .map((d) => ({ id: d.id, ...d.data() } as Attempt & { id: string }))
              .sort((x, y) => {
                const tx = x.submittedAt?.toMillis?.() ?? 0;
                const ty = y.submittedAt?.toMillis?.() ?? 0;
                return ty - tx;
              });
            setQuizAttempt(sorted[0]);
          }
        }
        // Check if quiz lesson already completed via progress
        const progSnap = await getDoc(doc(db, "progress", `${appUser.uid}_${lessonId}`));
        if (progSnap.exists() && (progSnap.data() as LessonProgress).completedAt) {
          setQuizCompleted(true);
        }
      }
    } catch (err: unknown) {
      console.error("LessonPage load failed:", err);
      setLoadError(err instanceof Error ? err.message : "Failed to load lesson. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [appUser, courseId, lessonId, router]);

  useEffect(() => { load(); }, [load]);

  // Resolve resource URL for slides/doc/lab lesson types
  useEffect(() => {
    if (!lesson) return;
    const needsResource = lesson.type === "slides" || lesson.type === "doc" || lesson.type === "lab";
    if (!needsResource) return;

    let cancelled = false;
    setResourceUrl(null);
    setResourceError(null);

    (async () => {
      try {
        if (lesson.filePath) {
          const url = await getResourceUrl(lesson.filePath);
          if (!cancelled) setResourceUrl(url);
        } else if (lesson.fileUrl) {
          if (!cancelled) setResourceUrl(lesson.fileUrl);
        }
        if (appUser) {
          const snap = await getDoc(doc(db, "progress", `${appUser.uid}_${lesson.id}`));
          if (!cancelled && snap.exists()) {
            const p = snap.data() as LessonProgress;
            if (p.completedAt) setDocCompleted(true);
          }
        }
      } catch (err: unknown) {
        if (!cancelled) setResourceError("Unable to load resource. Check your connection.");
        console.error(err);
      }
    })();

    return () => { cancelled = true; };
  }, [lesson, appUser]);

  // Navigate to next lesson after completion
  const handleLessonComplete = useCallback(() => {
    const flat = Object.values(lessonMap).flat();
    const idx = flat.findIndex((l) => l.id === lessonId);
    const next = flat[idx + 1];
    if (next) router.push(`/learn/course/${courseId}/lesson/${next.id}`);
  }, [lessonMap, lessonId, courseId, router]);

  // Mark a non-video lesson as complete (slides, doc, text, lab, quiz)
  const handleMarkNonVideoComplete = useCallback(async () => {
    if (!appUser || !lesson || docCompleted || markingComplete) return;
    setMarkingComplete(true);
    setMarkCompleteError(null);
    try {
      const progressDocId = `${appUser.uid}_${lesson.id}`;
      const enrollmentId = `${appUser.uid}_${courseId}`;

      await setDoc(doc(db, "progress", progressDocId), {
        userId: appUser.uid,
        lessonId: lesson.id,
        courseId,
        watchedPct: 100,
        positionSec: 0,
        completedAt: serverTimestamp(),
      });

      const completedIds = await Promise.all(
        allLessonIds.map(async (lid) => {
          const snap = await getDoc(doc(db, "progress", `${appUser.uid}_${lid}`));
          if (!snap.exists()) return null;
          const p = snap.data() as LessonProgress;
          return p.completedAt ? lid : null;
        })
      ).then((results) => results.filter((id): id is string => id !== null));

      const pct = calcProgressPct([...completedIds, lesson.id], allLessonIds);
      const enrollSnap = await getDoc(doc(db, "enrollments", enrollmentId));
      if (enrollSnap.exists()) {
        await updateDoc(doc(db, "enrollments", enrollmentId), {
          progressPct: pct,
          lastLessonId: lesson.id,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, "enrollments", enrollmentId), {
          userId: appUser.uid,
          courseId,
          cohortId: appUser.cohortIds?.[0] ?? "",
          progressPct: pct,
          lastLessonId: lesson.id,
          updatedAt: serverTimestamp(),
        });
      }

      setDocCompleted(true);
      handleLessonComplete();
    } catch (err: unknown) {
      console.error("handleMarkNonVideoComplete failed:", err);
      setMarkCompleteError("Could not mark lesson complete. Please try again.");
    } finally {
      setMarkingComplete(false);
    }
  }, [appUser, lesson, courseId, docCompleted, markingComplete, allLessonIds, handleLessonComplete]);

  // Called by QuizForm when learner passes the quiz
  const handleQuizPassed = useCallback(() => {
    setQuizCompleted(true);
    handleMarkNonVideoComplete();
  }, [handleMarkNonVideoComplete]);

  if (loading) return (
    <LearnerShell>
      <div className="flex justify-center py-20"><Spinner /></div>
    </LearnerShell>
  );

  if (loadError) return (
    <LearnerShell>
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div
          className="rounded-lg p-4 text-sm"
          style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}
        >
          {loadError}
        </div>
      </div>
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
        <Link href={`/learn/course/${courseId}`} className="text-xs font-medium hover:underline" style={{ color: "#8FB85C" }}>
          ← {course.title}
        </Link>
        {enrollment && (
          <div className="mt-2">
            <div className="flex justify-between text-xs mb-1" style={{ color: "#5E6E69" }}>
              <span>Progress</span><span>{enrollment.progressPct}%</span>
            </div>
            <ProgressBar pct={enrollment.progressPct} />
          </div>
        )}
      </div>
      {modules.map((mod) => (
        <div key={mod.id}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: "#5E6E69" }}>
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
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors"
                    style={
                      current
                        ? { backgroundColor: "#E7F1DE", color: "#13403A", fontWeight: 500 }
                        : { color: "#1E302C" }
                    }
                  >
                    <span
                      className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
                      style={
                        done
                          ? { backgroundColor: "#8FB85C", color: "#fff" }
                          : current
                          ? { border: "2px solid #13403A" }
                          : { border: "1px solid #DDE6DF" }
                      }
                    >
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
      <div className="lg:hidden flex items-center px-4 py-2 border-b bg-white" style={{ borderColor: "#DDE6DF" }}>
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="text-sm font-semibold mr-3"
          style={{ color: "#13403A" }}
        >
          ☰ Contents
        </button>
        <h2 className="text-sm font-medium truncate" style={{ color: "#1E302C" }}>{lesson.title}</h2>
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
        <aside className="hidden lg:flex w-72 flex-shrink-0 border-r bg-white flex-col" style={{ borderColor: "#DDE6DF" }}>
          <SidebarContent />
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6" style={{ backgroundColor: "#F5F7F4" }}>
          <h1 className="font-serif-brand text-xl font-normal mb-4" style={{ color: "#13403A" }}>{lesson.title}</h1>

          {/* ── Video lesson ─────────────────────────────────────────────── */}
          {lesson.type === "video" && lesson.videoUrl ? (
            (() => {
              const embed = toEmbedUrl(lesson.videoUrl);
              if (!embed) return (
                <div className="w-full aspect-video rounded-xl flex items-center justify-center" style={{ backgroundColor: "#E7F1DE", color: "#5E6E69" }}>
                  Invalid video URL.
                </div>
              );
              return (
                <div className="space-y-3">
                  <div className="w-full rounded-xl overflow-hidden card !p-0" style={{ aspectRatio: "16/9" }}>
                    <iframe
                      src={embed.embedUrl}
                      title={lesson.title}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                  <p className="text-xs" style={{ color: "#9EB3AD" }}>
                    Video hosted externally — watch progress is not tracked automatically.
                  </p>
                  <NonVideoCompleteButton
                    completed={docCompleted}
                    loading={markingComplete}
                    error={markCompleteError}
                    onMark={handleMarkNonVideoComplete}
                  />
                </div>
              );
            })()
          ) : lesson.type === "video" && lesson.videoPath && appUser ? (
            allLessonIds.length > 0 && (
              <>
                <VideoPlayer
                  userId={appUser.uid}
                  courseId={courseId}
                  lessonId={lessonId}
                  videoPath={lesson.videoPath}
                  allLessonIds={allLessonIds}
                  captionsPath={lesson.captionsPath}
                  onComplete={handleLessonComplete}
                />
                {lesson.transcript && (
                  <details className="mt-4 card">
                    <summary
                      className="cursor-pointer text-sm font-semibold select-none"
                      style={{ color: "#13403A" }}
                    >
                      Transcript
                    </summary>
                    <div
                      className="mt-3 text-sm whitespace-pre-wrap leading-relaxed"
                      style={{ color: "#1E302C" }}
                    >
                      {lesson.transcript}
                    </div>
                  </details>
                )}
              </>
            )
          ) : lesson.type === "video" && !lesson.videoPath && !lesson.videoUrl ? (
            <div className="w-full aspect-video rounded-xl flex items-center justify-center" style={{ backgroundColor: "#E7F1DE", color: "#5E6E69" }}>
              Video not yet uploaded.
            </div>

          ) : /* ── Text lesson ──────────────────────────────────────────────── */
          lesson.type === "text" && lesson.textContent ? (
            <>
              <TextLessonContent content={lesson.textContent} />
              <div className="mt-6">
                <NonVideoCompleteButton
                  completed={docCompleted}
                  loading={markingComplete}
                  error={markCompleteError}
                  onMark={handleMarkNonVideoComplete}
                />
              </div>
            </>

          ) : /* ── Quiz lesson ──────────────────────────────────────────────── */
          lesson.type === "quiz" ? (
            <div className="max-w-2xl space-y-4">
              {quizAssessment ? (
                <>
                  {quizCompleted && (
                    <div className="inline-flex items-center gap-1.5 text-sm font-medium mb-2" style={{ color: "#8FB85C" }}>
                      <span>✓</span> Quiz completed
                    </div>
                  )}
                  <QuizForm
                    assessment={quizAssessment}
                    existingAttempt={quizAttempt}
                    onPassed={handleQuizPassed}
                  />
                </>
              ) : (
                <div className="card text-center py-12" style={{ color: "#5E6E69" }}>
                  <p className="text-sm">This quiz has not been set up yet. Please check back later.</p>
                </div>
              )}
            </div>

          ) : /* ── Slides / Doc / Lab with resource file ───────────────────── */
          (lesson.type === "slides" || lesson.type === "doc" || lesson.type === "lab") ? (
            <div className="space-y-4">
              {resourceUrl && (
                <a
                  href={resourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 btn-secondary text-sm"
                >
                  ↗ Open / download file
                </a>
              )}

              {resourceError ? (
                <div className="card py-10 text-center text-sm" style={{ color: "#5E6E69" }}>
                  {resourceError}
                </div>
              ) : !resourceUrl ? (
                lesson.filePath || lesson.fileUrl ? (
                  <div className="w-full rounded-xl flex items-center justify-center" style={{ height: "70vh", backgroundColor: "#E7F1DE" }}>
                    <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#8FB85C" }} />
                  </div>
                ) : (
                  <div className="card text-center py-12" style={{ color: "#5E6E69" }}>
                    <p className="text-sm">File not yet uploaded for this lesson.</p>
                  </div>
                )
              ) : isPdf(lesson.filePath ?? lesson.fileUrl ?? "") ? (
                <iframe
                  src={resourceUrl}
                  title={lesson.title}
                  className="w-full rounded-xl border"
                  style={{ height: "70vh", borderColor: "#DDE6DF" }}
                />
              ) : (
                <>
                  <iframe
                    src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resourceUrl)}`}
                    title={lesson.title}
                    className="w-full rounded-xl border"
                    style={{ height: "70vh", borderColor: "#DDE6DF" }}
                    allowFullScreen
                  />
                  <p className="text-xs mt-1" style={{ color: "#9EB3AD" }}>
                    Preview rendered via Microsoft Office Online.
                  </p>
                </>
              )}

              <NonVideoCompleteButton
                completed={docCompleted}
                loading={markingComplete}
                error={markCompleteError}
                onMark={handleMarkNonVideoComplete}
              />
            </div>

          ) : (
            /* ── Unknown / unimplemented type ─────────────────────────────── */
            <div className="card text-center py-12" style={{ color: "#5E6E69" }}>
              <p className="text-sm">
                {`Content type "${lesson.type}" is not yet supported.`}
              </p>
            </div>
          )}
        </main>
      </div>
    </LearnerShell>
  );
}

// ── Mark-complete button for non-video lessons ──────────────────────────────

interface NonVideoCompleteButtonProps {
  completed: boolean;
  loading: boolean;
  error: string | null;
  onMark: () => void;
}

function NonVideoCompleteButton({ completed, loading, error, onMark }: NonVideoCompleteButtonProps) {
  if (completed) {
    return (
      <div className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: "#8FB85C" }}>
        <span>✓</span> Completed
      </div>
    );
  }
  return (
    <div>
      <button
        onClick={onMark}
        disabled={loading}
        className="btn-primary text-sm"
        style={{ opacity: loading ? 0.7 : 1 }}
      >
        {loading ? "Saving…" : "Mark as Complete ✓"}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
