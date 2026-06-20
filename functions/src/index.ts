/**
 * Andela LMS — Cloud Functions (2nd gen, Node 22)
 * Entry point — exports all callable functions.
 */

export { bulkOnboard } from "./bulkOnboard";
export { gradeAttempt } from "./gradeAttempt";
export { weeklyDigest } from "./weeklyDigest";
export { dailySignupAlert } from "./dailySignupAlert";
export { syncRoleClaim } from "./syncRoleClaim";
export { parseAssessmentDoc } from "./parseAssessmentDoc";
export { getSignedVideoUrl } from "./getSignedVideoUrl";
export { transcodeVideo } from "./transcodeVideo";
export { convertOfficeToPdf, backfillOfficeConversions } from "./convertOfficeToPdf";
export { transcribeVideo } from "./transcribeVideo";
export {
  issueCertificate,
  autoIssueCertificate,
  autoIssueOnPostPass,
  previewCertificate,
} from "./certificates";

// ── AI features (require ANTHROPIC_API_KEY in the runtime env) ──────────────
export { askTutor } from "./aiTutor";
export { generateAssessment } from "./generateAssessment";
export { generateCourseOutline } from "./generateCourseOutline";
export { gradeLab } from "./gradeLab";
export { generateFlashcards } from "./flashcardsGen";
export { adminCopilot } from "./adminCopilot";

export { getCohortLeaderboard } from "./leaderboard";
export { manageUserAccount } from "./manageUsers";

// ── Retention ────────────────────────────────────────────────────────────────
export { learnerReminders } from "./learnerReminders";

// ── Analytics (Phase 4 — Workstream D) ─────────────────────────────────────────
// Hourly scheduled rollup into the admin-only `analytics/` collection so the
// /admin/analytics dashboard reads pre-computed docs instead of scanning
// enrollments/progress/attempts/tutorConversations live at 5k learners.
export { analyticsAggregation } from "./analyticsAggregation";

// ── Community Forum (Phase 4 — Workstream B) ───────────────────────────────────
// Reply/thread triggers: notifications (reply + @mention), counter maintenance,
// and opt-in AI pre-moderation (requires ANTHROPIC_API_KEY only when a category
// enables it).
export { onForumReplyCreated, onForumThreadCreated } from "./forum";
