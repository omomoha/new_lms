/**
 * aiCommon — shared infrastructure for all AI-powered Cloud Functions
 * (aiTutor, generateAssessment, gradeLab, flashcards, adminCopilot).
 *
 * Security model:
 *  - The Claude API key lives ONLY in the functions runtime env. If unset,
 *    callables fail with failed-precondition; nothing crashes at deploy.
 *  - PROMPT INJECTION: all course/lesson/user content is untrusted. It is
 *    passed to the model exclusively through fenceUntrusted(), which strips
 *    control chars, neutralises fence-collision attempts, caps length, and
 *    wraps the content in labelled tags with an explicit "data, not
 *    instructions" notice. System prompts are fixed server-side constants —
 *    never interpolate user input into them outside a fence.
 *  - RATE LIMITING: per-uid hourly windows in the aiUsage collection
 *    (client access denied by rules), enforced transactionally.
 *  - AUTHZ: requireAuth/requireAdmin/requireCourseAccess mirror the existing
 *    getSignedVideoUrl gate (published course + cohort membership).
 *  - Raw model/API errors are logged server-side and never echoed to clients.
 */

import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Anthropic from "@anthropic-ai/sdk";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

export const ENFORCE_APPCHECK = process.env.ENFORCE_APPCHECK === "true";
export const DEFAULT_MODEL = "claude-sonnet-4-6";

let client: Anthropic | null = null;

/** Lazily construct the Anthropic client; HttpsError if not configured. */
export function aiClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "AI features are not configured on this deployment."
    );
  }
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export function aiModel(): string {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

// ── Prompt-injection defenses ────────────────────────────────────────────────
// The primitives live in a dependency-free module (promptSafety) so they can be
// unit-tested without pulling in firebase-functions / the Anthropic SDK. Re-
// exported here so existing imports (`from "./aiCommon"`) keep working.
export { fenceUntrusted, capText } from "./promptSafety";

// ── Rate limiting (per uid, hourly window) ───────────────────────────────────

/**
 * Transactionally consume one unit of `feature` quota for `uid`.
 * Throws resource-exhausted when the hourly limit is reached.
 * Usage docs live in aiUsage/{uid} — denied to clients in firestore.rules.
 */
export async function consumeQuota(
  uid: string,
  feature: string,
  hourlyLimit: number
): Promise<void> {
  const ref = db.doc(`aiUsage/${uid}`);
  const hour = Math.floor(Date.now() / 3_600_000); // current hour bucket
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const bucket = (data[feature] ?? {}) as { hour?: number; count?: number };
    const count = bucket.hour === hour ? bucket.count ?? 0 : 0;
    if (count >= hourlyLimit) {
      throw new HttpsError(
        "resource-exhausted",
        "You've hit the hourly limit for this feature. Try again later."
      );
    }
    tx.set(
      ref,
      { [feature]: { hour, count: count + 1 } },
      { merge: true }
    );
  });
}

// ── AuthZ helpers ────────────────────────────────────────────────────────────

interface CallableAuth {
  uid: string;
  token: Record<string, unknown>;
}

export function requireAuth(auth: CallableAuth | undefined): CallableAuth {
  if (!auth) throw new HttpsError("unauthenticated", "Sign in required.");
  return auth;
}

export function requireAdmin(auth: CallableAuth | undefined): CallableAuth {
  const a = requireAuth(auth);
  if (a.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Admins only.");
  }
  return a;
}

/**
 * Learner gate: admin passes; otherwise the course must be published AND
 * assigned to one of the caller's cohorts (same rule as video delivery).
 */
export async function requireCourseAccess(
  auth: CallableAuth,
  courseId: string
): Promise<void> {
  if (auth.token.role === "admin") return;
  if (!courseId || !/^[A-Za-z0-9_-]+$/.test(courseId)) {
    throw new HttpsError("invalid-argument", "Invalid courseId.");
  }
  const [courseSnap, userSnap] = await Promise.all([
    db.doc(`courses/${courseId}`).get(),
    db.doc(`users/${auth.uid}`).get(),
  ]);
  if (!courseSnap.exists) throw new HttpsError("not-found", "Course not found.");
  const course = courseSnap.data() as {
    status?: string;
    availability?: string;
    assignedCohortIds?: string[];
  };
  const userCohorts: string[] = (userSnap.data()?.cohortIds as string[]) ?? [];
  const ok =
    course.status === "published" &&
    (course.availability === "all" ||
      (course.assignedCohortIds ?? []).some((c) => userCohorts.includes(c)));
  if (!ok) {
    throw new HttpsError("permission-denied", "You do not have access to this course.");
  }
}

