/**
 * gradeAttempt — Callable Cloud Function
 *
 * Called from the learner quiz/assessment UI with their submitted answers.
 * Loads the assessment questions + answer key via admin SDK (bypassing Firestore rules),
 * grades the submission, writes an `attempts` doc, and returns the result.
 *
 * Security:
 *  - Requires Firebase Auth (request.auth must be present).
 *  - Authorization: caller must be admin OR the course must be published and
 *    assigned to one of the caller's cohorts.
 *  - assessmentKeys docs are NEVER readable by clients; only this function reads them.
 *  - attempts docs are written ONLY here via admin SDK; client writes are denied by rules.
 *  - Rate-limited: rejects if caller submitted this assessment within the last 30 s.
 *  - attemptId format: "{uid}_{assessmentId}_{uuid}" — rules use the uid_ prefix.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { randomUUID } from "node:crypto";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

interface GradeAttemptRequest {
  assessmentId: string;
  answers: Record<string, number>; // { [questionId]: selectedOptionIndex }
}

interface PerQuestion {
  [questionId: string]: boolean;
}

interface GradeAttemptResponse {
  score: number;
  total: number;
  passed: boolean;
  perQuestion: PerQuestion;
}

export const gradeAttempt = onCall<GradeAttemptRequest>(
  { region: "us-central1", enforceAppCheck: process.env.ENFORCE_APPCHECK === "true" },
  async (request): Promise<GradeAttemptResponse> => {
    // Must be authenticated
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in to submit an assessment.");
    }

    const uid = request.auth.uid;
    const { assessmentId, answers } = request.data;

    if (!assessmentId || typeof assessmentId !== "string") {
      throw new HttpsError("invalid-argument", "assessmentId is required.");
    }

    // Validate answers: must be a non-empty object with all-number values
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      throw new HttpsError("invalid-argument", "answers must be an object.");
    }
    if (Object.keys(answers).length === 0) {
      throw new HttpsError("invalid-argument", "answers must not be empty.");
    }
    for (const val of Object.values(answers)) {
      if (typeof val !== "number") {
        throw new HttpsError("invalid-argument", "Every answer value must be a number.");
      }
    }

    // Load assessment doc (questions, metadata)
    const assessmentSnap = await db.doc(`assessments/${assessmentId}`).get();
    if (!assessmentSnap.exists) {
      throw new HttpsError("not-found", `Assessment ${assessmentId} not found.`);
    }
    const assessment = assessmentSnap.data() as {
      courseId: string;
      kind: string;
      questions: Array<{ id: string }>;
      passMark: number;
    };

    // Validate that assessment has a non-empty questions array
    if (
      !Array.isArray(assessment.questions) ||
      assessment.questions.length === 0
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Assessment has no questions configured."
      );
    }

    // Validate answer count does not exceed question count
    if (Object.keys(answers).length > assessment.questions.length) {
      throw new HttpsError(
        "invalid-argument",
        "answers contains more entries than there are questions."
      );
    }

    // ── Authorization ────────────────────────────────────────────────────────
    // Allow if caller is admin OR course is published and assigned to caller's cohorts
    const callerClaim = request.auth.token?.role as string | undefined;
    const isAdmin = callerClaim === "admin";

    if (!isAdmin) {
      // Load caller's user doc to check cohortIds
      const userSnap = await db.doc(`users/${uid}`).get();
      if (!userSnap.exists) {
        throw new HttpsError("permission-denied", "User record not found.");
      }
      const userData = userSnap.data() as { cohortIds?: string[] };

      // Load course doc to check status and assignedCohortIds
      const courseSnap = await db.doc(`courses/${assessment.courseId}`).get();
      if (!courseSnap.exists) {
        throw new HttpsError("permission-denied", "Course not found.");
      }
      const courseData = courseSnap.data() as {
        status: string;
        assignedCohortIds?: string[];
      };

      const callerCohorts = userData.cohortIds ?? [];
      const courseCohorts = courseData.assignedCohortIds ?? [];
      const hasOverlap = callerCohorts.some((c) => courseCohorts.includes(c));

      if (courseData.status !== "published" || !hasOverlap) {
        throw new HttpsError(
          "permission-denied",
          "You are not enrolled in this course."
        );
      }
    }

    // ── Rate limit: reject if latest attempt within last 30 seconds ──────────
    const recentSnap = await db
      .collection("attempts")
      .where("userId", "==", uid)
      .where("assessmentId", "==", assessmentId)
      .orderBy("submittedAt", "desc")
      .limit(1)
      .get();

    if (!recentSnap.empty) {
      const latest = recentSnap.docs[0].data() as {
        submittedAt?: admin.firestore.Timestamp;
      };
      if (latest.submittedAt) {
        const secondsAgo =
          (Date.now() - latest.submittedAt.toMillis()) / 1000;
        if (secondsAgo < 30) {
          throw new HttpsError(
            "resource-exhausted",
            "Please wait before retrying."
          );
        }
      }
    }

    // Load answer key (admin SDK — bypasses rules)
    const keySnap = await db.doc(`assessmentKeys/${assessmentId}`).get();
    if (!keySnap.exists) {
      throw new HttpsError("not-found", `Answer key for ${assessmentId} not found.`);
    }
    const { answers: correctAnswers } = keySnap.data() as { answers: Record<string, number> };

    // Grade
    const questions = assessment.questions;
    let score = 0;
    const perQuestion: PerQuestion = {};

    for (const q of questions) {
      const correct = correctAnswers[q.id];
      const submitted = answers[q.id];
      const isCorrect = submitted !== undefined && submitted === correct;
      perQuestion[q.id] = isCorrect;
      if (isCorrect) score++;
    }

    const total = questions.length;
    const passMark = assessment.passMark ?? 70;
    const passed = total > 0 ? (score / total) * 100 >= passMark : false;

    // Write attempt doc — uid_ prefix required by Firestore rules
    const attemptId = `${uid}_${assessmentId}_${randomUUID()}`;
    await db.doc(`attempts/${attemptId}`).set({
      userId: uid,
      assessmentId,
      courseId: assessment.courseId,
      kind: assessment.kind,
      score,
      total,
      passed,
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { score, total, passed, perQuestion };
  }
);
