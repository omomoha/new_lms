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
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  arrayUnion,
  arrayRemove,
  where,
  deleteField,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import { videoService } from "@/lib/video";
import { uploadResource, ACCEPT_BY_TYPE } from "@/lib/files";
import type { Course, CourseModule, Lesson, LessonType, Cohort, Assessment, AssessmentKind } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import QuizEditor from "@/components/quiz/QuizEditor";
import { toEmbedUrl } from "@/lib/videoEmbed";
import { EntityThumb } from "@/components/ui/Thumb";
import { logAdminAction } from "@/lib/audit";
import { useAuth } from "@/contexts/AuthContext";

const LESSON_TYPES: LessonType[] = ["video", "text", "slides", "doc", "lab", "quiz"];

export default function CourseBuilderPage() {
  const params = useParams();
  const { user } = useAuth();
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

  // Phase 3: captions + transcript for video lessons
  const [captionsFile, setCaptionsFile] = useState<File | null>(null);
  const [transcriptInput, setTranscriptInput] = useState("");
  const captionsFileRef = useRef<HTMLInputElement>(null);

  // Phase 3: certificate template
  const certTemplateRef = useRef<HTMLInputElement>(null);
  const [certUploading, setCertUploading] = useState(false);
  const [certPreviewing, setCertPreviewing] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);

  // Certificate signature
  const certSignatureRef = useRef<HTMLInputElement>(null);
  const [sigUploading, setSigUploading] = useState(false);
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryTitle, setSignatoryTitle] = useState("");
  const [sigSaving, setSigSaving] = useState(false);
  const [sigSaved, setSigSaved] = useState(false);

  // Deletion state
  const [deletingCourse, setDeletingCourse] = useState(false);

  // Quiz editor: shown after a quiz lesson is created (or for editing)
  // key = lessonId, value = assessment or null if not yet created
  const [quizAssessments, setQuizAssessments] = useState<Record<string, Assessment | null>>({});
  // Which quiz lesson is currently showing its editor inline
  const [editingQuizLessonId, setEditingQuizLessonId] = useState<string | null>(null);

  // Pre/post assessments
  const [preAssessment, setPreAssessment] = useState<Assessment | null | undefined>(undefined);
  const [postAssessment, setPostAssessment] = useState<Assessment | null | undefined>(undefined);
  const [editingPrePost, setEditingPrePost] = useState<AssessmentKind | null>(null);

  // Thumbnail upload
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [thumbUploading, setThumbUploading] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const courseSnap = await getDoc(doc(db, "courses", courseId));
      if (!courseSnap.exists()) { router.push("/admin/courses"); return; }
      const courseData = courseSnap.data() as Course;
      setCourse(courseData);
      setSignatoryName(courseData.certSignatoryName ?? "");
      setSignatoryTitle(courseData.certSignatoryTitle ?? "");

      const cohortSnap = await getDocs(collection(db, "cohorts"));
      setCohorts(cohortSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Cohort)));

      const modSnap = await getDocs(
        query(collection(db, "courses", courseId, "modules"), orderBy("order"))
      );
      const mods = modSnap.docs.map((d) => ({ id: d.id, ...d.data() } as CourseModule));
      setModules(mods);

      // Perf: fetch every module's lessons in PARALLEL (was a serial waterfall)
      const lMap: Record<string, Lesson[]> = {};
      await Promise.all(
        mods.map(async (mod) => {
          const lSnap = await getDocs(
            query(collection(db, "courses", courseId, "modules", mod.id, "lessons"), orderBy("order"))
          );
          lMap[mod.id] = lSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lesson));
        })
      );
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

      // Phase 3: optional captions (.vtt) upload for video lessons
      let captionsPath: string | undefined;
      if (lessonType === "video" && captionsFile) {
        const cPath = `captions/${courseId}/${moduleId}/${Date.now()}_${captionsFile.name}`;
        captionsPath = await uploadResource(captionsFile, cPath);
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
        ...(captionsPath ? { captionsPath } : {}),
        ...(lessonType === "video" && transcriptInput.trim()
          ? { transcript: transcriptInput.trim() }
          : {}),
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
      setLessonTitle(""); setLessonText(""); setVideoFile(null); setVideoUrlInput(""); setVideoUrlError(null); setResourceFile(null); setCaptionsFile(null); setTranscriptInput("");
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

  const setAvailability = async (next: "cohorts" | "all") => {
    if (!course || (course.availability ?? "cohorts") === next) return;
    setError(null);
    try {
      await updateDoc(doc(db, "courses", courseId), { availability: next });
      setCourse({ ...course, availability: next });
      if (user) {
        void logAdminAction(
          { uid: user.uid, email: user.email },
          {
            action: "course.availability",
            targetType: "course",
            targetId: courseId,
            details:
              next === "all"
                ? `Opened "${course.title}" to ALL users`
                : `Restricted "${course.title}" to assigned cohorts`,
          }
        );
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update availability");
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

  // ── Phase 3: certificate template handlers ────────────────────────────────

  const handleCertTemplateUpload = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) {
      setCertError("Template must be a PNG or JPG image (A4 landscape, e.g. 2526×1785 px).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setCertError("Image must be under 5 MB.");
      return;
    }
    setCertUploading(true);
    setCertError(null);
    try {
      const ext = lower.split(".").pop();
      const path = `certTemplates/${courseId}_${Date.now()}.${ext}`;
      const storedPath = await uploadResource(file, path);
      await updateDoc(doc(db, "courses", courseId), {
        certTemplatePath: storedPath,
        certTemplateTextColor: course?.certTemplateTextColor ?? "dark",
      });
      setCourse((prev) => prev ? { ...prev, certTemplatePath: storedPath } : prev);
    } catch (err: unknown) {
      setCertError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setCertUploading(false);
    }
  };

  const handleCertTextColor = async (color: "dark" | "light") => {
    try {
      await updateDoc(doc(db, "courses", courseId), { certTemplateTextColor: color });
      setCourse((prev) => prev ? { ...prev, certTemplateTextColor: color } : prev);
    } catch (err: unknown) {
      setCertError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleCertTemplateRemove = async () => {
    try {
      await updateDoc(doc(db, "courses", courseId), {
        certTemplatePath: deleteField(),
        certTemplateTextColor: deleteField(),
      });
      setCourse((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        delete next.certTemplatePath;
        delete next.certTemplateTextColor;
        return next;
      });
    } catch (err: unknown) {
      setCertError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const handleSignatureUpload = async (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) {
      setCertError("Signature must be a PNG or JPG image (transparent PNG looks best).");
      return;
    }
    if (file.size > 1 * 1024 * 1024) {
      setCertError("Signature image must be under 1 MB.");
      return;
    }
    setSigUploading(true);
    setCertError(null);
    try {
      const ext = lower.split(".").pop();
      const path = `certTemplates/signatures/${courseId}_${Date.now()}.${ext}`;
      const storedPath = await uploadResource(file, path);
      await updateDoc(doc(db, "courses", courseId), { certSignaturePath: storedPath });
      setCourse((prev) => prev ? { ...prev, certSignaturePath: storedPath } : prev);
    } catch (err: unknown) {
      setCertError(err instanceof Error ? err.message : "Signature upload failed");
    } finally {
      setSigUploading(false);
    }
  };

  const handleSignatorySave = async () => {
    setSigSaving(true);
    setCertError(null);
    try {
      await updateDoc(doc(db, "courses", courseId), {
        certSignatoryName: signatoryName.trim(),
        certSignatoryTitle: signatoryTitle.trim(),
      });
      setCourse((prev) =>
        prev ? { ...prev, certSignatoryName: signatoryName.trim(), certSignatoryTitle: signatoryTitle.trim() } : prev
      );
      setSigSaved(true);
      setTimeout(() => setSigSaved(false), 2000);
    } catch (err: unknown) {
      setCertError(err instanceof Error ? err.message : "Failed to save signatory");
    } finally {
      setSigSaving(false);
    }
  };

  // ── Deletion handlers ─────────────────────────────────────────────────────

  const handleDeleteLesson = async (moduleId: string, lessonId: string, title: string) => {
    if (!window.confirm(`Delete lesson "${title}"? This cannot be undone.`)) return;
    setError(null);
    try {
      await deleteDoc(doc(db, "courses", courseId, "modules", moduleId, "lessons", lessonId));
      await updateDoc(doc(db, "courses", courseId, "modules", moduleId), {
        lessonOrder: arrayRemove(lessonId),
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete lesson");
    }
  };

  const handleDeleteModule = async (moduleId: string, title: string) => {
    const count = (lessonMap[moduleId] ?? []).length;
    if (!window.confirm(`Delete module "${title}"${count ? ` and its ${count} lesson${count !== 1 ? "s" : ""}` : ""}? This cannot be undone.`)) return;
    setError(null);
    try {
      await Promise.all(
        (lessonMap[moduleId] ?? []).map((l) =>
          deleteDoc(doc(db, "courses", courseId, "modules", moduleId, "lessons", l.id))
        )
      );
      await deleteDoc(doc(db, "courses", courseId, "modules", moduleId));
      await updateDoc(doc(db, "courses", courseId), { moduleOrder: arrayRemove(moduleId) });
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete module");
    }
  };

  const handleDeleteCourse = async () => {
    if (!course) return;
    if (!window.confirm(`Delete the entire course "${course.title}", including all modules and lessons? This cannot be undone.`)) return;
    if (!window.confirm("Are you absolutely sure? Learner progress records for this course will become orphaned.")) return;
    setDeletingCourse(true);
    setError(null);
    try {
      // Delete lessons + modules first (Firestore doesn't cascade)
      for (const mod of modules) {
        await Promise.all(
          (lessonMap[mod.id] ?? []).map((l) =>
            deleteDoc(doc(db, "courses", courseId, "modules", mod.id, "lessons", l.id))
          )
        );
        await deleteDoc(doc(db, "courses", courseId, "modules", mod.id));
      }
      // Detach from cohorts
      await Promise.all(
        cohorts
          .filter((c) => (course.assignedCohortIds ?? []).includes(c.id))
          .map((c) => updateDoc(doc(db, "cohorts", c.id), { courseIds: arrayRemove(courseId) }))
      );
      await deleteDoc(doc(db, "courses", courseId));
      router.push("/admin/courses");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete course");
      setDeletingCourse(false);
    }
  };

  const handleCertPreview = async () => {
    setCertPreviewing(true);
    setCertError(null);
    try {
      const fn = httpsCallable<{ courseId: string }, { url: string }>(functions, "previewCertificate");
      const { data } = await fn({ courseId });
      window.open(data.url, "_blank", "noopener");
    } catch (err: unknown) {
      console.error("previewCertificate failed:", err);
      setCertError("Preview failed — is the functions deploy up to date?");
    } finally {
      setCertPreviewing(false);
    }
  };

  const handleThumbUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setThumbError("Image must be under 2 MB.");
      return;
    }
    setThumbUploading(true);
    setThumbError(null);
    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `thumbnails/courses/${courseId}_${Date.now()}.${ext}`;
      const storedPath = await uploadResource(file, path);
      await updateDoc(doc(db, "courses", courseId), { thumbPath: storedPath });
      setCourse((prev) => prev ? { ...prev, thumbPath: storedPath } : prev);
    } catch (err: unknown) {
      setThumbError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setThumbUploading(false);
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
            <p className="mt-1 text-sm truncate text-brand-mist">
              {course.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          {/* Thumbnail upload */}
          <div className="flex items-center gap-2">
            {/* Preview */}
            <div className="h-16 w-24 rounded-lg overflow-hidden flex-shrink-0 border border-white/20">
              <EntityThumb
                thumbPath={course.thumbPath}
                seed={course.id}
                title={course.title}
                className="w-full h-full"
              />
            </div>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleThumbUpload(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={thumbUploading}
              onClick={() => thumbInputRef.current?.click()}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              {thumbUploading ? "Uploading…" : "Thumbnail"}
            </button>
          </div>
          {thumbError && (
            <p className="text-xs text-red-300 w-full text-right">{thumbError}</p>
          )}
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

      {/* Availability + cohort access */}
      <div className="card mb-4">
        <h2 className="font-medium mb-1 text-brand-ink">Availability</h2>
        <p className="text-xs mb-2 text-brand-muted">
          Who can access this course once it is <b>published</b>.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mb-4" role="radiogroup" aria-label="Course availability">
          {([
            {
              value: "cohorts" as const,
              title: "Assigned cohorts only",
              hint: "Default — learners need a cohort assignment below.",
            },
            {
              value: "all" as const,
              title: "All users",
              hint: "Every signed-in learner can take this course.",
            },
          ]).map((opt) => {
            const selected = (course?.availability ?? "cohorts") === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void setAvailability(opt.value)}
                className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                  selected
                    ? "bg-brand-mint border-brand-teal"
                    : "bg-white border-brand-line hover:border-brand-teal"
                }`}
              >
                <span className="flex items-center gap-2 font-medium text-sm text-brand-ink">
                  <span
                    aria-hidden="true"
                    className={`inline-block w-3.5 h-3.5 rounded-full border-2 ${
                      selected ? "border-brand-teal bg-brand-teal" : "border-brand-line bg-white"
                    }`}
                  />
                  {opt.title}
                </span>
                <span className="block text-xs text-brand-muted mt-0.5 pl-5.5 sm:pl-0">{opt.hint}</span>
              </button>
            );
          })}
        </div>
        <h2 className="font-medium mb-1 text-brand-ink">Cohort access</h2>
        <p className="text-xs mb-3 text-brand-muted">
          {course?.availability === "all"
            ? "Open to all users — cohort assignments below still drive due dates and reporting."
            : "Learners see this course only when it is published and assigned to one of their cohorts."}
        </p>
        {cohorts.length === 0 ? (
          <p className="text-xs text-brand-muted">
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
        <h2 className="font-medium mb-1 text-brand-ink">Pre / Post Assessments</h2>
        <p className="text-xs mb-4 text-brand-muted">
          Pre-assessment shown before learners start the course; post-assessment after 100% completion.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(["pre", "post"] as AssessmentKind[]).map((kind) => {
            const existing = kind === "pre" ? preAssessment : postAssessment;
            const isEditing = editingPrePost === kind;
            return (
              <div key={kind} className="rounded-lg p-3 border border-brand-line bg-brand-cream">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase text-brand-teal">
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
                    <p className="text-sm font-medium text-brand-ink">{existing.title}</p>
                    <p className="text-xs mt-0.5 text-brand-muted">
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

      {/* Phase 3: Certificate template */}
      <div className="card mb-4">
        <h2 className="font-medium mb-1 text-brand-ink">Certificate</h2>
        <p className="text-xs mb-3 text-brand-muted">
          Certificates are issued and emailed automatically when a learner completes the
          course (and passes the post-assessment, if one exists). By default they use the
          built-in Andela design — or upload your own background below. Use an A4-landscape
          PNG/JPG and keep the centre clear: the learner&apos;s name, course title, date, ID
          and verification link are overlaid automatically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={certTemplateRef}
            type="file"
            accept=".png,.jpg,.jpeg,image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleCertTemplateUpload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={certUploading}
            onClick={() => certTemplateRef.current?.click()}
            className="btn-secondary text-xs"
          >
            {certUploading
              ? "Uploading…"
              : course.certTemplatePath
              ? "Replace custom template"
              : "Upload custom template (PNG/JPG)"}
          </button>
          {course.certTemplatePath && (
            <>
              <label className="text-xs flex items-center gap-1.5 text-brand-muted">
                Overlay text:
                <select
                  className="input-field text-xs !py-1 !w-auto"
                  value={course.certTemplateTextColor ?? "dark"}
                  onChange={(e) => handleCertTextColor(e.target.value as "dark" | "light")}
                >
                  <option value="dark">Dark (light background)</option>
                  <option value="light">Light (dark background)</option>
                </select>
              </label>
              <button type="button" onClick={handleCertTemplateRemove} className="btn-secondary text-xs">
                Remove (use built-in design)
              </button>
            </>
          )}
          <button
            type="button"
            disabled={certPreviewing}
            onClick={handleCertPreview}
            className="btn-primary text-xs"
          >
            {certPreviewing ? "Generating…" : "Preview sample PDF"}
          </button>
          <Badge
            label={course.certTemplatePath ? "custom template" : "built-in design"}
            variant={course.certTemplatePath ? "success" : "warning"}
          />
        </div>
        {/* Signature block */}
        <div className="mt-4 pt-4 border-t border-brand-line">
          <h3 className="text-sm font-medium mb-1 text-brand-ink">Signature</h3>
          <p className="text-xs mb-3 text-brand-muted">
            Drawn at the bottom-left of every certificate for this course. Upload a signature
            image (transparent PNG recommended) and enter the signatory&apos;s name and title.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center flex-wrap">
            <input
              ref={certSignatureRef}
              type="file"
              accept=".png,.jpg,.jpeg,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleSignatureUpload(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={sigUploading}
              onClick={() => certSignatureRef.current?.click()}
              className="btn-secondary text-xs"
            >
              {sigUploading
                ? "Uploading…"
                : course.certSignaturePath
                ? "Replace signature image"
                : "Upload signature image"}
            </button>
            <input
              className="input-field text-xs sm:!w-48"
              placeholder="Signatory name"
              value={signatoryName}
              onChange={(e) => setSignatoryName(e.target.value)}
              aria-label="Signatory name"
            />
            <input
              className="input-field text-xs sm:!w-64"
              placeholder="Signatory title (e.g. Director of Learning)"
              value={signatoryTitle}
              onChange={(e) => setSignatoryTitle(e.target.value)}
              aria-label="Signatory title"
            />
            <button
              type="button"
              onClick={handleSignatorySave}
              disabled={sigSaving}
              className="btn-primary text-xs"
            >
              {sigSaving ? "Saving…" : sigSaved ? "Saved ✓" : "Save signatory"}
            </button>
          </div>
        </div>
        {certError && <p className="text-xs mt-2 text-red-600">{certError}</p>}
      </div>

      {/* Modules */}
      <div className="space-y-4">
        {modules.map((mod) => (
          <div key={mod.id} className="card overflow-hidden !p-0">
            {/* Module header strip */}
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-brand-line bg-brand-cream">
              <h2 className="font-semibold text-sm text-brand-primary">{mod.title}</h2>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setAddingLessonTo(addingLessonTo === mod.id ? null : mod.id)}
                  className="btn-secondary text-xs px-2.5 py-1"
                >
                  + Lesson
                </button>
                <button
                  onClick={() => handleDeleteModule(mod.id, mod.title)}
                  className="btn-secondary text-xs px-2.5 py-1 !text-red-700"
                  aria-label={`Delete module ${mod.title}`}
                  title="Delete module"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="px-4 sm:px-5 py-3">
              {/* Lesson list */}
              {(lessonMap[mod.id] ?? []).length > 0 ? (
                <ul className="space-y-1.5 mb-3">
                  {(lessonMap[mod.id] ?? []).map((lesson) => (
                    <li key={lesson.id}>
                      <div
                        className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg bg-brand-mint text-brand-ink"
                      >
                        <span className="text-xs font-semibold uppercase text-brand-teal">
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
                        <button
                          onClick={() => handleDeleteLesson(mod.id, lesson.id, lesson.title)}
                          className="text-xs px-1.5 py-0.5 rounded hover:bg-red-50 text-red-700"
                          aria-label={`Delete lesson ${lesson.title}`}
                          title="Delete lesson"
                        >
                          ✕
                        </button>
                      </div>
                      {/* Inline quiz editor for this lesson */}
                      {lesson.type === "quiz" && editingQuizLessonId === lesson.id && (
                        <div className="mt-2 pl-4 border-l-2 border-brand-accent">
                          <QuizEditor
                            courseId={courseId}
                            kind="quiz"
                            moduleId={mod.id}
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
                <p className="text-xs mb-3 text-brand-muted">No lessons yet.</p>
              )}

              {/* Add lesson form */}
              {addingLessonTo === mod.id && (
                <form
                  onSubmit={(e) => handleAddLesson(e, mod.id)}
                  className="border-t pt-3 space-y-3 border-brand-line"
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
                          <div className="w-full rounded-full h-1.5 bg-brand-line">
                            <div
                              className="h-1.5 rounded-full transition-all"
                              style={{ width: `${uploadPct}%`, backgroundColor: "#8FB85C" }}
                            />
                          </div>
                          <p className="text-xs mt-1 text-brand-muted">{uploadPct}%</p>
                        </div>
                      )}
                      {!videoFile && (
                        <div>
                          <p className="text-xs mb-1 text-brand-muted">— or paste a YouTube / Google Drive link</p>
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

                      {/* Phase 3: captions + transcript (uploaded videos only) */}
                      {videoFile && (
                        <div className="space-y-2 pt-1 border-t border-brand-line">
                          <input
                            ref={captionsFileRef}
                            type="file"
                            accept=".vtt,text/vtt"
                            className="hidden"
                            onChange={(e) => setCaptionsFile(e.target.files?.[0] ?? null)}
                          />
                          <button
                            type="button"
                            onClick={() => captionsFileRef.current?.click()}
                            className="btn-secondary text-xs"
                          >
                            {captionsFile ? `Captions: ${captionsFile.name}` : "Add captions (.vtt) — optional"}
                          </button>
                          <textarea
                            className="input-field resize-none text-xs"
                            rows={3}
                            placeholder="Transcript (optional) — shown below the video for accessibility"
                            value={transcriptInput}
                            onChange={(e) => setTranscriptInput(e.target.value)}
                            aria-label="Video transcript"
                          />
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
                          <div className="w-full rounded-full h-1.5 bg-brand-line">
                            <div
                              className="h-1.5 rounded-full transition-all"
                              style={{ width: `${uploadPct}%`, backgroundColor: "#8FB85C" }}
                            />
                          </div>
                          <p className="text-xs mt-1 text-brand-muted">{uploadPct}%</p>
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
                    <p className="text-xs text-brand-muted">
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
          <h2 className="font-medium text-brand-ink">New Module</h2>
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

      {/* Danger zone */}
      <div className="card mt-8 border-red-300">
        <h2 className="font-medium mb-1 text-red-700">Danger zone</h2>
        <p className="text-xs mb-3 text-brand-muted">
          Permanently delete this course, all its modules and lessons, and remove it from
          assigned cohorts. Uploaded video/document files remain in storage.
        </p>
        <button
          onClick={handleDeleteCourse}
          disabled={deletingCourse}
          className="btn-secondary text-xs !text-red-700 border-red-300"
        >
          {deletingCourse ? "Deleting…" : "Delete this course"}
        </button>
      </div>
    </AdminShell>
  );
}
