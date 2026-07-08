// Ported 1:1 from web tests/progress.test.ts — asserts identical numeric
// outputs so mobile and web progress math stay in lock-step.
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/progress.dart';

void main() {
  group('calcProgressPct', () {
    test('returns 0 when no lessons are completed', () {
      expect(calcProgressPct([], ['l1', 'l2', 'l3']), 0);
    });

    test('returns 100 when all lessons are completed', () {
      expect(calcProgressPct(['l1', 'l2', 'l3'], ['l1', 'l2', 'l3']), 100);
    });

    test('returns correct percentage for partial completion', () {
      expect(calcProgressPct(['l1'], ['l1', 'l2', 'l3', 'l4']), 25);
    });

    test('rounds to nearest integer (1/3 -> 33)', () {
      expect(calcProgressPct(['l1'], ['l1', 'l2', 'l3']), 33);
    });

    test('returns 0 when allLessonIds is empty', () {
      expect(calcProgressPct(['l1'], []), 0);
    });

    test('ignores completed IDs not in allLessonIds', () {
      expect(calcProgressPct(['l1', 'stale-id'], ['l1', 'l2']), 50);
    });
  });

  group('isVideoWatched', () {
    test('true when position >= 80% of duration', () {
      expect(isVideoWatched(480, 600), isTrue); // 80%
      expect(isVideoWatched(599, 600), isTrue); // 99.8%
    });

    test('false when position < 80% of duration', () {
      expect(isVideoWatched(479, 600), isFalse); // 79.8%
      expect(isVideoWatched(0, 600), isFalse);
    });

    test('false when duration is 0 or negative', () {
      expect(isVideoWatched(10, 0), isFalse);
      expect(isVideoWatched(10, -1), isFalse);
    });
  });

  group('shouldSaveProgress', () {
    test('true when enough time has passed', () {
      expect(shouldSaveProgress(0, 5000, 5000), isTrue);
      expect(shouldSaveProgress(1000, 7000, 5000), isTrue);
    });

    test('false when not enough time has passed', () {
      expect(shouldSaveProgress(0, 4999, 5000), isFalse);
      expect(shouldSaveProgress(1000, 5999, 5000), isFalse);
    });

    test('uses default interval of 5000ms', () {
      expect(shouldSaveProgress(0, 5000), isTrue);
      expect(shouldSaveProgress(0, 4999), isFalse);
    });
  });
}
