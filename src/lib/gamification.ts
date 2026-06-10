/**
 * gamification — XP, levels and badges, derived deterministically from data
 * the learner can already read (progress, attempts, certificates, streaks).
 * Nothing is stored: recomputing from source-of-truth means no backfills, no
 * drift, and nothing extra to secure.
 *
 * THE XP RULES ARE DUPLICATED in functions/src/gamificationRules.ts for the
 * server-side leaderboard — tests/gamification.test.ts asserts both stay in
 * sync. Change them together.
 */

export interface GamificationStats {
  /** Lessons with a completedAt timestamp */
  lessonsCompleted: number;
  /** Assessment attempts with passed === true */
  quizzesPassed: number;
  /** Certificates earned */
  certificates: number;
  /** Current daily streak (from computeStreaks) */
  streakDays: number;
}

export const XP_PER_LESSON = 10;
export const XP_PER_QUIZ_PASS = 25;
export const XP_PER_CERTIFICATE = 100;

export function computeXp(s: GamificationStats): number {
  return (
    s.lessonsCompleted * XP_PER_LESSON +
    s.quizzesPassed * XP_PER_QUIZ_PASS +
    s.certificates * XP_PER_CERTIFICATE
  );
}

/** Level thresholds (XP required to ENTER each level). Level 1 = 0 XP. */
export const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7500];

export interface LevelInfo {
  level: number; // 1-based
  /** XP into the current level */
  current: number;
  /** XP needed to reach the next level (0 when max level) */
  needed: number;
  /** 0–100 progress through the current level */
  pct: number;
}

export function levelFor(xp: number): LevelInfo {
  const x = Math.max(0, xp);
  let level = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (x >= LEVEL_THRESHOLDS[i]) {
      level = i + 1;
      break;
    }
  }
  const base = LEVEL_THRESHOLDS[level - 1];
  const next = LEVEL_THRESHOLDS[level] ?? null;
  if (next === null) {
    return { level, current: x - base, needed: 0, pct: 100 };
  }
  const span = next - base;
  const current = x - base;
  return {
    level,
    current,
    needed: span - current,
    pct: Math.min(100, Math.round((current / span) * 100)),
  };
}

export interface Badge {
  id: string;
  emoji: string;
  title: string;
  description: string;
  earned: (s: GamificationStats) => boolean;
  /** 0–100 progress toward earning (for locked badges) */
  progress: (s: GamificationStats) => number;
}

const pct = (n: number, target: number) =>
  Math.min(100, Math.round((n / target) * 100));

export const BADGES: Badge[] = [
  {
    id: "first-lesson", emoji: "🌱", title: "First Steps",
    description: "Complete your first lesson",
    earned: (s) => s.lessonsCompleted >= 1, progress: (s) => pct(s.lessonsCompleted, 1),
  },
  {
    id: "ten-lessons", emoji: "📚", title: "Bookworm",
    description: "Complete 10 lessons",
    earned: (s) => s.lessonsCompleted >= 10, progress: (s) => pct(s.lessonsCompleted, 10),
  },
  {
    id: "twentyfive-lessons", emoji: "🚀", title: "Momentum",
    description: "Complete 25 lessons",
    earned: (s) => s.lessonsCompleted >= 25, progress: (s) => pct(s.lessonsCompleted, 25),
  },
  {
    id: "first-quiz", emoji: "✅", title: "Quiz Taker",
    description: "Pass your first assessment",
    earned: (s) => s.quizzesPassed >= 1, progress: (s) => pct(s.quizzesPassed, 1),
  },
  {
    id: "quiz-master", emoji: "🧠", title: "Quiz Master",
    description: "Pass 5 assessments",
    earned: (s) => s.quizzesPassed >= 5, progress: (s) => pct(s.quizzesPassed, 5),
  },
  {
    id: "certified", emoji: "🎓", title: "Certified",
    description: "Earn your first certificate",
    earned: (s) => s.certificates >= 1, progress: (s) => pct(s.certificates, 1),
  },
  {
    id: "collector", emoji: "🏆", title: "Collector",
    description: "Earn 3 certificates",
    earned: (s) => s.certificates >= 3, progress: (s) => pct(s.certificates, 3),
  },
  {
    id: "streak-3", emoji: "🔥", title: "Warming Up",
    description: "Keep a 3-day learning streak",
    earned: (s) => s.streakDays >= 3, progress: (s) => pct(s.streakDays, 3),
  },
  {
    id: "streak-7", emoji: "⚡", title: "On Fire",
    description: "Keep a 7-day learning streak",
    earned: (s) => s.streakDays >= 7, progress: (s) => pct(s.streakDays, 7),
  },
  {
    id: "streak-14", emoji: "💎", title: "Unstoppable",
    description: "Keep a 14-day learning streak",
    earned: (s) => s.streakDays >= 14, progress: (s) => pct(s.streakDays, 14),
  },
];

export function earnedBadges(s: GamificationStats): Badge[] {
  return BADGES.filter((b) => b.earned(s));
}
