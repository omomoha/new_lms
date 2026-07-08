// AchievementsController — XP/level derivation from own-readable data, the
// passed-attempts client-side filter, and leaderboard error mapping.
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/attempt.dart';
import 'package:andela_lms_mobile/models/assessment.dart';
import 'package:andela_lms_mobile/models/certificate.dart';
import 'package:andela_lms_mobile/models/lesson_progress.dart';
import 'package:andela_lms_mobile/services/callable_service.dart';
import 'package:andela_lms_mobile/state/achievements_controller.dart';

import '../support/fakes.dart';

LessonProgress _p(String id, DateTime? completedAt) => LessonProgress(
      userId: 'u1',
      lessonId: id,
      courseId: 'c1',
      watchedPct: 100,
      positionSec: 0,
      completedAt: completedAt,
    );

Attempt _a(String id, bool passed) => Attempt(
      id: id,
      userId: 'u1',
      assessmentId: 'as-$id',
      courseId: 'c1',
      kind: AssessmentKind.quiz,
      score: passed ? 10 : 1,
      total: 10,
      passed: passed,
      submittedAt: DateTime.now(),
    );

void main() {
  late FakeFirestoreService fs;
  late FakeCallableService cs;

  setUp(() {
    fs = FakeFirestoreService();
    cs = FakeCallableService();
  });
  tearDown(() => fs.dispose());

  test('derives lessonsCompleted / quizzesPassed / certificates and XP=180',
      () async {
    final now = DateTime.now();
    fs.progress = [
      _p('L1', now),
      _p('L2', now),
      _p('L3', now),
      _p('L4', null), // no completedAt → not counted
    ];
    // 2 passed + 1 failed → passed filtered client-side.
    fs.attempts = [_a('1', true), _a('2', true), _a('3', false)];
    fs.certificates = [
      const Certificate(
        certId: 'X',
        userId: 'u1',
        learnerName: 'Ada',
        courseId: 'c1',
        courseTitle: 't',
      ),
    ];

    final c = AchievementsController(firestore: fs, callable: cs);
    await c.load('u1', const []); // no cohort → skips board

    final s = c.summary!;
    expect(s.stats.lessonsCompleted, 3);
    expect(s.stats.quizzesPassed, 2);
    expect(s.stats.certificates, 1);
    // XP = 3*10 + 2*25 + 1*100 = 180
    expect(s.xp, 180);
    expect(s.level.level, 2); // 100 <= 180 < 250
    c.dispose();
  });

  test('loads the primary-cohort leaderboard', () async {
    fs.progress = [];
    fs.attempts = [];
    fs.certificates = [];
    cs.board = const LeaderboardResult(
      cohortName: 'Cohort A',
      rows: [
        LeaderboardRow(
            name: 'Ada', xp: 200, lessonsCompleted: 5, certificates: 1, isYou: true),
      ],
      truncated: false,
    );
    final c = AchievementsController(firestore: fs, callable: cs);
    await c.load('u1', const ['cohortA']);
    expect(c.board, isNotNull);
    expect(c.board!.cohortName, 'Cohort A');
    expect(c.boardCohort, 'cohortA');
    c.dispose();
  });

  test('maps resource-exhausted to the rate-limit message', () async {
    fs.progress = [];
    fs.attempts = [];
    fs.certificates = [];
    cs.boardThrow =
        const CallableException('resource-exhausted', 'slow down');
    final c = AchievementsController(firestore: fs, callable: cs);
    await c.load('u1', const ['cohortA']);
    expect(c.boardError, contains('too often'));
    c.dispose();
  });
}
