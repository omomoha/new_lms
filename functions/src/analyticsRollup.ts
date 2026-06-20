/**
 * analyticsRollup — PURE aggregation math for the analytics dashboard.
 *
 * Dependency-free (no firebase, no admin SDK) so it can be unit-tested the same
 * way progress.ts / gamification.ts are. The scheduled function
 * (analyticsAggregation.ts) reads raw Firestore docs, maps them into the plain
 * record shapes below, calls these functions, and writes the results under the
 * `analytics/` collection. Keeping the math here means thresholds and formulae
 * are verified in CI and shared with the dashboard's CSV exporters.
 *
 * THRESHOLDS are intentionally aligned with the rest of the codebase:
 *  - "completed" === progressPct >= 100      (matches admin/page.tsx, weeklyDigest)
 *  - "started"   === progressPct > 0
 *  - at-risk stalled window = 14 days        (matches learnerReminders cooldown)
 *  - a quiz attempt's pass flag comes from gradeAttempt (attempt.passed)
 */

// ── Time helpers ──────────────────────────────────────────────────────────────

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** Completion threshold (percent) — a course is "done" at 100%. */
export const COMPLETE_PCT = 100;

/** A learner with progress strictly above 0 has "started". */
export const STARTED_PCT = 0;

/**
 * At-risk thresholds. Documented so leadership can reason about the flags and so
 * tests pin the exact behaviour.
 */
export const AT_RISK = {
  /** No progress write in this many ms while < 100% → "stalled". */
  STALLED_MS: 14 * DAY_MS,
  /** Quiz pass-rate below this fraction (0–1) over >= MIN_ATTEMPTS → "low scores". */
  LOW_PASS_RATE: 0.5,
  /** Minimum graded attempts before the low-pass-rate signal can fire. */
  MIN_ATTEMPTS: 2,
} as const;

// ── Input record shapes (plain — mapped from Firestore by the function) ───────

export interface EnrollmentRec {
  userId: string;
  courseId: string;
  cohortId?: string | null;
  progressPct: number;
  /** ms epoch of the last enrollment update (Enrollment.updatedAt). */
  updatedAtMs: number | null;
  /** Earliest course due date for this learner, ms epoch, or null. */
  dueAtMs?: number | null;
}

export interface ProgressRec {
  userId: string;
  lessonId: string;
  courseId: string;
  /** Resume position in seconds (proxy for time-on-task on video lessons). */
  positionSec: number;
  /** ms epoch when this lesson was completed, or null. */
  completedAtMs: number | null;
  /** ms epoch of the most recent write to this progress doc. */
  updatedAtMs: number | null;
}

export interface AttemptRec {
  userId: string;
  courseId: string;
  passed: boolean;
  submittedAtMs: number | null;
}

// ── DAU / WAU ─────────────────────────────────────────────────────────────────

export interface ActiveLearners {
  dau: number;
  wau: number;
}

/**
 * Distinct active learners by recency of ANY progress activity.
 * "Active" = at least one progress doc whose updatedAt OR completedAt falls in
 * the window ending at `nowMs`.
 */
export function activeLearners(progress: ProgressRec[], nowMs: number): ActiveLearners {
  const day = new Set<string>();
  const week = new Set<string>();
  for (const p of progress) {
    const t = Math.max(p.updatedAtMs ?? 0, p.completedAtMs ?? 0);
    if (t <= 0) continue;
    const age = nowMs - t;
    if (age < 0) continue;
    if (age <= DAY_MS) day.add(p.userId);
    if (age <= WEEK_MS) week.add(p.userId);
  }
  return { dau: day.size, wau: week.size };
}

// ── Completion funnel ─────────────────────────────────────────────────────────

export interface CompletionFunnel {
  enrolled: number;
  started: number;   // progressPct > 0
  completed: number; // progressPct >= 100
  completionPct: number; // completed / enrolled, 0–100 rounded
}

