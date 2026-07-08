// Ported 1:1 from web tests/resume.test.ts.
import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/resume.dart';

ResumeCandidate candidate({
  required String id,
  num progressPct = 0,
  bool hasAccess = true,
  int? updatedAtMillis,
  String? lastLessonId,
}) =>
    ResumeCandidate(
      id: id,
      title: 'Course $id',
      progressPct: progressPct,
      hasAccess: hasAccess,
      updatedAtMillis: updatedAtMillis,
      lastLessonId: lastLessonId,
    );

void main() {
  group('pickResumeCourse', () {
    test('returns null for an empty list', () {
      expect(pickResumeCourse<ResumeCandidate>([]), isNull);
    });

    test('returns null when nothing is in progress (0% and 100% excluded)', () {
      final result = pickResumeCourse([
        candidate(id: 'a', progressPct: 0),
        candidate(id: 'b', progressPct: 100),
      ]);
      expect(result, isNull);
    });

    test('ignores inaccessible (locked) courses even when in progress', () {
      final result = pickResumeCourse([
        candidate(id: 'locked', progressPct: 50, hasAccess: false),
      ]);
      expect(result, isNull);
    });

    test('picks the most recently touched course when timestamps exist', () {
      final result = pickResumeCourse([
        candidate(id: 'old', progressPct: 90, updatedAtMillis: 1000),
        candidate(id: 'recent', progressPct: 10, updatedAtMillis: 9000),
        candidate(id: 'mid', progressPct: 50, updatedAtMillis: 5000),
      ]);
      expect(result?.course.id, 'recent');
      expect(result?.basis, ResumeBasis.recency);
    });

    test('prefers timestamped candidates over untimestamped ones', () {
      final result = pickResumeCourse([
        candidate(id: 'no-time', progressPct: 99),
        candidate(id: 'with-time', progressPct: 5, updatedAtMillis: 1000),
      ]);
      expect(result?.course.id, 'with-time');
      expect(result?.basis, ResumeBasis.recency);
    });

    test('falls back to highest progressPct when no timestamps exist', () {
      final result = pickResumeCourse([
        candidate(id: 'low', progressPct: 20),
        candidate(id: 'high', progressPct: 80),
        candidate(id: 'mid', progressPct: 50),
      ]);
      expect(result?.course.id, 'high');
      expect(result?.basis, ResumeBasis.progress);
    });

    test('treats non-positive timestamps as missing (progress fallback)', () {
      final result = pickResumeCourse([
        candidate(id: 'zero-ts', progressPct: 70, updatedAtMillis: 0),
        candidate(id: 'neg-ts', progressPct: 30, updatedAtMillis: -5),
      ]);
      expect(result?.course.id, 'zero-ts');
      expect(result?.basis, ResumeBasis.progress);
    });

    test('skips completed and not-started courses while choosing', () {
      final result = pickResumeCourse([
        candidate(id: 'done', progressPct: 100, updatedAtMillis: 99000),
        candidate(id: 'fresh', progressPct: 0, updatedAtMillis: 98000),
        candidate(id: 'active', progressPct: 33, updatedAtMillis: 1000),
      ]);
      expect(result?.course.id, 'active');
    });

    test('keeps the first candidate on ties (stable)', () {
      final result = pickResumeCourse([
        candidate(id: 'first', progressPct: 50, updatedAtMillis: 5000),
        candidate(id: 'second', progressPct: 50, updatedAtMillis: 5000),
      ]);
      expect(result?.course.id, 'first');
    });
  });
}
