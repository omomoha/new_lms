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
