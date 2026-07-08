// Ported 1:1 from web tests/gamification.test.ts. Asserts the exact XP rule
// table, level thresholds and badge predicates the web (and the server-side
// gamificationRules.ts) use.
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/gamification.dart';

GamificationStats stats({
  int lessonsCompleted = 0,
  int quizzesPassed = 0,
  int certificates = 0,
  int streakDays = 0,
}) =>
    GamificationStats(
      lessonsCompleted: lessonsCompleted,
      quizzesPassed: quizzesPassed,
      certificates: certificates,
      streakDays: streakDays,
    );

void main() {
  group('XP', () {
    test('rule constants match the web (10 / 25 / 100)', () {
      expect(kXpPerLesson, 10);
      expect(kXpPerQuizPass, 25);
      expect(kXpPerCertificate, 100);
    });

    test('computes from the rule table', () {
      expect(
        computeXp(stats(lessonsCompleted: 3, quizzesPassed: 2, certificates: 1)),
        3 * kXpPerLesson + 2 * kXpPerQuizPass + 1 * kXpPerCertificate,
      );
      expect(
        computeXp(stats(lessonsCompleted: 3, quizzesPassed: 2, certificates: 1)),
        180,
      );
    });
  });

  group('levels', () {
    test('thresholds match the web exactly', () {
      expect(kLevelThresholds,
          [0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7500]);
    });

    test('starts at level 1 with 0 XP', () {
      final l = levelFor(0);
      expect(l.level, 1);
      expect(l.pct, 0);
    });

    test('crosses thresholds exactly', () {
      expect(levelFor(kLevelThresholds[1]).level, 2);
      expect(levelFor(kLevelThresholds[1] - 1).level, 1);
    });

    test('caps at max level with pct 100 and needed 0', () {
      final top = levelFor(kLevelThresholds.last + 5000);
      expect(top.level, kLevelThresholds.length);
      expect(top.needed, 0);
      expect(top.pct, 100);
    });

    test('handles negative input', () {
      expect(levelFor(-50).level, 1);
    });
  });

  group('badges', () {
    test('there are 10 badges with unique ids', () {
      expect(kBadges.length, 10);
      expect(kBadges.map((b) => b.id).toSet().length, kBadges.length);
    });

    test('none earned with zero stats; all progress within 0-100', () {
      final s = stats();
      expect(earnedBadges(s), isEmpty);
      for (final b in kBadges) {
        final p = b.progress(s);
        expect(p, greaterThanOrEqualTo(0));
        expect(p, lessThanOrEqualTo(100));
      }
    });

    test('all earned with maxed stats', () {
      final s = stats(
          lessonsCompleted: 100,
          quizzesPassed: 50,
          certificates: 10,
          streakDays: 30);
      expect(earnedBadges(s).length, kBadges.length);
    });

    test('earned implies progress 100', () {
      final s = stats(lessonsCompleted: 10);
      for (final b in kBadges.where((b) => b.earned(s))) {
        expect(b.progress(s), 100);
      }
    });
  });
}