export function completionFunnel(enrollments: EnrollmentRec[]): CompletionFunnel {
  let enrolled = 0;
  let started = 0;
  let completed = 0;
  for (const e of enrollments) {
    enrolled++;
    if (e.progressPct > STARTED_PCT) started++;
    if (e.progressPct >= COMPLETE_PCT) completed++;
  }
  return {
    enrolled,
    started,
    completed,
    completionPct: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0,
  };
}

/** Mean of progressPct across enrollments, rounded; 0 when empty. */
export function avgProgress(enrollments: EnrollmentRec[]): number {
  if (enrollments.length === 0) return 0;
  const sum = enrollments.reduce((acc, e) => acc + (e.progressPct || 0), 0);
  return Math.round(sum / enrollments.length);
}

// ── Time-on-task ──────────────────────────────────────────────────────────────

export interface TimeOnTask {
  totalSeconds: number;
  /** Mean seconds per distinct active learner (learners with > 0s), rounded. */
  avgSecondsPerLearner: number;
  learners: number;
}

/**
 * Total watched seconds summed from progress positions. positionSec is the
 * resume point on video lessons — a conservative lower bound on time-on-task,
 * but the only signal we persist today. avgSecondsPerLearner divides by the
 * number of learners with any positive position (not all enrolled), so a few
 * power users don't get diluted by never-started enrollments.
 */
export function timeOnTask(progress: ProgressRec[]): TimeOnTask {
  let total = 0;
  const perLearner = new Map<string, number>();
  for (const p of progress) {
    const s = Number.isFinite(p.positionSec) && p.positionSec > 0 ? p.positionSec : 0;
    if (s === 0) continue;
    total += s;
    perLearner.set(p.userId, (perLearner.get(p.userId) ?? 0) + s);
  }
  const learners = perLearner.size;
  return {
    totalSeconds: Math.round(total),
    avgSecondsPerLearner: learners > 0 ? Math.round(total / learners) : 0,
    learners,
  };
}

// ── Quiz pass rates ───────────────────────────────────────────────────────────

export interface QuizPassRate {
  attempts: number;
  passed: number;
  passRate: number; // passed / attempts, 0–100 rounded
}

export function quizPassRate(attempts: AttemptRec[]): QuizPassRate {
  let total = 0;
  let passed = 0;
  for (const a of attempts) {
    total++;
    if (a.passed) passed++;
  }
  return {
    attempts: total,
    passed,
    passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
  };
}

// ── At-risk detection ─────────────────────────────────────────────────────────

export type AtRiskReason = "stalled" | "overdue" | "low_scores";

export interface AtRiskLearner {
  userId: string;
  courseId: string;
  cohortId?: string | null;
  progressPct: number;
  reasons: AtRiskReason[];
}

/**
 * Flag an enrollment as at-risk. An enrollment that is already complete
 * (>= 100%) is NEVER at risk. Otherwise the reasons accumulate:
 *  - "overdue":    has a due date strictly in the past.
 *  - "stalled":    no enrollment update for >= STALLED_MS (and has a timestamp).
 *  - "low_scores": >= MIN_ATTEMPTS graded attempts with pass rate < LOW_PASS_RATE.
 * Returns null when no reason fires.
 */
export function assessEnrollmentRisk(
  enrollment: EnrollmentRec,
  attemptsForLearnerCourse: AttemptRec[],
  nowMs: number
): AtRiskLearner | null {
  if (enrollment.progressPct >= COMPLETE_PCT) return null;

  const reasons: AtRiskReason[] = [];

  if (
    enrollment.dueAtMs != null &&
    Number.isFinite(enrollment.dueAtMs) &&
    nowMs > enrollment.dueAtMs
  ) {
    reasons.push("overdue");
  }

  if (
    enrollment.updatedAtMs != null &&
    Number.isFinite(enrollment.updatedAtMs) &&
    nowMs - enrollment.updatedAtMs >= AT_RISK.STALLED_MS
  ) {
    reasons.push("stalled");
  }

  if (attemptsForLearnerCourse.length >= AT_RISK.MIN_ATTEMPTS) {
    const { passRate } = quizPassRate(attemptsForLearnerCourse);
    if (passRate / 100 < AT_RISK.LOW_PASS_RATE) {
      reasons.push("low_scores");
    }
  }

  if (reasons.length === 0) return null;
  return {
    userId: enrollment.userId,
    courseId: enrollment.courseId,
    cohortId: enrollment.cohortId ?? null,
    progressPct: enrollment.progressPct,
    reasons,
  };
}

