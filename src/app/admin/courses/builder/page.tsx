"use client";

/**
 * AI Course Builder — paste a syllabus/outline, review the generated
 * scaffold, prune/edit, then create the course in one click.
 *
 * Flow:
 *  1. Admin pastes an outline (+ optional title hint) → generateCourseOutline
 *     callable returns { course } (nothing written server-side).
 *  2. Review UI: editable course title/description, per-lesson include
 *     checkboxes and editable titles, type badges.
 *  3. "Create course" writes course → modules → lessons with the exact same
 *     doc shapes as the manual course editor, status "draft", then redirects
 *     to the course page for upload/publish.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import functions from "@/lib/firebase/functions";
import AdminShell from "@/components/layout/AdminShell";

type LessonType = "text" | "video" | "lab" | "quiz";

interface DraftLesson {
  title: string;
  type: LessonType;
  content?: string;
  include: boolean;
}

interface DraftModule {
  title: string;
  lessons: DraftLesson[];
  include: boolean;
}

interface GenerateResponse {
  course: {
    title: string;
    description: string;
    modules: Array<{
      title: string;
      lessons: Array<{ title: string; type: LessonType; content?: string }>;
    }>;
  };
}

const TYPE_BADGE: Record<LessonType, string> = {
  text: "bg-brand-mint text-brand-primary",
  video: "bg-brand-primary text-brand-mint",
  lab: "bg-amber-100 text-amber-800",
  quiz: "bg-brand-teal text-white",
};

export default function CourseBuilderPage() {
  const router = useRouter();

  const [outline, setOutline] = useState("");
  const [titleHint, setTitleHint] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Review state
  const [courseTitle, setCourseTitle] = useState("");
  const [courseDescription, setCourseDescription] = useState("");
  const [modules, setModules] = useState<DraftModule[] | null>(null);

  const [creating, setCreating] = useState(false);
  const [createStep, setCreateStep] = useState("");

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const call = httpsCallable<{ outline: string; titleHint?: string }, GenerateResponse>(
        functions,
        "generateCourseOutline"
      );
      const res = await call({
        outline,
        ...(titleHint.trim() ? { titleHint: titleHint.trim() } : {}),
      });
      const c = res.data.course;
      setCourseTitle(c.title);
      setCourseDescription(c.description);
      setModules(
        c.modules.map((m) => ({
          title: m.title,
          include: true,
          lessons: m.lessons.map((l) => ({ ...l, include: true })),
        }))
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      setError(
        code.includes("resource-exhausted")
          ? "You've hit the hourly limit for course generation. Try again later."
          : code.includes("failed-precondition")
          ? "AI features are not configured on this deployment."
          : err instanceof Error
          ? err.message
          : "Generation failed. Try again."
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleCreate = async () => {
    if (!modules || !courseTitle.trim()) return;
    setError(null);
    setCreating(true);
    try {
      // 1. Course doc (same shape as the manual create form; draft status)
      setCreateStep("Creating course…");
      const courseRef = await addDoc(collection(db, "courses"), {
        title: courseTitle.trim(),
        description: courseDescription.trim(),
        status: "draft",
        moduleOrder: [],
        assignedCohortIds: [],
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "courses", courseRef.id), { id: courseRef.id });

      // 2. Modules + lessons, preserving order
      const moduleOrder: string[] = [];
      const includedModules = modules.filter(
        (m) => m.include && m.lessons.some((l) => l.include)
      );
      for (let mi = 0; mi < includedModules.length; mi++) {
        const m = includedModules[mi];
        setCreateStep(`Creating module ${mi + 1} of ${includedModules.length}…`);
        const modRef = await addDoc(
          collection(db, "courses", courseRef.id, "modules"),
          { title: m.title.trim(), order: mi, lessonOrder: [] }
        );
        await updateDoc(
          doc(db, "courses", courseRef.id, "modules", modRef.id),
          { id: modRef.id }
        );
        moduleOrder.push(modRef.id);

        const included = m.lessons.filter((l) => l.include);
        const lessonOrder: string[] = [];
        for (let li = 0; li < included.length; li++) {
          const l = included[li];
          const lessonRef = await addDoc(
            collection(db, "courses", courseRef.id, "modules", modRef.id, "lessons"),
            {
              title: l.title.trim(),
              type: l.type,
              order: li,
              // Drafted markdown body: text lessons render it directly; for
              // lab lessons it doubles as the AI-grading exercise brief.
              ...((l.type === "text" || l.type === "lab") && l.content
                ? { textContent: l.content }
                : {}),
            }
          );
          await updateDoc(
            doc(db, "courses", courseRef.id, "modules", modRef.id, "lessons", lessonRef.id),
            { id: lessonRef.id }
          );
          lessonOrder.push(lessonRef.id);
        }
        await updateDoc(doc(db, "courses", courseRef.id, "modules", modRef.id), {
          lessonOrder,
        });
      }
      await updateDoc(doc(db, "courses", courseRef.id), { moduleOrder });

      router.push(`/admin/courses/${courseRef.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Course creation failed");
      setCreating(false);
      setCreateStep("");
    }
  };

  const lessonCount =
    modules?.reduce(
      (n, m) => n + (m.include ? m.lessons.filter((l) => l.include).length : 0),
      0
    ) ?? 0;

  return (
    <AdminShell>
      <div className="page-hero">
        <span className="kicker">ADMIN · COURSES · AI BUILDER</span>
        <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
          Build a course from an outline
        </h1>
        <p className="mt-1 text-sm text-brand-mist">
          Paste a syllabus — get modules, typed lessons and drafted content to
          review before anything is created.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {!modules ? (
        /* ── Step 1: outline input ─────────────────────────────────────── */
        <div className="card space-y-3">
          <label htmlFor="title-hint" className="block text-sm font-medium text-brand-ink">
            Course title (optional)
          </label>
          <input
            id="title-hint"
            className="input-field"
            placeholder="e.g. Docker for Backend Engineers"
            value={titleHint}
            onChange={(e) => setTitleHint(e.target.value)}
            maxLength={200}
          />
          <label htmlFor="outline" className="block text-sm font-medium text-brand-ink">
            Outline / syllabus
          </label>
          <textarea
            id="outline"
            className="input-field font-mono text-sm resize-y"
            rows={14}
            placeholder={
              "Paste your outline, syllabus or curriculum notes…\n\n" +
              "Week 1: Containers from first principles\n" +
              "- Why containers, images vs containers\n" +
              "- Hands-on: containerise a Node service\n" +
              "Week 2: …"
            }
            value={outline}
            onChange={(e) => setOutline(e.target.value)}
            maxLength={24000}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-brand-muted">{outline.length.toLocaleString()} / 24,000 characters</p>
            <button
              type="button"
              className="btn-primary"
              disabled={generating || outline.trim().length < 40}
              onClick={handleGenerate}
            >
              {generating ? "Designing course…" : "✨ Generate course"}
            </button>
          </div>
          {generating && (
            <p className="text-xs text-brand-muted" aria-live="polite">
              Drafting modules and lesson content — this can take up to a minute for long outlines.
            </p>
          )}
        </div>
      ) : (
        /* ── Step 2: review + create ───────────────────────────────────── */
        <div className="space-y-4">
          <div className="card space-y-3">
            <label htmlFor="course-title" className="block text-sm font-medium text-brand-ink">
              Course title
            </label>
            <input
              id="course-title"
              className="input-field"
              value={courseTitle}
              onChange={(e) => setCourseTitle(e.target.value)}
              maxLength={200}
              required
            />
            <label htmlFor="course-desc" className="block text-sm font-medium text-brand-ink">
              Description
            </label>
            <textarea
              id="course-desc"
              className="input-field resize-none"
              rows={2}
              value={courseDescription}
              onChange={(e) => setCourseDescription(e.target.value)}
              maxLength={1000}
            />
          </div>

          {modules.map((m, mi) => (
            <div key={mi} className={`card ${m.include ? "" : "opacity-50"}`}>
              <div className="flex items-center gap-3 mb-3">
                <input
                  type="checkbox"
                  id={`mod-${mi}`}
                  checked={m.include}
                  onChange={(e) =>
                    setModules((prev) =>
                      prev!.map((pm, i) => (i === mi ? { ...pm, include: e.target.checked } : pm))
                    )
                  }
                  aria-label={`Include module ${m.title}`}
                />
                <input
                  className="input-field !py-1.5 font-medium flex-1"
                  value={m.title}
                  onChange={(e) =>
                    setModules((prev) =>
                      prev!.map((pm, i) => (i === mi ? { ...pm, title: e.target.value } : pm))
                    )
                  }
                  maxLength={200}
                  aria-label={`Module ${mi + 1} title`}
                />
              </div>
              <ul className="space-y-2">
                {m.lessons.map((l, li) => (
                  <li key={li} className={`flex items-center gap-2 ${l.include ? "" : "opacity-50"}`}>
                    <input
                      type="checkbox"
                      checked={l.include}
                      onChange={(e) =>
                        setModules((prev) =>
                          prev!.map((pm, i) =>
                            i === mi
                              ? {
                                  ...pm,
                                  lessons: pm.lessons.map((pl, j) =>
                                    j === li ? { ...pl, include: e.target.checked } : pl
                                  ),
                                }
                              : pm
                          )
                        )
                      }
                      aria-label={`Include lesson ${l.title}`}
                    />
                    <span
                      className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${TYPE_BADGE[l.type]}`}
                    >
                      {l.type}
                    </span>
                    <input
                      className="input-field !py-1 text-sm flex-1"
                      value={l.title}
                      onChange={(e) =>
                        setModules((prev) =>
                          prev!.map((pm, i) =>
                            i === mi
                              ? {
                                  ...pm,
                                  lessons: pm.lessons.map((pl, j) =>
                                    j === li ? { ...pl, title: e.target.value } : pl
                                  ),
                                }
                              : pm
                          )
                        )
                      }
                      maxLength={200}
                      aria-label={`Lesson title`}
                    />
                    {l.content && (
                      <span className="text-xs text-brand-teal flex-shrink-0" title="Drafted content included">
                        ✓ drafted
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-sm text-brand-muted">
              {lessonCount} lesson{lessonCount !== 1 ? "s" : ""} across{" "}
              {modules.filter((m) => m.include).length} module
              {modules.filter((m) => m.include).length !== 1 ? "s" : ""} — created as a{" "}
              <b className="text-brand-ink">draft</b>. Video uploads and quiz questions are added
              afterwards on the course page.
            </p>
            <div className="flex gap-2 flex-shrink-0">
              <button
                type="button"
                className="btn-secondary text-sm"
                disabled={creating}
                onClick={() => setModules(null)}
              >
                ← Back to outline
              </button>
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={creating || !courseTitle.trim() || lessonCount === 0}
                onClick={handleCreate}
              >
                {creating ? createStep || "Creating…" : "Create course"}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-brand-muted">
        Prefer the manual editor? <Link href="/admin/courses" className="text-brand-teal hover:underline">Back to Course Library</Link>
      </p>
    </AdminShell>
  );
}
