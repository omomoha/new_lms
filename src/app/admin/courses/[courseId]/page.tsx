"use client";

/**
 * Course Builder — Admin
 * Lets admins add/reorder modules and lessons, upload video for video lessons,
 * define quiz lessons with inline question editor, and configure pre/post assessments.
 */

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  serverTimestamp,
  query,
  orderBy,
  arrayUnion,
  arrayRemove,
  where,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { videoService } from "@/lib/video";
import { uploadResource, ACCEPT_BY_TYPE } from "@/lib/files";
import type { Course, CourseModule, Lesson, LessonType, Cohort, Assessment, AssessmentKind } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import QuizEditor from "@/components/quiz/QuizEditor";
import { toEmbedUrl } from "@/lib/videoEmbed";

const LESSON_TYPES: LessonType[] = ["video", "text", "slides", "doc", "lab", "quiz"];

export default function CourseBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [lessonMap, setLessonMap] = useState<Record<string, Lesson[]>>({});
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [loading, setLoading] = useState(true);

  // Module form
  const [addingModule, setAddingModule] = useState(false);
  const [moduleTitle, setModuleTitle] = useState("");

  // Lesson form
  const [addingLessonTo, setAddingLessonTo] = useState<string | null>(null);
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonType, setLessonType] = useState<LessonType>("video");
  const [lessonText, setLessonText] = useState("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [videoUrlError, setVideoUrlError] = useState<string | null>(null);
  const [resourceFile, setResourceFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resourceFileRef = useRef<HTMLInputElement>(null);

  // Quiz editor: shown after a quiz lesson is created (or for editing)
  // key = lessonId, value = assessment or null if not yet created
  const [quizAssessments, setQuizAssessments] = useState<Record<string, Assessment | null>>({});
  // Which quiz lesson is currently showing its editor inline
  const [editingQuizLessonId, setEditingQuizLessonId] = useState<string | null>(null);

  // Pre/post assessments
  const [preAssessment, setPreAssessment] = useState<Assessment | null | undefined>(undefined);
  const [postAssessment, setPostAssessment] = useState<Assessment | null | undefined>(undefined);
  const [editingPrePost, setEditingPrePost] = useState<AssessmentKind | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const courseSnap = await getDoc(doc(db, "courses", courseId));
      if (!courseSnap.exists()) { router.push("/admin/courses"); return; }
      const courseData = courseSnap.data() as Course;
      setCourse(courseData);

      const cohortSnap = await getDocs(collection(db, "cohorts"));
      setCohorts(cohortSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cohort)));

      const modSnap = await getDocs(
        query(collection(db, "courses", courseId, "modules"), orderBy("order"))
      );
      const mods = modSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CourseModule));
      setModules(mods);

      const lMap: Record<string, Lesson[]> = {};
      for (const mod of mods) {
        const lSnap = await getDocs(
          query(collection(db, "courses", courseId, "modules", mod.id, "lessons"), orderBy("order"))
        );
        lMap[mod.id] = lSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lesson));
      }
      setLessonMap(lMap);

      // Load quiz assessments for quiz-type lessons
      const allLessons = Object.values(lMap).flat().filter((l) => l.type === "quiz");
      const qMap: Record<string, Assessment | null> = {};
      await Promise.all(allLessons.map(async (l) => {
        const snap = await getDocs(
          query(
            collection(db, "assessments"),
            where("courseId", "==", courseId),
            where("lessonId", "==", l.id),
            where("kind", "==", "quiz")
          )
        );
        qMap[l.id] = snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as Assessment);
      }));
      setQuizAssessments(qMap);

      // Load pre/post assessments
      const preSnap = await getDocs(
        query(collection(db, "assessments"), where("courseId", "==", courseId), where("kind", "==", "pre"))
      );
      setPreAssessment(preSnap.empty ? null : ({ id: preSnap.docs[0].id, ...preSnap.docs[0].data() } as Assessment));

      const postSnap = await getDocs(
        query(collection(db, "assessments"), where("courseId", "==", courseId), where("kind", "==", "post"))
      );
      setPostAssessment(postSnap.empty ? null : ({ id: postSnap.docs[0].id, ...postSnap.docs[0].data() } as Assessment));
    } finally {
      setLoading(false);
    }
  }, [courseId, router]);

  useEffect(() => { load(); }, [load]);

  const handleAddModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moduleTitle.trim()) return;
    setSaving(true); setError(null);
    try {
      const order = modules.length;
      const ref = await addDoc(collection(db, "courses", courseId, "modules"), {
        title: moduleTitle.trim(),
        order,
        lessonOrder: [],
      });
      await updateDoc(doc(db, "courses", courseId, "modules", ref.id), { id: ref.id });
      const newOrder = [...(course?.moduleOrder ?? []), ref.id];
      await updateDoc(doc(db, "courses", courseId), { moduleOrder: newOrder });
      setModuleTitle(""); setAddingModule(false);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const handleAddLesson = async (e: React.FormEvent, moduleId: string) => {
    e.preventDefault();
    if (!lessonTitle.trim()) return;
    setSaving(true); setError(null); setVideoUrlError(null);
    try {
      const existingLessons = lessonMap[moduleId] ?? [];
      const order = existingLessons.length;

      let videoPath: string | undefined;
      let videoUrl: string | undefined;

      if (lessonType === "video") {
        if (videoFile) {
          const path = `videos/${courseId}/${moduleId}/${Date.now()}_${videoFile.name}`;
          videoPath = await videoService.uploadVideo(videoFile, path, (p) =>
            setUploadPct(p.pct)
          );
          setUploadPct(null);
        } else if (videoUrlInput.trim()) {
          const embedResult = toEmbedUrl(videoUrlInput.trim());
          if (!embedResult) {
            setVideoUrlError("Invalid URL — only YouTube and Google Drive links are accepted.");
            setSaving(false);
            return;
          }
          videoUrl = videoUrlInput.trim();
        }
      }

      let filePath: string | undefined;
      if ((lessonType === "slides" || lessonType === "doc" || lessonType === "lab") && resourceFile) {
        const path = `resources/${courseId}/${moduleId}/${Date.now()}_${resourceFile.name}`;
        filePath = await uploadResource(resourceFile, path, (p) =>
          setUploadPct(p.pct)
        );
        setUploadPct(null);
      }

      const lessonData: Omit<Lesson, "id"> = {
        title: lessonTitle.trim(),
        type: lessonType,
        order,
        ...(videoPath ? { videoPath } : {}),
        ...(videoUrl ? { videoUrl } : {}),
        ...(filePath ? { filePath } : {}),
        ...(lessonType === "text" ? { textContent: lessonText } : {}),
      };

      const ref = await addDoc(
        collection(db, "courses", courseId, "modules", moduleId, "lessons"),
        lessonData
      );
      await updateDoc(
        doc(db, "courses", courseId, "modules", moduleId, "lessons", ref.id),
        { id: ref.id }
      );
      const newLOrder = [...existingLessons.map((l) => l.id), ref.id];
      await updateDoc(doc(db, "courses", courseId, "modules", moduleId), {
        lessonOrder: newLOrder,
      });

      const createdLessonId = ref.id;
      setLessonTitle(""); setLessonText(""); setVideoFile(null); setVideoUrlInput(""); setVideoUrlError(null); setResourceFile(null);
      setAddingLessonTo(null);

      // If quiz type, automatically open the quiz editor for the new lesson
      if (lessonType === "quiz") {
        setQuizAssessments((prev) => ({ ...prev, [createdLessonId]: null }));
        setEditingQuizLessonId(createdLessonId);
        // Need to reload so the lesson appears in lessonMap before editor shows
      }

      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add lesson");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    if (!course) return;
    const next = course.status === "published" ? "draft" : "published";
    await updateDoc(doc(db, "courses", courseId), { status: next });
    setCourse({ ...course, status: next });
  };

  const toggleCohortAccess = async (cohortId: string) => {
    if (!course) return;
    const has = (course.assignedCohortIds ?? []).includes(cohortId);
    setError(null);
    try {
      await updateDoc(doc(db, "courses", courseId), {
        assignedCohortIds: has ? arrayRemove(cohortId) : arrayUnion(cohortId),
      });
      await updateDoc(doc(db, "cohorts", cohortId), {
        courseIds: has ? arrayRemove(courseId) : arrayUnion(courseId),
      });
      setCourse({
        ...course,
        assignedCohortIds: has
          ? (course.assignedCohortIds ?? []).filter((id) => id !== cohortId)
          : [...(course.assignedCohortIds ?? []), cohortId],
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update cohort access");
    }
  };

  if (loading) return (
    <AdminShell>
      <div className="flex justify-center py-20"><Spinner /></div>
    </AdminShell>
  );

  if (!course) return null;

  return (
    <AdminShell>
      {/* Page hero band */}
      <div className="page-hero flex flex-col sm:flex-row sm:items-end gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <span className="kicker">ADMIN · COURSE BUILDER</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight truncate">
            {course.title}
          </h1>
          {course.description && (
            <p className="mt-1 text-sm truncate" style={{ color: "#CFE0D5" }}>
              {course.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge
            label={course.status}
            variant={course.status === "published" ? "success" : "warning"}
          />
          <button onClick={togglePublish} className="btn-secondary text-xs px-3 py-1.5">
            {course.status === "published" ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Cohort access */}
      <div className="card mb-4">
        <h2 className="font-medium mb-1" style={{ color: "#1E302C" }}>Cohort access</h2>
        <p className="text-xs mb-3" style={{ color: "#5E6E69" }}>
          Learners see this course only when it is <b>published</b> and assigned to
          one of their cohorts.
        </p>
        {cohorts.length === 0 ? (
          <p className="text-xs" style={{ color: "#5E6E69" }}>
            No cohorts yet — create one under the Cohorts tab.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {cohorts.map((c) => {
              const on = (course.assignedCohortIds ?? []).includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCohortAccess(c.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    on
                      ? "text-white"
                      : "bg-white hover:border-brand-teal"
                  }`}
                  style={
                    on
                      ? { backgroundColor: c.color || "#2C7A6B", borderColor: c.color || "#2C7A6B" }
                      : { borderColor: "#DDE6DF", color: "#5E6E69" }
                  }
                  title={on ? `Revoke ${c.name}` : `Grant ${c.name}`}
                >
                  {on ? "✓ " : ""}
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pre / Post assessments */}
      <div className="card mb-4">
        <h2 className="font-medium mb-1" style={{ color: "#1E302C" }}>Pre / Post Assessments</h2>
        <p className="text-xs mb-4" style={{ color: "#5E6E69" }}>
          Pre-assessment shown before learners start the course; post-assessment after 100% completion.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(["pre", "post"] as AssessmentKind[]).map((kind) => {
            const existing = kind === "pre" ? preAssessment : postAssessment;
            const isEditing = editingPrePost === kind;
            return (
              <div key={kind} className="rounded-lg p-3 border" style={{ borderColor: "#DDE6DF", backgroundColor: "#F5F7F4" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase" style={{ color: "#2C7A6B" }}>
                    {kind === "pre" ? "Pre-course" : "Post-course"}
                  </span>
                  {existing && !isEditing && (
                    <button
                      onClick={() => setEditingPrePost(kind)}
                      className="text-xs btn-secondary px-2 py-1"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {isEditing ? (
                  <QuizEditor
                    courseId={courseId}
                    kind={kind}
                    existing={existing ?? undefined}
                    onSaved={(a) => {
                      if (kind === "pre") setPreAssessment(a);
                      else setPostAssessment(a);
                      setEditingPrePost(null);
                    }}
                    onCancel={() => setEditingPrePost(null)}
                  />
                ) : existing ? (
                  <div>
                    <p className="text-sm font-medium" style={{ color: "#1E302C" }}>{existing.title}</p>
                    <p className="text-xs mt-0.5" style={{ color: "#5E6E69" }}>
                      {existing.questions.length} question{existing.questions.length !== 1 ? "s" : ""} · pass: {existing.passMark}%
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingPrePost(kind)}
                    className="btn-primary text-xs w-full"
                  >
                    + Create {kind === "pre" ? "Pre" : "Post"}-Assessment
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modules */}
      <div className="space-y-4">
        {modules.map((mod) => (
          <div key={mod.id} className="card overflow-hidden !p-0">
            {/* Module header strip */}
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b" style={{ borderColor: "#DDE6DF", backgroundColor: "#F5F7F4" }}>
              <h2 className="font-semibold text-sm" style={{ color: "#13403A" }}>{mod.title}</h2>
              <button
                onClick={() => setAddingLessonTo(addingLessonTo === mod.id ? null : mod.id)}
                className="btn-secondary text-xs px-2.5 py-1"
              >
                + Lesson
              </button>
            </div>
            <div className="px-4 sm:px-5 py-3">
              {/* Lesson list */}
              {(lessonMap[mod.id] ?? []).length > 0 ? (
                <ul className="space-y-1.5 mb-3">
                  {(lessonMap[mod.id] ?? []).map((lesson) => (
                    <li key={lesson.id}>
                      <div
                        className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg"
                        style={{ backgroundColor: "#E7F1DE", color: "#1E302C" }}
                      >
                        <span className="text-xs font-semibold uppercase" style={{ color: "#2C7A6B" }}>
                          {lesson.type}
                        </span>
                        <span className="flex-1">{lesson.title}</span>
                        {lesson.type === "quiz" && (
                          <button
                            onClick={() => setEditingQuizLessonId(
                              editingQuizLessonId === lesson.id ? null : lesson.id
                            )}
                            className="text-xs btn-secondary px-2 py-0.5"
                          >
                            {quizAssessments[lesson.id]
                              ? (editingQuizLessonId === lesson.id ? "Close" : "Edit Quiz")
                              : "Set Up Quiz"}
                          </button>
                        )}
                      </div>
                      {/* Inline quiz editor for this lesson */}
                      {lesson.type === "quiz" && editingQuizLessonId === lesson.id && (
                        <div className="mt-2 pl-4 border-l-2" style={{ borderColor: "#8FB85C" }}>
                          <QuizEditor
                            courseId={courseId}
                            kind="quiz"
                            lessonId={lesson.id}
                            existing={quizAssessments[lesson.id] ?? undefined}
                            onSaved={(a) => {
                              setQuizAssessments((prev) => ({ ...prev, [lesson.id]: a }));
                              setEditingQuizLessonId(null);
                            }}
                            onCancel={() => setEditingQuizLessonId(null)}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs mb-3" style={{ color: "#5E6E69" }}>No lessons yet.</p>
              )}

              {/* Add lesson form */}
              {addingLessonTo === mod.id && (
                <form
                  onSubmit={(e) => handleAddLesson(e, mod.id)}
                  className="border-t pt-3 space-y-3"
                  style={{ borderColor: "#DDE6DF" }}
                >
                  <input
                    className="input-field"
                    placeholder="Lesson title"
                    value={lessonTitle}
                    onChange={(e) => setLessonTitle(e.target.value)}
                    required
                  />
                  <select
                    className="input-field"
                    value={lessonType}
                    onChange={(e) => setLessonType(e.target.value as LessonType)}
                  >
                    {LESSON_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>

                  {lessonType === "video" && (
                    <div className="space-y-2">
                      <input
                        ref={fileRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => { setVideoFile(e.target.files?.[0] ?? null); setVideoUrlInput(""); setVideoUrlError(null); }}
                      />
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="btn-secondary text-xs"
                      >
                        {videoFile ? videoFile.name : "Choose video file"}
                      </button>
                      {uploadPct !== null && (
                        <div className="mt-2">
                          <div className="w-full rounded-full h-1.5" style={{ backgroundColor: "#DDE6DF" }}>
                            <div
                              className="h-1.5 rounded-full transition-all"
                              style={{ width: `${uploadPct}%`, backgroundColor: "#8FB85C" }}
                            />
                          </div>
                          <p className="text-xs mt-1" style={{ color: "#5E6E69" }}>{uploadPct}%</p>
                        </div>
                      )}
                      {!videoFile && (
                        <div>
                          <p className="text-xs mb-1" style={{ color: "#5E6E69" }}>— or paste a YouTube / Google Drive link</p>
                          <input
                            type="url"
                            className="input-field text-xs"
                            placeholder="https://www.youtube.com/watch?v=… or https://drive.google.com/file/d/…"
                            value={videoUrlInput}
                            onChange={(e) => { setVideoUrlInput(e.target.value); setVideoUrlError(null); }}
                          />
                          {videoUrlError && (
                            <p className="mt-1 text-xs text-red-600">{videoUrlError}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {(lessonType === "slides" || lessonType === "doc" || lessonType === "lab") && (
                    <div>
                      <input
                        ref={resourceFileRef}
                        type="file"
                        accept={ACCEPT_BY_TYPE[lessonType]}
                        className="hidden"
                        onChange={(e) => setResourceFile(e.target.files?.[0] ?? null)}
                      />
                      <button
                        type="button"
                        onClick={() => resourceFileRef.current?.click()}
                        className="btn-secondary text-xs"
                      >
                        {resourceFile ? resourceFile.name : `Choose ${lessonType === "slides" ? "presentation (PPTX/PPT/PDF)" : lessonType === "doc" ? "document (DOCX/DOC/PDF)" : "lab file (PDF/DOCX/DOC)"}`}
                      </button>
                      {uploadPct !== null && (
                        <div className="mt-2">
                          <div className="w-full rounded-full h-1.5" style={{ backgroundColor: "#DDE6DF" }}>
                            <div
                              className="h-1.5 rounded-full transition-all"
                              style={{ width: `${uploadPct}%`, backgroundColor: "#8FB85C" }}
                            />
                          </div>
                          <p className="text-xs mt-1" style={{ color: "#5E6E69" }}>{uploadPct}%</p>
                        </div>
                      )}
                    </div>
                  )}

                  {lessonType === "text" && (
                    <textarea
                      className="input-field resize-none"
                      rows={4}
                      placeholder="Lesson content (HTML or Markdown)"
                      value={lessonText}
                      onChange={(e) => setLessonText(e.target.value)}
                    />
                  )}

                  {lessonType === "quiz" && (
                    <p className="text-xs" style={{ color: "#5E6E69" }}>
                      After adding the lesson, use the &quot;Set Up Quiz&quot; button to define questions.
                    </p>
                  )}

                  <div className="flex gap-2">
                    <button type="submit" disabled={saving} className="btn-primary text-xs">
                      {saving ? "Saving…" : "Add Lesson"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddingLessonTo(null)}
                      className="btn-secondary text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add module */}
      {addingModule ? (
        <form onSubmit={handleAddModule} className="card mt-4 space-y-3">
          <h2 className="font-medium" style={{ color: "#1E302C" }}>New Module</h2>
          <input
            className="input-field"
            placeholder="Module title"
            value={moduleTitle}
            onChange={(e) => setModuleTitle(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary text-xs">
              {saving ? "Adding…" : "Add Module"}
            </button>
            <button type="button" onClick={() => setAddingModule(false)} className="btn-secondary text-xs">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAddingModule(true)}
          className="mt-4 btn-secondary w-full"
        >
          + Add Module
        </button>
      )}
    </AdminShell>
  );
}
