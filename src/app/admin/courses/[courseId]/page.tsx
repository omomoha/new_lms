"use client";

/**
 * Course Builder — Admin
 * Lets admins add/reorder modules and lessons, and upload video for video lessons.
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
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { videoService } from "@/lib/video";
import type { Course, CourseModule, Lesson, LessonType } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";

const LESSON_TYPES: LessonType[] = ["video", "text", "slides", "doc", "lab", "quiz"];

export default function CourseBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const courseId = params.courseId as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [lessonMap, setLessonMap] = useState<Record<string, Lesson[]>>({});
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
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const courseSnap = await getDoc(doc(db, "courses", courseId));
      if (!courseSnap.exists()) { router.push("/admin/courses"); return; }
      const courseData = courseSnap.data() as Course;
      setCourse(courseData);

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
      // Update course moduleOrder
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
    setSaving(true); setError(null);
    try {
      const existingLessons = lessonMap[moduleId] ?? [];
      const order = existingLessons.length;

      let videoPath: string | undefined;
      if (lessonType === "video" && videoFile) {
        const path = `videos/${courseId}/${moduleId}/${Date.now()}_${videoFile.name}`;
        videoPath = await videoService.uploadVideo(videoFile, path, (p) =>
          setUploadPct(p.pct)
        );
        setUploadPct(null);
      }

      const lessonData: Omit<Lesson, "id"> = {
        title: lessonTitle.trim(),
        type: lessonType,
        order,
        ...(videoPath ? { videoPath } : {}),
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
      // Update module lessonOrder
      const newLOrder = [...existingLessons.map((l) => l.id), ref.id];
      await updateDoc(doc(db, "courses", courseId, "modules", moduleId), {
        lessonOrder: newLOrder,
      });

      setLessonTitle(""); setLessonText(""); setVideoFile(null);
      setAddingLessonTo(null);
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

  if (loading) return (
    <AdminShell>
      <div className="flex justify-center py-20"><Spinner /></div>
    </AdminShell>
  );

  if (!course) return null;

  return (
    <AdminShell>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-gray-900">{course.title}</h1>
          {course.description && (
            <p className="text-sm text-gray-500 mt-0.5">{course.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
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

      {/* Modules */}
      <div className="space-y-4">
        {modules.map((mod) => (
          <div key={mod.id} className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium text-gray-900">{mod.title}</h2>
              <button
                onClick={() => setAddingLessonTo(addingLessonTo === mod.id ? null : mod.id)}
                className="btn-secondary text-xs px-2.5 py-1"
              >
                + Lesson
              </button>
            </div>

            {/* Lesson list */}
            {(lessonMap[mod.id] ?? []).length > 0 ? (
              <ul className="space-y-1.5 mb-3">
                {(lessonMap[mod.id] ?? []).map((lesson) => (
                  <li
                    key={lesson.id}
                    className="flex items-center gap-2 text-sm text-gray-700 px-2 py-1.5 bg-gray-50 rounded-lg"
                  >
                    <span className="text-xs text-brand-accent font-medium uppercase">
                      {lesson.type}
                    </span>
                    <span>{lesson.title}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400 mb-3">No lessons yet.</p>
            )}

            {/* Add lesson form */}
            {addingLessonTo === mod.id && (
              <form
                onSubmit={(e) => handleAddLesson(e, mod.id)}
                className="border-t pt-3 space-y-3"
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
                  <div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
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
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-brand-accent h-1.5 rounded-full transition-all"
                            style={{ width: `${uploadPct}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{uploadPct}%</p>
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
        ))}
      </div>

      {/* Add module */}
      {addingModule ? (
        <form onSubmit={handleAddModule} className="card mt-4 space-y-3">
          <h2 className="font-medium">New Module</h2>
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
