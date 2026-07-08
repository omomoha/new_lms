import 'dart:math' as math;

/// Gamification — XP, levels and badges derived deterministically from data the
/// learner can already read (progress, attempts, certificates, streaks).
///
/// Pure Dart port of `src/lib/gamification.ts`. The XP rules are duplicated
/// server-side in `functions/src/gamificationRules.ts` for the leaderboard —
/// keep all constants identical.

/// JS `Math.round` parity (half toward +Infinity).
int _jsRound(num x) => (x + 0.5).floor();

class GamificationStats {
  /// Lessons with a completedAt timestamp.
  final int lessonsCompleted;

  /// Assessment attempts with passed == true.
  final int quizzesPassed;

  /// Certificates earned.
  final int certificates;

  /// Current daily streak (from computeStreaks).
  final int streakDays;

  const GamificationStats({
    required this.lessonsCompleted,
    required this.quizzesPassed,
    required this.certificates,
    required this.streakDays,
  });
}

const int kXpPerLesson = 10;
const int kXpPerQuizPass = 25;
const int kXpPerCertificate = 100;

int computeXp(GamificationStats s) =>
    s.lessonsCompleted * kXpPerLesson +
    s.quizzesPassed * kXpPerQuizPass +
    s.certificates * kXpPerCertificate;

/// Level thresholds (XP required to ENTER each level). Level 1 = 0 XP.
const List<int> kLevelThresholds = [
  0,
  100,
  250,
  500,
  900,
  1500,
  2400,
  3600,
  5200,
  7500
];

class LevelInfo {
  final int level; // 1-based
  final int current; // XP into the current level
  final int needed; // XP needed to reach the next level (0 when max level)
  final int pct; // 0–100 progress through the current level

  const LevelInfo({
    required this.level,
    required this.current,
    required this.needed,
    required this.pct,
  });
}

LevelInfo levelFor(int xp) {
  final x = math.max(0, xp);
  int level = 1;
  for (int i = kLevelThresholds.length - 1; i >= 0; i--) {
    if (x >= kLevelThresholds[i]) {
      level = i + 1;
      break;
    }
  }
  final base = kLevelThresholds[level - 1];
  final int? next =
      level < kLevelThresholds.length ? kLevelThresholds[level] : null;
  if (next == null) {
    return LevelInfo(level: level, current: x - base, needed: 0, pct: 100);
  }
  final span = next - base;
  final current = x - base;
  return LevelInfo(
    level: level,
    current: current,
    needed: span - current,
    pct: math.min(100, _jsRound((current / span) * 100)),
  );
}

typedef StatPredicate = bool Function(GamificationStats s);
typedef StatProgress = int Function(GamificationStats s);

class Badge {
  final String id;
  final String emoji;
  final String title;
  final String description;
  final StatPredicate earned;

  /// 0–100 progress toward earning (for locked badges).
  final StatProgress progress;

  const Badge({
    required this.id,
    required this.emoji,
    required this.title,
    required this.description,
    required this.earned,
    required this.progress,
  });
}

int _pct(num n, num target) => math.min(100, _jsRound((n / target) * 100));

const List<Badge> kBadges = [
  Badge(
    id: 'first-lesson',
    emoji: '🌱',
    title: 'First Steps',
    description: 'Complete your first lesson',
    earned: _firstLesson,
    progress: _firstLessonPct,
  ),
  Badge(
    id: 'ten-lessons',
    emoji: '📚',
    title: 'Bookworm',
    description: 'Complete 10 lessons',
    earned: _tenLessons,
    progress: _tenLessonsPct,
  ),
  Badge(
    id: 'twentyfive-lessons',
    emoji: '🚀',
    title: 'Momentum',
    description: 'Complete 25 lessons',
    earned: _twentyFiveLessons,
    progress: _twentyFiveLessonsPct,
  ),
  Badge(
    id: 'first-quiz',
    emoji: '✅',
    title: 'Quiz Taker',
    description: 'Pass your first assessment',
    earned: _firstQuiz,
    progress: _firstQuizPct,
  ),
  Badge(
    id: 'quiz-master',
    emoji: '🧠',
    title: 'Quiz Master',
    description: 'Pass 5 assessments',
    earned: _quizMaster,
    progress: _quizMasterPct,
  ),
  Badge(
    id: 'certified',
    emoji: '🎓',
    title: 'Certified',
    description: 'Earn your first certificate',
    earned: _certified,
    progress: _certifiedPct,
  ),
  Badge(
    id: 'collector',
    emoji: '🏆',
    title: 'Collector',
    description: 'Earn 3 certificates',
    earned: _collector,
    progress: _collectorPct,
  ),
  Badge(
    id: 'streak-3',
    emoji: '🔥',
    title: 'Warming Up',
    description: 'Keep a 3-day learning streak',
    earned: _streak3,
    progress: _streak3Pct,
  ),
  Badge(
    id: 'streak-7',
    emoji: '⚡',
    title: 'On Fire',
    description: 'Keep a 7-day learning streak',
    earned: _streak7,
    progress: _streak7Pct,
  ),
  Badge(
    id: 'streak-14',
    emoji: '💎',
    title: 'Unstoppable',
    description: 'Keep a 14-day learning streak',
    earned: _streak14,
    progress: _streak14Pct,
  ),
];

// Top-level predicate/progress functions (const list requires const tear-offs).
bool _firstLesson(GamificationStats s) => s.lessonsCompleted >= 1;
int _firstLessonPct(GamificationStats s) => _pct(s.lessonsCompleted, 1);
bool _tenLessons(GamificationStats s) => s.lessonsCompleted >= 10;
int _tenLessonsPct(GamificationStats s) => _pct(s.lessonsCompleted, 10);
bool _twentyFiveLessons(GamificationStats s) => s.lessonsCompleted >= 25;
int _twentyFiveLessonsPct(GamificationStats s) => _pct(s.lessonsCompleted, 25);
bool _firstQuiz(GamificationStats s) => s.quizzesPassed >= 1;
int _firstQuizPct(GamificationStats s) => _pct(s.quizzesPassed, 1);
bool _quizMaster(GamificationStats s) => s.quizzesPassed >= 5;
int _quizMasterPct(GamificationStats s) => _pct(s.quizzesPassed, 5);
bool _certified(GamificationStats s) => s.certificates >= 1;
int _certifiedPct(GamificationStats s) => _pct(s.certificates, 1);
bool _collector(GamificationStats s) => s.certificates >= 3;
int _collectorPct(GamificationStats s) => _pct(s.certificates, 3);
bool _streak3(GamificationStats s) => s.streakDays >= 3;
int _streak3Pct(GamificationStats s) => _pct(s.streakDays, 3);
bool _streak7(GamificationStats s) => s.streakDays >= 7;
int _streak7Pct(GamificationStats s) => _pct(s.streakDays, 7);
bool _streak14(GamificationStats s) => s.streakDays >= 14;
int _streak14Pct(GamificationStats s) => _pct(s.streakDays, 14);

List<Badge> earnedBadges(GamificationStats s) =>
    kBadges.where((b) => b.earned(s)).toList();
