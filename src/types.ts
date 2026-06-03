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
  createdAt: Timestamp;
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
  textContent?: string;    // HTML or Markdown for text lessons
  fileUrl?: string;        // For slides/doc/lab: public download URL
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
