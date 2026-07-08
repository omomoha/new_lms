/**
 * analyticsAggregation — Scheduled Cloud Function (2nd-gen), hourly.
 *
 * Rolls platform-wide engagement, completion, at-risk, quiz and AI-tutor metrics
 * into pre-computed docs under the `analytics/` collection so the admin
 * dashboard reads a handful of cheap docs instead of scanning enrollments /
 * progress / attempts live at page load (critical at ~5k learners).
 *
 * Written docs (all server-side; rules deny client writes):
 *   analytics/overview          — platform totals, DAU/WAU, completion, AI usage,
 *                                 top at-risk learners, top courses by completion.
 *   analytics/course_{courseId} — per-course funnel, avg progress, quiz pass rate.
 *   analytics/cohort_{cohortId} — per-cohort active learners, completion, avg
 *                                 progress, at-risk count.
 *
 * Pattern mirrors weeklyDigest/dailySignupAlert (onSchedule, admin SDK). All
 * heavy math is delegated to the pure, unit-tested analyticsRollup module.
 *
 * Bounding for scale: collections are read with .get() (full scans) which is the
 * same approach weeklyDigest/learnerReminders already use. At 5k learners these
 * are tens-of-thousands of docs read ONCE PER HOUR by ONE function — far cheaper
 * than every admin page load scanning them. If the platform grows an order of
 * magnitude, switch to incremental/windowed reads (documented as a follow-up).
 *
 * REQUIREMENTS:
 *   • Cloud Scheduler API enabled (same as weeklyDigest).
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import {
  activeLearners,
  completionFunnel,
  avgProgress,
  timeOnTask,
  quizPassRate,
  detectAtRisk,
  rollupAiUsage,
  type EnrollmentRec,
  type ProgressRec,
  type AttemptRec,
  type AtRiskLearner,
} from "./analyticsRollup";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

/** Max at-risk learners stored inline on analytics/overview (the rest are in
 *  the per-cohort counts; the dashboard drills down by re-querying if needed). */
const MAX_ATRISK_INLINE = 200;
/** Max courses listed inline on the overview completion table. */
const MAX_COURSES_INLINE = 50;

function ms(ts: admin.firestore.Timestamp | undefined | null): number | null {
  return ts instanceof admin.firestore.Timestamp ? ts.toMillis() : null;
}

/**
 * Resolve the earliest due date (ms) for each (course) from cohort
 * courseDueDates maps, keyed by cohortId. Mirrors src/lib/dueDates.resolveDueDate
 * but server-side and indexed by cohort so a learner's enrollment.cohortId picks
 * the right map.
 */
function buildDueDateLookup(
  cohortDocs: admin.firestore.QueryDocumentSnapshot[]
): Map<string, Map<string, number>> {
  const byCohort = new Map<string, Map<string, number>>();
  for (const c of cohortDocs) {
    const due = c.data().courseDueDates as
      | Record<string, admin.firestore.Timestamp>
      | undefined;
    if (!due) continue;
    const courseMap = new Map<string, number>();
    for (const [courseId, ts] of Object.entries(due)) {
      const m = ms(ts);
      if (m != null) courseMap.set(courseId, m);
    }
    byCohort.set(c.id, courseMap);
  }
  return byCohort;
}

