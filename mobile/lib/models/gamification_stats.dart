import '../logic/gamification.dart';

/// View-model bundling the learner's raw [GamificationStats] with everything
/// the achievements screen renders: total XP, level info, and badge state.
///
/// The pure numeric rules live in `logic/gamification.dart`
/// ([GamificationStats], [computeXp], [levelFor], [kBadges]) so they stay
/// unit-testable and identical to the web. This is only the assembled summary.
class GamificationSummary {
  final GamificationStats stats;
  final int xp;
  final LevelInfo level;
  final List<Badge> earned;
  final List<Badge> all;

  const GamificationSummary({
    required this.stats,
    required this.xp,
    required this.level,
    required this.earned,
    required this.all,
  });

  factory GamificationSummary.from(GamificationStats stats) {
    final xp = computeXp(stats);
    return GamificationSummary(
      stats: stats,
      xp: xp,
      level: levelFor(xp),
      earned: earnedBadges(stats),
      all: kBadges,
    );
  }

  bool isEarned(Badge badge) => badge.earned(stats);
  int progressOf(Badge badge) => badge.progress(stats);
}
