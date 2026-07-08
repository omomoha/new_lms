// Ported 1:1 from web tests/spacedRepetition.test.ts (SM-2-lite scheduling).
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/spaced_repetition.dart';

final DateTime nowUtc = DateTime.utc(2026, 6, 10, 12, 0, 0);
const int dayMs = 24 * 60 * 60 * 1000;

int dueMs(ReviewResult r) => r.due.millisecondsSinceEpoch;

void main() {
  group('constants', () {
    test('ease floor/cap/default match the web', () {
      expect(kEaseFloor, 1.3);
      expect(kEaseCap, 3.0);
      expect(kDefaultEase, 2.5);
    });
  });

  group('initialState', () {
    test('new card due immediately with default ease', () {
      final s = initialState();
      expect(s.interval, 0);
      expect(s.ease, kDefaultEase);
      expect(s.reps, 0);
    });
  });

  group('review — first review path', () {
    test('good on a new card -> 1 day, reps 1, ease unchanged', () {
      final r = review(initialState(), ReviewGrade.good, nowUtc);
      expect(r.interval, 1);
      expect(r.reps, 1);
      expect(r.ease, kDefaultEase);
      expect(dueMs(r), nowUtc.millisecondsSinceEpoch + 1 * dayMs);
    });

    test('second good -> 3 days', () {
      final first = review(initialState(), ReviewGrade.good, nowUtc);
      final second = review(
          CardSchedule(interval: first.interval, ease: first.ease, reps: first.reps),
          ReviewGrade.good,
          nowUtc);
      expect(second.interval, 3);
      expect(second.reps, 2);
    });

    test('third good -> interval x ease (3 x 2.5 = 7.5 days)', () {
      var s = initialState();
      var r = review(s, ReviewGrade.good, nowUtc);
      r = review(CardSchedule(interval: r.interval, ease: r.ease, reps: r.reps),
          ReviewGrade.good, nowUtc);
      final third = review(
          CardSchedule(interval: r.interval, ease: r.ease, reps: r.reps),
          ReviewGrade.good,
          nowUtc);
      expect(third.interval, closeTo(7.5, 1e-9));
      expect(third.reps, 3);
    });

    test('easy on a new card -> 4 days and ease bumped', () {
      final r = review(initialState(), ReviewGrade.easy, nowUtc);
      expect(r.interval, 4);
      expect(r.reps, 1);
      expect(r.ease, closeTo(kDefaultEase + 0.15, 1e-9));
    });

    test('hard on a new card -> minimum 1 day interval', () {
      final r = review(initialState(), ReviewGrade.hard, nowUtc);
      expect(r.interval, 1);
      expect(r.reps, 1);
      expect(r.ease, closeTo(kDefaultEase - 0.15, 1e-9));
    });
  });

  group('review — again resets the card', () {
    test('resets interval and reps, schedules ~10 minutes out', () {
      const mature = CardSchedule(interval: 21, ease: 2.5, reps: 5);
      final r = review(mature, ReviewGrade.again, nowUtc);
      expect(r.interval, 0);
      expect(r.reps, 0);
      expect(r.ease, closeTo(2.3, 1e-9));
      expect(dueMs(r), nowUtc.millisecondsSinceEpoch + 10 * 60 * 1000);
    });

    test('a good after again follows the graduating steps again (1 day)', () {
      const mature = CardSchedule(interval: 21, ease: 2.5, reps: 5);
      final lapsed = review(mature, ReviewGrade.again, nowUtc);
      final relearned = review(
          CardSchedule(
              interval: lapsed.interval, ease: lapsed.ease, reps: lapsed.reps),
          ReviewGrade.good,
          nowUtc);
      expect(relearned.interval, 1);
      expect(relearned.reps, 1);
    });
  });

  group('review — ease floor and cap', () {
    test('repeated again never drops ease below the floor', () {
      var s = initialState();
      for (var i = 0; i < 20; i++) {
        final r = review(s, ReviewGrade.again, nowUtc);
        s = CardSchedule(interval: r.interval, ease: r.ease, reps: r.reps);
      }
      expect(s.ease, kEaseFloor);
    });

    test('repeated hard never drops ease below the floor', () {
      var s = initialState();
      for (var i = 0; i < 20; i++) {
        final r = review(s, ReviewGrade.hard, nowUtc);
        s = CardSchedule(interval: r.interval, ease: r.ease, reps: r.reps);
      }
      expect(s.ease, kEaseFloor);
    });

    test('repeated easy never raises ease above the cap', () {
      var s = initialState();
      for (var i = 0; i < 20; i++) {
        final r = review(s, ReviewGrade.easy, nowUtc);
        s = CardSchedule(interval: r.interval, ease: r.ease, reps: r.reps);
      }
      expect(s.ease, kEaseCap);
    });
  });

  group('review — due date calculation', () {
    test('due is now + interval days for graded reviews (good)', () {
      const s = CardSchedule(interval: 10, ease: 2.0, reps: 3);
      final r = review(s, ReviewGrade.good, nowUtc);
      expect(r.interval, closeTo(20, 1e-9)); // 10 x 2.0
      expect(dueMs(r),
          nowUtc.millisecondsSinceEpoch + (r.interval * dayMs).toInt());
    });

    test('hard multiplies the interval by 1.2', () {
      const s = CardSchedule(interval: 10, ease: 2.0, reps: 3);
      final r = review(s, ReviewGrade.hard, nowUtc);
      expect(r.interval, closeTo(12, 1e-9));
      expect(dueMs(r), nowUtc.millisecondsSinceEpoch + 12 * dayMs);
    });

    test('easy multiplies by ease x 1.3', () {
      const s = CardSchedule(interval: 10, ease: 2.0, reps: 3);
      final r = review(s, ReviewGrade.easy, nowUtc);
      expect(r.interval, closeTo(26, 1e-9)); // 10 x 2.0 x 1.3
    });

    test('does not mutate the input state', () {
      const s = CardSchedule(interval: 5, ease: 2.5, reps: 2);
      review(s, ReviewGrade.easy, nowUtc);
      expect(s.interval, 5);
      expect(s.ease, 2.5);
      expect(s.reps, 2);
    });
  });

  group('review — monotonic interval growth', () {
    test('intervals strictly grow under repeated good answers', () {
      var s = initialState();
      num prev = 0;
      for (var i = 0; i < 10; i++) {
        final r = review(s, ReviewGrade.good, nowUtc);
        expect(r.interval, greaterThan(prev));
        prev = r.interval;
        s = CardSchedule(interval: r.interval, ease: r.ease, reps: r.reps);
      }
    });

    test('intervals never shrink under repeated hard answers (>= 1 day)', () {
      var s = initialState();
      num prev = 0;
      for (var i = 0; i < 10; i++) {
        final r = review(s, ReviewGrade.hard, nowUtc);
        expect(r.interval, greaterThanOrEqualTo(prev > 1 ? prev : 1));
        prev = r.interval;
        s = CardSchedule(interval: r.interval, ease: r.ease, reps: r.reps);
      }
    });
  });

  group('isDue', () {
    test('true when due is in the past or exactly now', () {
      expect(
          isDue(nowUtc.subtract(const Duration(seconds: 1)), nowUtc), isTrue);
      expect(isDue(nowUtc, nowUtc), isTrue);
    });

    test('false when due is in the future', () {
      expect(isDue(nowUtc.add(const Duration(seconds: 1)), nowUtc), isFalse);
    });

    test('a card graded again is not due now but is due in 10 minutes', () {
      final r = review(initialState(), ReviewGrade.again, nowUtc);
      expect(isDue(r.due, nowUtc), isFalse);
      expect(isDue(r.due, nowUtc.add(const Duration(minutes: 10))), isTrue);
    });
  });
}
