/**
 * gamificationRules — server-side copy of the XP rules used by the cohort
 * leaderboard. Pure (no firebase imports) so the root test suite can import
 * it AND src/lib/gamification.ts and assert the two stay in sync.
 */

export const XP_PER_LESSON = 10;
export const XP_PER_QUIZ_PASS = 25;
export const XP_PER_CERTIFICATE = 100;

export function computeXp(stats: {
  lessonsCompleted: number;
  quizzesPassed: number;
  certificates: number;
}): number {
  return (
    stats.lessonsCompleted * XP_PER_LESSON +
    stats.quizzesPassed * XP_PER_QUIZ_PASS +
    stats.certificates * XP_PER_CERTIFICATE
  );
}
