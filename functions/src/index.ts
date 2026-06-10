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
export {
  issueCertificate,
  autoIssueCertificate,
  autoIssueOnPostPass,
  previewCertificate,
} from "./certificates";

// ── AI features (require ANTHROPIC_API_KEY in the runtime env) ──────────────
export { askTutor } from "./aiTutor";
export { generateAssessment } from "./generateAssessment";
export { gradeLab } from "./gradeLab";
export { generateFlashcards } from "./flashcardsGen";
export { adminCopilot } from "./adminCopilot";

// ── Retention ────────────────────────────────────────────────────────────────
export { learnerReminders } from "./learnerReminders";
