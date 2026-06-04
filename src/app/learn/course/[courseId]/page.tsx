"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  doc, getDoc, collection, getDocs, query, orderBy, where
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import { useAuth } from "@/contexts/AuthContext";
import type { Course, CourseModule, Lesson, Enrollment, LessonProgress, Assessment, Attempt, Certificate } from "@/types";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import { ProgressBar } from "@/components/ui/ProgressBar";
import QuizForm from "@/components/quiz/QuizForm";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Pre/Post assessment state
  const [preAssessment, setPreAssessment] = useState<Assessment | null>(null);
  const [postAssessment, setPostAssessment] = useState<Assessment | null>(null);
  const [preAttempt, setPreAttempt] = useState<Attempt | null>(null);
  const [postAttempt, setPostAttempt] = useState<Attempt | null>(null);
  // Which assessment panel is expanded
  const [showingAssessment, setShowingAssessment] = useState<"pre" | "post" | null>(null);

  // Phase 3: certificate state
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [certLoading, setCertLoading] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);

  useEffect(() => {
    if (!appUser) return;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const courseSnap = await getDoc(doc(db, "courses", courseId));
        if (!courseSnap.exists()) { router.push("/learn"); return; }
        setCourse(courseSnap.data() as Course);

        // Modules and lessons are gated by cohort assignment in Firestore rules.
        // If the learner is not in an assigned cohort, the subcollection read will
        // be denied — detect that and show a clean locked state instead of a
        // generic error.
        let mods: CourseModule[] = [];
        try {
          const modSnap = await getDocs(
            query(collection(db, "courses", courseId, "modules"), orderBy("order"))
          );
          mods = modSnap.docs.map((d) => d.data() as CourseModule);
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === "permission-denied") {
            setPermissionDenied(true);
            return;
          }
          throw err;
        }
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

        // Fetch all lesson progress
        const allLessons = Object.values(lMap).flat();
        const pMap: Record<string, LessonProgress> = {};
        await Promise.all(
          allLessons.map(async (l) => {
            const pSnap = await getDoc(doc(db, "progress", `${appUser.uid}_${l.id}`));
            if (pSnap.exists()) pMap[l.id] = pSnap.data() as LessonProgress;
          })
        );
        setProgressMap(pMap);

        // Load pre/post assessments for this course
        const preSnap = await getDocs(
          query(
            collection(db, "assessments"),
            where("courseId", "==", courseId),
            where("kind", "==", "pre")
          )
        );
        if (!preSnap.empty) {
          const pre = { id: preSnap.docs[0].id, ...preSnap.docs[0].data() } as Assessment;
          setPreAssessment(pre);

          // Check for existing attempt
          const preAttSnap = await getDocs(
            query(
              collection(db, "attempts"),
              where("userId", "==", appUser.uid),
              where("assessmentId", "==", pre.id)
            )
          );
          if (!preAttSnap.empty) {
            const sorted = preAttSnap.docs
              .map((d) => ({ id: d.id, ...d.data() } as Attempt & { id: string }))
              .sort((a, b) => {
                const ta = a.submittedAt?.toMillis?.() ?? 0;
                const tb = b.submittedAt?.toMillis?.() ?? 0;
                return tb - ta;
              });
            setPreAttempt(sorted[0]);
          }
        }

        const postSnap = await getDocs(
          query(
            collection(db, "assessments"),
            where("courseId", "==", courseId),
            where("kind", "==", "post")
          )
        );
        if (!postSnap.empty) {
          const post = { id: postSnap.docs[0].id, ...postSnap.docs[0].data() } as Assessment;
          setPostAssessment(post);

          const postAttSnap = await getDocs(
            query(
              collection(db, "attempts"),
              where("userId", "==", appUser.uid),
              where("assessmentId", "==", post.id)
            )
          );
          if (!postAttSnap.empty) {
            const sorted = postAttSnap.docs
              .map((d) => ({ id: d.id, ...d.data() } as Attempt & { id: string }))
              .sort((a, b) => {
                const ta = a.submittedAt?.toMillis?.() ?? 0;
                const tb = b.submittedAt?.toMillis?.() ?? 0;
                return tb - ta;
              });
            setPostAttempt(sorted[0]);
          }
        }

        // Phase 3: existing certificate for this course (auto-issued or on-demand)
        const certSnap = await getDocs(
          query(
            collection(db, "certificates"),
            where("userId", "==", appUser.uid),
            where("courseId", "==", courseId)
          )
        );
        if (!certSnap.empty) setCertificate(certSnap.docs[0].data() as Certificate);
      } catch (err: unknown) {
        console.error("CoursePage load failed:", err);
        setLoadError(err instanceof Error ? err.message : "Failed to load course. Please try again.");
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

  if (permissionDenied) return (
    <LearnerShell>
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div
          className="card inline-flex flex-col items-center gap-3 px-8 py-10"
        >
          <span style={{ fontSize: "2.5rem", lineHeight: 1 }}>🔒</span>
          <h2 className="font-semibold text-base" style={{ color: "#13403A" }}>
            {course?.title ?? "This course"} isn&apos;t assigned to your cohort yet.
          </h2>
          <p className="text-sm" style={{ color: "#5E6E69" }}>
            Ask your admin to add you to the right cohort.
          </p>
          <Link href="/learn" className="btn-secondary text-sm mt-2">
            ← Back to My Courses
          </Link>
        </div>
      </div>
    </LearnerShell>
  );

  if (!course) return null;

  const firstLesson = Object.values(lessonMap).flat()[0];
  const progressPct = enrollment?.progressPct ?? 0;
  const courseComplete = progressPct >= 100;
  // Certificate is available once lessons are done AND (no post-assessment OR it's passed)
  const certEligible = courseComplete && (!postAssessment || !!postAttempt?.passed);

  const handleGetCertificate = async () => {
    setCertLoading(true);
    setCertError(null);
    try {
      const fn = httpsCallable<{ courseId: string }, { certId: string; downloadUrl: string }>(
        functions,
        "issueCertificate"
      );
      const { data } = await fn({ courseId });
      window.open(data.downloadUrl, "_blank", "noopener");
      if (!certificate) {
        setCertificate({
          certId: data.certId,
          userId: appUser!.uid,
          learnerName: appUser!.name,
          courseId,
          courseTitle: course?.title ?? "",
          issuedAt: null as unknown as Certificate["issuedAt"],
        });
      }
    } catch (err: unknown) {
      console.error("issueCertificate failed:", err);
      setCertError(
        err instanceof Error && err.message.includes("failed-precondition")
          ? err.message
          : "Could not issue your certificate. Please try again."
      );
    } finally {
      setCertLoading(false);
    }
  };

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

        {/* Pre-assessment banner: show if exists and learner has no attempt yet */}
        {preAssessment && !preAttempt && (
          <div className="card mb-4" style={{ borderLeft: "4px solid #8FB85C" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="kicker text-xs" style={{ color: "#2C7A6B" }}>PRE-COURSE ASSESSMENT</span>
                <h3 className="font-semibold text-sm mt-0.5" style={{ color: "#13403A" }}>
                  {preAssessment.title}
                </h3>
                <p className="text-xs mt-1" style={{ color: "#5E6E69" }}>
                  {preAssessment.questions.length} question{preAssessment.questions.length !== 1 ? "s" : ""} · pass mark: {preAssessment.passMark}%
                </p>
              </div>
              <button
                onClick={() => setShowingAssessment(showingAssessment === "pre" ? null : "pre")}
                className="btn-primary text-xs flex-shrink-0"
              >
                {showingAssessment === "pre" ? "Close" : "Take Assessment"}
              </button>
            </div>
            {showingAssessment === "pre" && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: "#DDE6DF" }}>
                <QuizForm
                  assessment={preAssessment}
                  onPassed={() => {
                    setShowingAssessment(null);
                    // Re-trigger effect to refresh attempt state
                    router.refresh();
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Pre-assessment score when already attempted */}
        {preAssessment && preAttempt && (
          <div className="card mb-4" style={{ borderLeft: "4px solid #8FB85C" }}>
            <span className="kicker text-xs" style={{ color: "#2C7A6B" }}>PRE-COURSE ASSESSMENT</span>
            <div className="flex items-center justify-between mt-1">
              <div>
                <p className="text-sm font-medium" style={{ color: "#13403A" }}>{preAssessment.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "#5E6E69" }}>
                  Score: {preAttempt.score}/{preAttempt.total} ({preAttempt.total > 0 ? Math.round((preAttempt.score / preAttempt.total) * 100) : 0}%)
                  {" · "}
                  <span style={{ color: preAttempt.passed ? "#2C7A6B" : "#B91C1C" }}>
                    {preAttempt.passed ? "Passed" : "Not passed"}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowingAssessment(showingAssessment === "pre" ? null : "pre")}
                className="btn-secondary text-xs"
              >
                {showingAssessment === "pre" ? "Close" : "Retake"}
              </button>
            </div>
            {showingAssessment === "pre" && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: "#DDE6DF" }}>
                <QuizForm
                  assessment={preAssessment}
                  onPassed={() => setShowingAssessment(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* Start / Continue button */}
        {firstLesson && (
          <Link
            href={`/learn/course/${courseId}/lesson/${enrollment?.lastLessonId ?? firstLesson.id}`}
            className="btn-primary mb-8 inline-block"
          >
            {enrollment?.lastLessonId ? "Continue Learning" : "Start Course"}
          </Link>
        )}

        {/* Pre-before-post: if the course is complete but the pre-assessment was
            never taken, point the learner there before unlocking the post. */}
        {postAssessment && courseComplete && !postAttempt && preAssessment && !preAttempt && (
          <div className="card mb-4" style={{ borderLeft: "4px solid #B45309", backgroundColor: "#FFFBEB" }}>
            <span className="kicker text-xs" style={{ color: "#B45309" }}>POST-COURSE ASSESSMENT — LOCKED</span>
            <p className="text-sm mt-1" style={{ color: "#1E302C" }}>
              Take the <b>pre-course assessment</b> above first — it&apos;s required before the
              final assessment so we can measure your improvement.
            </p>
          </div>
        )}

        {/* Post-assessment banner: course 100% complete AND pre taken (if one exists) */}
        {postAssessment && courseComplete && !postAttempt && (!preAssessment || !!preAttempt) && (
          <div className="card mb-4" style={{ borderLeft: "4px solid #13403A" }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="kicker text-xs" style={{ color: "#13403A" }}>POST-COURSE ASSESSMENT</span>
                <h3 className="font-semibold text-sm mt-0.5" style={{ color: "#13403A" }}>
                  {postAssessment.title}
                </h3>
                <p className="text-xs mt-1" style={{ color: "#5E6E69" }}>
                  You have completed the course — take the final assessment.
                </p>
              </div>
              <button
                onClick={() => setShowingAssessment(showingAssessment === "post" ? null : "post")}
                className="btn-primary text-xs flex-shrink-0"
              >
                {showingAssessment === "post" ? "Close" : "Take Assessment"}
              </button>
            </div>
            {showingAssessment === "post" && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: "#DDE6DF" }}>
                <QuizForm
                  assessment={postAssessment}
                  onPassed={() => {
                    setShowingAssessment(null);
                    router.refresh();
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Post-assessment score when already attempted */}
        {postAssessment && postAttempt && (
          <div className="card mb-4" style={{ borderLeft: "4px solid #13403A" }}>
            <span className="kicker text-xs" style={{ color: "#13403A" }}>POST-COURSE ASSESSMENT</span>
            <div className="flex items-center justify-between mt-1">
              <div>
                <p className="text-sm font-medium" style={{ color: "#13403A" }}>{postAssessment.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "#5E6E69" }}>
                  Score: {postAttempt.score}/{postAttempt.total} ({postAttempt.total > 0 ? Math.round((postAttempt.score / postAttempt.total) * 100) : 0}%)
                  {" · "}
                  <span style={{ color: postAttempt.passed ? "#2C7A6B" : "#B91C1C" }}>
                    {postAttempt.passed ? "Passed" : "Not passed"}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowingAssessment(showingAssessment === "post" ? null : "post")}
                className="btn-secondary text-xs"
              >
                {showingAssessment === "post" ? "Close" : "Retake"}
              </button>
            </div>
            {showingAssessment === "post" && (
              <div className="mt-4 pt-4 border-t" style={{ borderColor: "#DDE6DF" }}>
                <QuizForm
                  assessment={postAssessment}
                  onPassed={() => setShowingAssessment(null)}
                />
              </div>
            )}
          </div>
        )}

        {/* Phase 3: Certificate card */}
        {(certEligible || certificate) && (
          <div
            className="card mb-6 flex flex-col sm:flex-row sm:items-center gap-4"
            style={{ borderLeft: "4px solid #8FB85C", backgroundColor: "#FBFDF9" }}
          >
            <div className="flex-1">
              <span className="kicker text-xs" style={{ color: "#2C7A6B" }}>CERTIFICATE</span>
              <h3 className="font-semibold text-sm mt-0.5" style={{ color: "#13403A" }}>
                {certificate
                  ? "Your certificate has been issued 🎓"
                  : "You've earned your certificate 🎓"}
              </h3>
              <p className="text-xs mt-1" style={{ color: "#5E6E69" }}>
                {certificate ? (
                  <>
                    ID: <span className="font-mono font-semibold">{certificate.certId}</span>
                    {" · "}
                    <a
                      href={`/verify/${certificate.certId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      public verification link
                    </a>
                    {" · "}a copy was emailed to you
                  </>
                ) : (
                  "Download your branded PDF — it will also be emailed to you."
                )}
              </p>
              {certError && <p className="text-xs mt-1" style={{ color: "#B91C1C" }}>{certError}</p>}
            </div>
            <button
              onClick={handleGetCertificate}
              disabled={certLoading}
              className="btn-primary text-sm flex-shrink-0"
              style={{ opacity: certLoading ? 0.7 : 1 }}
            >
              {certLoading ? "Preparing…" : certificate ? "Download PDF" : "Get my certificate"}
            </button>
          </div>
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