// ── Model call wrapper ───────────────────────────────────────────────────────

export interface ClaudeCall {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
}

/** Call Claude; returns the text response. API errors → generic HttpsError. */
export async function callClaude(call: ClaudeCall): Promise<string> {
  try {
    const resp = await aiClient().messages.create({
      model: aiModel(),
      max_tokens: Math.min(call.maxTokens ?? 1024, 4096),
      temperature: call.temperature ?? 0.4,
      system: call.system,
      messages: call.messages,
    });
    return resp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("callClaude failed:", err);
    throw new HttpsError("internal", "The AI service is unavailable right now.");
  }
}

/** Extract the first top-level JSON object/array from model output. */
export function extractJson<T>(text: string): T | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  // walk to the matching close bracket
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Gather a course's lesson text content (for tutor/quiz context), capped. */
export async function collectCourseText(
  courseId: string,
  opts: { moduleId?: string; maxChars?: number } = {}
): Promise<string> {
  const maxChars = opts.maxChars ?? 40000;
  const modulesSnap = opts.moduleId
    ? null
    : await db.collection(`courses/${courseId}/modules`).orderBy("order").get();
  const moduleIds = opts.moduleId
    ? [opts.moduleId]
    : (modulesSnap?.docs.map((d) => d.id) ?? []);
  let out = "";
  for (const mid of moduleIds) {
    if (out.length >= maxChars) break;
    const lessonsSnap = await db
      .collection(`courses/${courseId}/modules/${mid}/lessons`)
      .orderBy("order")
      .get();
    for (const l of lessonsSnap.docs) {
      if (out.length >= maxChars) break;
      const d = l.data() as {
        title?: string;
        type?: string;
        content?: string;
        textContent?: string;
        transcript?: string;
        /** Extracted from uploaded PDF/DOCX/deck files by the conversion pipeline */
        extractedText?: string;
      };
      out += `\n## ${d.title ?? "Untitled lesson"}\n`;
      const body = [d.content, d.textContent, d.transcript, d.extractedText]
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .join("\n");
      if (body) out += body.slice(0, 8000) + "\n";
    }
  }
  return out.slice(0, maxChars);
}

/** A lesson's raw text fields in natural course order (for tutor retrieval). */
export interface CourseLesson {
  title?: string;
  content?: string;
  textContent?: string;
  transcript?: string;
  extractedText?: string;
}

/**
 * Gather a course's lessons as structured records in natural (module → lesson)
 * order, so the caller can do its own chunking/retrieval. Unlike
 * collectCourseText this does NOT pre-join or pre-cap bodies — selection happens
 * downstream. `maxLessons` caps how many lessons we read (protects huge courses).
 */
export async function collectCourseLessons(
  courseId: string,
  opts: { moduleId?: string; maxLessons?: number } = {}
): Promise<CourseLesson[]> {
  const maxLessons = opts.maxLessons ?? 500;
  const moduleIds = opts.moduleId
    ? [opts.moduleId]
    : (
        await db.collection(`courses/${courseId}/modules`).orderBy("order").get()
      ).docs.map((d) => d.id);

  const lessons: CourseLesson[] = [];
  for (const mid of moduleIds) {
    if (lessons.length >= maxLessons) break;
    const lessonsSnap = await db
      .collection(`courses/${courseId}/modules/${mid}/lessons`)
      .orderBy("order")
      .get();
    for (const l of lessonsSnap.docs) {
      if (lessons.length >= maxLessons) break;
      const d = l.data() as CourseLesson;
      lessons.push({
        title: d.title,
        content: d.content,
        textContent: d.textContent,
        transcript: d.transcript,
        extractedText: d.extractedText,
      });
    }
  }
  return lessons;
}

/**
 * Read an integer setting from settings/{docId}.{field}, clamped to
 * [min, max]; returns `fallback` when unset/invalid. Used e.g. for the tutor's
 * configurable hourly quota. Never throws — config problems must not break the
 * security/quota path.
 */
export async function readIntSetting(
  docId: string,
  field: string,
  fallback: number,
  bounds: { min: number; max: number } = { min: 1, max: 10000 }
): Promise<number> {
  try {
    const snap = await db.doc(`settings/${docId}`).get();
    const raw = snap.data()?.[field];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.floor(n);
    if (i < bounds.min || i > bounds.max) return fallback;
    return i;
  } catch {
    return fallback;
  }
}