/**
 * Run at-risk detection across all enrollments. `attemptsByLearnerCourse` maps
 * `${userId}_${courseId}` → that learner's graded attempts for the course.
 */
export function detectAtRisk(
  enrollments: EnrollmentRec[],
  attemptsByLearnerCourse: Map<string, AttemptRec[]>,
  nowMs: number
): AtRiskLearner[] {
  const out: AtRiskLearner[] = [];
  for (const e of enrollments) {
    const key = `${e.userId}_${e.courseId}`;
    const flagged = assessEnrollmentRisk(e, attemptsByLearnerCourse.get(key) ?? [], nowMs);
    if (flagged) out.push(flagged);
  }
  return out;
}

// ── AI tutor usage + cost ─────────────────────────────────────────────────────

/**
 * Per-1M-token prices (USD) for claude-sonnet-4-6, the tutor's model. These are
 * approximations for leadership cost visibility, NOT billing. Override at the
 * call site if the model/pricing changes.
 */
export const TOKEN_PRICES = {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: 3,
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: 15,
} as const;

/**
 * Rough token estimate from a character count. We do NOT persist real token
 * usage from the Anthropic API today (the tutor doesn't record it), so we
 * approximate at ~4 characters per token — the standard rule of thumb. Clearly
 * an ESTIMATE; the dashboard labels it as such.
 */
export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

export interface AiUsageInput {
  /** A tutor turn: role + character length of its content. */
  turns: Array<{ role: "user" | "assistant"; chars: number }>;
  /** Number of distinct conversations. */
  conversations: number;
  /** Number of distinct learners who used the tutor. */
  learners: number;
  /** Tutor-answer feedback tallies. */
  feedbackUp: number;
  feedbackDown: number;
}

export interface AiUsageRollup {
  conversations: number;
  learners: number;
  totalTurns: number;
  questions: number; // user turns
  answers: number;   // assistant turns
  estInputTokens: number;
  estOutputTokens: number;
  estCostUsd: number;
  feedbackUp: number;
  feedbackDown: number;
  /** up / (up + down), 0–100 rounded; 0 when no feedback. */
  satisfactionPct: number;
}

/**
 * Roll up AI tutor usage. Input (user) turns are billed at the input price and
 * output (assistant) turns at the output price. Note: real API billing also
 * charges for the system prompt and re-sent history on every call, so this is a
 * conservative LOWER bound — surfaced as an estimate, not an invoice.
 */
export function rollupAiUsage(input: AiUsageInput): AiUsageRollup {
  let inChars = 0;
  let outChars = 0;
  let questions = 0;
  let answers = 0;
  for (const t of input.turns) {
    if (t.role === "user") {
      inChars += Math.max(0, t.chars);
      questions++;
    } else {
      outChars += Math.max(0, t.chars);
      answers++;
    }
  }
  const estInputTokens = estimateTokens(inChars);
  const estOutputTokens = estimateTokens(outChars);
  const estCostUsd =
    (estInputTokens / 1_000_000) * TOKEN_PRICES.inputPerMillion +
    (estOutputTokens / 1_000_000) * TOKEN_PRICES.outputPerMillion;
  const fbTotal = input.feedbackUp + input.feedbackDown;
  return {
    conversations: input.conversations,
    learners: input.learners,
    totalTurns: input.turns.length,
    questions,
    answers,
    estInputTokens,
    estOutputTokens,
    // round to cents
    estCostUsd: Math.round(estCostUsd * 100) / 100,
    feedbackUp: input.feedbackUp,
    feedbackDown: input.feedbackDown,
    satisfactionPct: fbTotal > 0 ? Math.round((input.feedbackUp / fbTotal) * 100) : 0,
  };
}
