// Ported 1:1 from web tests/streaks.test.ts.
// NOTE: JS Date months are 0-indexed; Dart DateTime months are 1-indexed.
// Every web `new Date(2026, 5, ...)` (June) becomes `DateTime(2026, 6, ...)`.
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/streaks.dart';

// Fixed "now": Wednesday 10 June 2026, 18:00 local time.
final DateTime now = DateTime(2026, 6, 10, 18, 0, 0);

DateTime on(int day, [int hour = 12, int minute = 0]) =>
    DateTime(2026, 6, day, hour, minute, 0);

void main() {
  group('computeStreaks', () {
    test('returns all zeroes for an empty history', () {
      final s = computeStreaks([], now);
      expect(s.currentStreak, 0);
      expect(s.longestStreak, 0);
      expect(s.activeToday, isFalse);
      expect(s.thisWeekCount, 0);
      expect(s.weeklyGoal, 5);
      expect(kWeeklyGoal, 5);
    });

    test('handles a single completion today', () {
      final s = computeStreaks([on(10, 9)], now);
      expect(s.currentStreak, 1);
      expect(s.longestStreak, 1);
      expect(s.activeToday, isTrue);
      expect(s.thisWeekCount, 1);
    });

    test('keeps the streak alive when only yesterday is active', () {
      final s = computeStreaks([on(9)], now);
      expect(s.currentStreak, 1);
      expect(s.activeToday, isFalse);
    });

    test('treats a completion 2 days ago as a broken streak', () {
      final s = computeStreaks([on(8)], now);
      expect(s.currentStreak, 0);
      expect(s.longestStreak, 1);
      expect(s.activeToday, isFalse);
    });

    test('a gap splits runs: counts only the run touching today/yesterday', () {
      final s = computeStreaks([on(6), on(7), on(9), on(10)], now);
      expect(s.currentStreak, 2);
      expect(s.longestStreak, 2);
      expect(s.activeToday, isTrue);
    });

    test('counts a multi-week run spanning month boundaries', () {
      final dates = <DateTime>[];
      for (var i = 0; i < 14; i++) {
        // 28 May -> 10 June (rolls over into June)
        dates.add(DateTime(2026, 5, 28 + i, 10));
      }
      final s = computeStreaks(dates, now);
      expect(s.currentStreak, 14);
      expect(s.longestStreak, 14);
      expect(s.activeToday, isTrue);
      expect(s.thisWeekCount, 3); // Mon 8 -> Wed 10
    });

    test('collapses same-day for streaks but counts each toward weekly total',
        () {
      final s = computeStreaks(
        [on(10, 8), on(10, 12), on(10, 16), on(9, 9), on(9, 20)],
        now,
      );
      expect(s.currentStreak, 2);
      expect(s.longestStreak, 2);
      expect(s.thisWeekCount, 5);
    });

    test('tracks the longest streak separately from the current one', () {
      final past = [1, 2, 3, 4, 5].map((d) => DateTime(2026, 5, d, 10)).toList();
      final s = computeStreaks([...past, on(10)], now);
      expect(s.currentStreak, 1);
      expect(s.longestStreak, 5);
    });

    test('handles day boundaries: 23:59 and 00:01 land on adjacent days', () {
      final s = computeStreaks([on(9, 23, 59), on(10, 0, 1)], now);
      expect(s.currentStreak, 2);
      expect(s.longestStreak, 2);
      expect(s.activeToday, isTrue);
    });

    test("excludes last week's completions from thisWeekCount", () {
      final s = computeStreaks([on(7), on(8), on(8, 15), on(9)], now);
      expect(s.thisWeekCount, 3);
      expect(s.currentStreak, 3);
      expect(s.longestStreak, 3);
    });

    test("works when 'now' is a Monday (week resets)", () {
      final monday = DateTime(2026, 6, 8, 9, 0, 0);
      final s = computeStreaks([on(7), on(8, 8)], monday);
      expect(s.thisWeekCount, 1);
      expect(s.currentStreak, 2);
      expect(s.activeToday, isTrue);
    });
  });
}
