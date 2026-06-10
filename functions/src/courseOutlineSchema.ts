/**
 * courseOutlineSchema — strict validation of AI-generated course scaffolds.
 * Pure (no firebase imports) so it is unit-testable from the root vitest
 * setup, mirroring quizSchema.ts / labRubric.ts.
 *
 * Model output is untrusted: only known keys survive, every field is
 * type-checked, length-capped, and counts are bounded. Objects are REBUILT
 * (never passed through) so nothing extra can ride along.
 */

export type GeneratedLessonType = "text" | "video" | "lab" | "quiz";

export interface GeneratedLesson {
  title: string;
  type: GeneratedLessonType;
  /** Drafted markdown body — only present for text/lab lessons. */
  content?: string;
}

export interface GeneratedModule {
  title: string;
  lessons: GeneratedLesson[];
}

export interface GeneratedCourse {
  title: string;
  description: string;
  modules: GeneratedModule[];
}

export type ValidationResult =
  | { ok: true; course: GeneratedCourse }
  | { ok: false; error: string };

const LESSON_TYPES = new Set<GeneratedLessonType>(["text", "video", "lab", "quiz"]);
const MAX_MODULES = 12;
const MAX_LESSONS_PER_MODULE = 15;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 1000;
const MAX_CONTENT = 12000;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasForbiddenKeys(obj: Record<string, unknown>): boolean {
  return Object.getOwnPropertyNames(obj).some((k) => FORBIDDEN_KEYS.has(k));
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

export function validateGeneratedCourse(raw: unknown): ValidationResult {
  if (!isPlainObject(raw)) return { ok: false, error: "not an object" };
  if (hasForbiddenKeys(raw)) return { ok: false, error: "forbidden keys" };

  const title = cleanString(raw.title, MAX_TITLE);
  if (!title) return { ok: false, error: "invalid course title" };

  const description =
    raw.description === undefined ? "" : cleanString(raw.description, MAX_DESCRIPTION);
  if (description === null) return { ok: false, error: "invalid description" };

  if (!Array.isArray(raw.modules) || raw.modules.length < 1 || raw.modules.length > MAX_MODULES) {
    return { ok: false, error: `modules must be an array of 1–${MAX_MODULES}` };
  }

  const modules: GeneratedModule[] = [];
  for (const rawMod of raw.modules) {
    if (!isPlainObject(rawMod)) return { ok: false, error: "module is not an object" };
    if (hasForbiddenKeys(rawMod)) return { ok: false, error: "forbidden keys in module" };

    const modTitle = cleanString(rawMod.title, MAX_TITLE);
    if (!modTitle) return { ok: false, error: "invalid module title" };

    if (
      !Array.isArray(rawMod.lessons) ||
      rawMod.lessons.length < 1 ||
      rawMod.lessons.length > MAX_LESSONS_PER_MODULE
    ) {
      return { ok: false, error: `lessons must be an array of 1–${MAX_LESSONS_PER_MODULE}` };
    }

    const lessons: GeneratedLesson[] = [];
    for (const rawLesson of rawMod.lessons) {
      if (!isPlainObject(rawLesson)) return { ok: false, error: "lesson is not an object" };
      if (hasForbiddenKeys(rawLesson)) return { ok: false, error: "forbidden keys in lesson" };

      const lessonTitle = cleanString(rawLesson.title, MAX_TITLE);
      if (!lessonTitle) return { ok: false, error: "invalid lesson title" };

      const type = rawLesson.type;
      if (typeof type !== "string" || !LESSON_TYPES.has(type as GeneratedLessonType)) {
        return { ok: false, error: `invalid lesson type "${String(rawLesson.type)}"` };
      }

      let content: string | undefined;
      if (rawLesson.content !== undefined && rawLesson.content !== null) {
        const cleaned = cleanString(rawLesson.content, MAX_CONTENT);
        if (cleaned === null) return { ok: false, error: "invalid lesson content" };
        // Drafted bodies only make sense for text/lab lessons
        if (type === "text" || type === "lab") content = cleaned;
      }

      lessons.push({
        title: lessonTitle,
        type: type as GeneratedLessonType,
        ...(content ? { content } : {}),
      });
    }

    modules.push({ title: modTitle, lessons });
  }

  return { ok: true, course: { title, description, modules } };
}