export const analyticsAggregation = onSchedule(
  {
    schedule: "every 1 hours",
    timeZone: "Africa/Lagos",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const nowMs = Date.now();

    // ── Read raw collections (once) ───────────────────────────────────────────
    const [
      enrollSnap,
      progressSnap,
      attemptsSnap,
      cohortSnap,
      coursesSnap,
      learnersAgg,
      tutorConvSnap,
      tutorFeedbackSnap,
    ] = await Promise.all([
      db.collection("enrollments").get(),
      db.collection("progress").get(),
      db.collection("attempts").get(),
      db.collection("cohorts").get(),
      db.collection("courses").get(),
      db.collection("users").where("role", "==", "learner").count().get(),
      db.collectionGroup("tutorConversations").get(),
      db.collection("tutorFeedback").get(),
    ]);

    const courseTitles = new Map<string, string>();
    for (const c of coursesSnap.docs) {
      courseTitles.set(c.id, (c.data().title as string) || "Untitled course");
    }
    const cohortNames = new Map<string, string>();
    for (const c of cohortSnap.docs) {
      cohortNames.set(c.id, (c.data().name as string) || "Unnamed cohort");
    }

    const dueLookup = buildDueDateLookup(cohortSnap.docs);

    // ── Map raw docs into pure-function records ───────────────────────────────
    const enrollments: EnrollmentRec[] = enrollSnap.docs.map((d) => {
      const data = d.data();
      const cohortId = (data.cohortId as string) ?? null;
      const courseId = data.courseId as string;
      const dueAtMs =
        cohortId != null ? dueLookup.get(cohortId)?.get(courseId) ?? null : null;
      return {
        userId: data.userId as string,
        courseId,
        cohortId,
        progressPct: Number(data.progressPct) || 0,
        updatedAtMs: ms(data.updatedAt as admin.firestore.Timestamp),
        dueAtMs,
      };
    });

    const progress: ProgressRec[] = progressSnap.docs.map((d) => {
      const data = d.data();
      return {
        userId: data.userId as string,
        lessonId: data.lessonId as string,
        courseId: data.courseId as string,
        positionSec: Number(data.positionSec) || 0,
        completedAtMs: ms(data.completedAt as admin.firestore.Timestamp),
        // progress docs don't carry a generic updatedAt; completedAt is the best
        // activity signal we persist, so reuse it for recency.
        updatedAtMs: ms(data.completedAt as admin.firestore.Timestamp),
      };
    });

    const attempts: AttemptRec[] = attemptsSnap.docs.map((d) => {
      const data = d.data();
      return {
        userId: data.userId as string,
        courseId: data.courseId as string,
        passed: data.passed === true,
        submittedAtMs: ms(data.submittedAt as admin.firestore.Timestamp),
      };
    });

    // attempts grouped by `${userId}_${courseId}` for at-risk low-score check
    const attemptsByLearnerCourse = new Map<string, AttemptRec[]>();
    for (const a of attempts) {
      const key = `${a.userId}_${a.courseId}`;
      const arr = attemptsByLearnerCourse.get(key);
      if (arr) arr.push(a);
      else attemptsByLearnerCourse.set(key, [a]);
    }

    // ── Platform-wide rollups ─────────────────────────────────────────────────
    const dauwau = activeLearners(progress, nowMs);
    const overallFunnel = completionFunnel(enrollments);
    const overallTime = timeOnTask(progress);
    const overallQuiz = quizPassRate(attempts);
    const atRisk = detectAtRisk(enrollments, attemptsByLearnerCourse, nowMs);

    // ── AI tutor usage ────────────────────────────────────────────────────────
    const tutorLearners = new Set<string>();
    const tutorTurns: Array<{ role: "user" | "assistant"; chars: number }> = [];
    for (const conv of tutorConvSnap.docs) {
      const data = conv.data();
      if (typeof data.userId === "string") tutorLearners.add(data.userId);
      const turns = Array.isArray(data.turns) ? data.turns : [];
      for (const t of turns) {
        const role = t?.role === "assistant" ? "assistant" : "user";
        const chars = typeof t?.content === "string" ? t.content.length : 0;
        tutorTurns.push({ role, chars });
      }
    }
    let feedbackUp = 0;
    let feedbackDown = 0;
    for (const f of tutorFeedbackSnap.docs) {
      const r = f.data().rating;
      if (r === "up") feedbackUp++;
      else if (r === "down") feedbackDown++;
    }
    const aiUsage = rollupAiUsage({
      turns: tutorTurns,
      conversations: tutorConvSnap.size,
      learners: tutorLearners.size,
      feedbackUp,
      feedbackDown,
    });

    // ── Per-course rollups ────────────────────────────────────────────────────
    const enrollByCourse = new Map<string, EnrollmentRec[]>();
    for (const e of enrollments) {
      const arr = enrollByCourse.get(e.courseId);
      if (arr) arr.push(e);
      else enrollByCourse.set(e.courseId, [e]);
    }
    const attemptsByCourse = new Map<string, AttemptRec[]>();
    for (const a of attempts) {
      const arr = attemptsByCourse.get(a.courseId);
      if (arr) arr.push(a);
      else attemptsByCourse.set(a.courseId, [a]);
    }

    const courseAggs = Array.from(enrollByCourse.entries()).map(([courseId, recs]) => {
      const funnel = completionFunnel(recs);
      const quiz = quizPassRate(attemptsByCourse.get(courseId) ?? []);
      return {
        courseId,
        title: courseTitles.get(courseId) ?? "Untitled course",
        ...funnel,
        avgProgress: avgProgress(recs),
        quizPassRate: quiz.passRate,
        quizAttempts: quiz.attempts,
      };
    });
    // Most-enrolled first for the overview table.
    courseAggs.sort((a, b) => b.enrolled - a.enrolled);

    // ── Per-cohort rollups ────────────────────────────────────────────────────
    const enrollByCohort = new Map<string, EnrollmentRec[]>();
    const progressByCohortUser = new Map<string, ProgressRec[]>();
    // Map userId → cohortId(s) via enrollments so progress can be bucketed.
    const userCohorts = new Map<string, Set<string>>();
    for (const e of enrollments) {
      if (!e.cohortId) continue;
      const arr = enrollByCohort.get(e.cohortId);
      if (arr) arr.push(e);
      else enrollByCohort.set(e.cohortId, [e]);
      const set = userCohorts.get(e.userId) ?? new Set<string>();
      set.add(e.cohortId);
      userCohorts.set(e.userId, set);
    }
    for (const p of progress) {
      const cohorts = userCohorts.get(p.userId);
      if (!cohorts) continue;
      for (const cohortId of cohorts) {
        const arr = progressByCohortUser.get(cohortId);
        if (arr) arr.push(p);
        else progressByCohortUser.set(cohortId, [p]);
      }
    }

    const atRiskByCohort = new Map<string, number>();
    for (const r of atRisk) {
      if (!r.cohortId) continue;
      atRiskByCohort.set(r.cohortId, (atRiskByCohort.get(r.cohortId) ?? 0) + 1);
    }

    const cohortAggs = Array.from(enrollByCohort.entries()).map(([cohortId, recs]) => {
      const funnel = completionFunnel(recs);
      const active = activeLearners(progressByCohortUser.get(cohortId) ?? [], nowMs);
      return {
        cohortId,
        name: cohortNames.get(cohortId) ?? "Unnamed cohort",
        ...funnel,
        avgProgress: avgProgress(recs),
        dau: active.dau,
        wau: active.wau,
        atRiskCount: atRiskByCohort.get(cohortId) ?? 0,
      };
    });
    cohortAggs.sort((a, b) => b.enrolled - a.enrolled);

    // ── Write aggregates ──────────────────────────────────────────────────────
    const generatedAt = admin.firestore.FieldValue.serverTimestamp();

    // Trim at-risk for inline storage; attach a display title + cohort name.
    const atRiskInline = atRisk
      .slice(0, MAX_ATRISK_INLINE)
      .map((r: AtRiskLearner) => ({
        userId: r.userId,
        courseId: r.courseId,
        courseTitle: courseTitles.get(r.courseId) ?? "Untitled course",
        cohortId: r.cohortId ?? null,
        cohortName: r.cohortId ? cohortNames.get(r.cohortId) ?? null : null,
        progressPct: r.progressPct,
        reasons: r.reasons,
      }));

    const batch = db.batch();

    batch.set(db.doc("analytics/overview"), {
      generatedAt,
      totals: {
        learners: learnersAgg.data().count,
        enrollments: overallFunnel.enrolled,
        courses: coursesSnap.size,
        cohorts: cohortSnap.size,
      },
      activeLearners: dauwau,
      completion: overallFunnel,
      timeOnTask: overallTime,
      quiz: overallQuiz,
      atRisk: {
        total: atRisk.length,
        learners: atRiskInline,
      },
      aiUsage,
      courses: courseAggs.slice(0, MAX_COURSES_INLINE),
      cohorts: cohortAggs,
    });

    for (const c of courseAggs) {
      batch.set(db.doc(`analytics/course_${c.courseId}`), { generatedAt, ...c });
    }
    for (const c of cohortAggs) {
      batch.set(db.doc(`analytics/cohort_${c.cohortId}`), { generatedAt, ...c });
    }

    await batch.commit();

    console.info(
      `analyticsAggregation: wrote overview + ${courseAggs.length} course doc(s) + ` +
        `${cohortAggs.length} cohort doc(s). DAU=${dauwau.dau} WAU=${dauwau.wau} ` +
        `completion=${overallFunnel.completionPct}% atRisk=${atRisk.length} ` +
        `tutorConvos=${aiUsage.conversations} estCost=$${aiUsage.estCostUsd}`
    );
  }
);
