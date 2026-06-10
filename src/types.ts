/**
 * Andela LMS — Shared TypeScript types
 * These types mirror the Firestore data model exactly.
 * Import these everywhere — never re-declare inline.
 */

import type { Timestamp } from "firebase/firestore";

// ─── User ────────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "learner";
export type UserStatus = "active" | "inactive" | "pending";

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  cohortIds: string[];
  status: UserStatus;
  createdAt: Timestamp;
}

// ─── Cohort ──────────────────────────────────────────────────────────────────

export interface Cohort {
  id: string;
  name: string;
  tag: string;         // short slug, e.g. "andela-2025-q1"
  color: string;       // hex color for UI badge
  courseIds: string[];
  createdAt: Timestamp;
  thumbPath?: string;  // Firebase Storage path for cohort thumbnail
}

// ─── Course ──────────────────────────────────────────────────────────────────

export type CourseStatus = "draft" | "published" | "archived";

export interface Course {
  id: string;
  title: string;
  description: string;
  status: CourseStatus;
  moduleOrder: string[];        // ordered list of module IDs
  assignedCohortIds: string[];
  /** Who can access a published course: assigned cohorts only (default) or
   *  every signed-in user. Admin-controlled from the course page. */
  availability?: "cohorts" | "all";
  createdAt: Timestamp;
  thumbPath?: string;           // Firebase Storage path for course thumbnail
  certTemplatePath?: string;    // Phase 3: Storage path to a custom certificate background (PNG/JPG)
  certTemplateTextColor?: "dark" | "light"; // overlay text color for the custom template
  certSignaturePath?: string;   // Storage path to a signature image (PNG/JPG)
  certSignatoryName?: string;   // e.g. "Jane Doe"
  certSignatoryTitle?: string;  // e.g. "Director of Learning, Andela"
}

// ─── Module (subcollection: courses/{id}/modules/{mid}) ──────────────────────

export interface CourseModule {
  id: string;
  title: string;
  order: number;
  lessonOrder: string[];        // ordered list of lesson IDs
}

// ─── Lesson (subcollection: courses/{id}/modules/{mid}/lessons/{lid}) ────────

export type LessonType = "video" | "text" | "slides" | "doc" | "lab" | "quiz";

export interface Lesson {
  id: string;
  title: string;
  type: LessonType;
  order: number;
  videoPath?: string;      // Firebase Storage path (not URL) — use VideoService.getPlaybackUrl()
  videoUrl?: string;       // External video URL (YouTube or Google Drive) — use toEmbedUrl() to embed
  textContent?: string;    // HTML or Markdown for text lessons
  fileUrl?: string;        // For slides/doc/lab: public download URL (legacy — prefer filePath)
  filePath?: string;       // Firebase Storage path for slides/doc/lab resources — use FileService.getResourceUrl()
  captionsPath?: string;   // Phase 3: Firebase Storage path to a WebVTT (.vtt) captions file
  transcript?: string;     // Phase 3: plain-text transcript shown below the video player
}

// ─── Enrollment ──────────────────────────────────────────────────────────────
// Document ID: `${userId}_${courseId}`

export interface Enrollment {
  userId: string;
  courseId: string;
  cohortId: string;
  progressPct: number;          // 0–100
  lastLessonId: string | null;
  updatedAt: Timestamp;
}

// ─── Progress ────────────────────────────────────────────────────────────────
// Document ID: `${userId}_${lessonId}`

export interface LessonProgress {
  userId: string;
  lessonId: string;
  courseId: string;
  watchedPct: number;           // 0–100, for video lessons
  positionSec: number;          // resume position in seconds
  completedAt: Timestamp | null;
}

// ─── Bulk Onboarding ─────────────────────────────────────────────────────────

export interface OnboardingRow {
  name: string;
  email: string;
  role: UserRole;
  cohort_tag: string;
}

export interface OnboardingResult {
  email: string;
  success: boolean;
  uid?: string;
  error?: string;
}

// ─── Mail (Trigger Email extension schema) ───────────────────────────────────
// Written to mail/{id}; consumed by Firebase Trigger Email extension.
// See: https://extensions.dev/extensions/firebase/firestore-send-email

export interface MailDoc {
  to: string;
  message: {
    subject: string;
    html: string;
    text: string;
  };
}

// ─── Assessments ─────────────────────────────────────────────────────────────

export type AssessmentKind = "pre" | "post" | "quiz";

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  type: "mcq" | "tf";
  options: string[];           // 2–6 strings; for "tf" typically ["True", "False"]
}

/**
 * assessments/{id}
 * Readable by authenticated learners (questions only — NO correct answers).
 */
export interface Assessment {
  id: string;
  courseId: string;
  kind: AssessmentKind;
  lessonId?: string;           // set when kind === "quiz"; unset for pre/post
  title: string;
  passMark: number;            // 0–100 percent required to pass
  questions: AssessmentQuestion[];
}

/**
 * assessmentKeys/{assessmentId}
 * Admin/function access ONLY — rules deny all client reads.
 * Stored separately so answers are never reachable by learners.
 */
export interface AssessmentKey {
  answers: Record<string, number>; // { [questionId]: correctOptionIndex }
}

/**
 * attempts/{uid_assessmentId_ts}
 * Written ONLY by the gradeAttempt Cloud Function via admin SDK.
 * Learners may read their own; admins read all.
 */
/**
 * certificates/{certId}
 * Written ONLY by the certificate Cloud Functions via admin SDK.
 * Single-doc reads are PUBLIC (the /verify/[certId] page); list queries are
 * restricted to admins or the owning learner.
 */
export interface Certificate {
  certId: string;
  userId: string;
  learnerName: string;
  courseId: string;
  courseTitle: string;
  issuedAt: Timestamp;
}

export interface Attempt {
  userId: string;
  assessmentId: string;
  courseId: string;
  kind: AssessmentKind;
  score: number;               // number of correct answers
  total: number;               // total number of questions
  passed: boolean;
  submittedAt: Timestamp;
  durationSec?: number | null; // time from opening the form to submitting (client-reported)
}
