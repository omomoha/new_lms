// CourseController — pre/post gating flags, certificate eligibility, and the
// permission-denied → locked state.
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/assessment.dart';
import 'package:andela_lms_mobile/models/attempt.dart';
import 'package:andela_lms_mobile/models/course.dart';
import 'package:andela_lms_mobile/models/course_module.dart';
import 'package:andela_lms_mobile/models/enrollment.dart';
import 'package:andela_lms_mobile/models/lesson.dart';
import 'package:andela_lms_mobile/state/course_controller.dart';

import '../support/fakes.dart';

Course _course() => const Course(
      id: 'c1',
      title: 't',
      description: '',
      status: 'published',
      moduleOrder: [],
      assignedCohortIds: [],
      availability: 'all',
    );

Assessment _assessment(String id, AssessmentKind kind) => Assessment(
      id: id,
      courseId: 'c1',
      kind: kind,
      title: id,
      passMark: 70,
      questions: const [],
    );

Attempt _attempt(String assessmentId, bool passed) => Attempt(
      id: '$assessmentId-a',
      userId: 'u1',
      assessmentId: assessmentId,
      courseId: 'c1',
      kind: AssessmentKind.post,
      score: passed ? 10 : 1,
      total: 10,
      passed: passed,
      submittedAt: DateTime.now(),
    );

void _base(FakeFirestoreService fs, {required double progressPct}) {
  fs.course = _course();
  fs.modules = const [
    CourseModule(id: 'm1', title: 'M1', order: 0, lessonOrder: []),
  ];
  fs.lessonsByModule = {
    'm1': [Lesson(id: 'L1', title: 'L1', type: LessonType.text, order: 0)],
  };
  fs.enrollment = Enrollment(
    userId: 'u1',
    courseId: 'c1',
    cohortId: 'cohortA',
    progressPct: progressPct,
    lastLessonId: 'L1',
    updatedAt: DateTime.now(),
  );
  fs.courseProgress = {};
}

CourseController _controller(FakeFirestoreService fs) => CourseController(
      firestore: fs,
      callable: FakeCallableService(),
      courseId: 'c1',
      uid: 'u1',
    );

void main() {
  late FakeFirestoreService fs;
  setUp(() => fs = FakeFirestoreService());
  tearDown(() => fs.dispose());

  test('certEligible: complete course with NO post assessment', () async {
    _base(fs, progressPct: 100);
    fs.assessments = [];
    final c = _controller(fs);
    await c.load();
    expect(c.courseComplete, isTrue);
    expect(c.certEligible, isTrue);
    c.dispose();
  });

  test('certEligible false when complete but post exists and is not passed',
      () async {
    _base(fs, progressPct: 100);
    fs.assessments = [_assessment('post1', AssessmentKind.post)];
    fs.attempts = []; // no attempt
    final c = _controller(fs);
    await c.load();
    expect(c.certEligible, isFalse);
    c.dispose();
  });

  test('certEligible true when complete and post passed', () async {
    _base(fs, progressPct: 100);
    fs.assessments = [_assessment('post1', AssessmentKind.post)];
    fs.attempts = [_attempt('post1', true)];
    final c = _controller(fs);
    await c.load();
    expect(c.certEligible, isTrue);
    c.dispose();
  });

  test('certEligible false when course not complete', () async {
    _base(fs, progressPct: 60);
    fs.assessments = [];
    final c = _controller(fs);
    await c.load();
    expect(c.certEligible, isFalse);
    c.dispose();
  });

  test('post is locked behind an untaken pre-assessment', () async {
    _base(fs, progressPct: 100);
    fs.assessments = [
      _assessment('pre1', AssessmentKind.pre),
      _assessment('post1', AssessmentKind.post),
    ];
    fs.attempts = []; // neither taken
    final c = _controller(fs);
    await c.load();
    expect(c.postLockedByPre, isTrue);
    expect(c.showPostBanner, isFalse); // banner hidden while pre outstanding
    c.dispose();
  });

  test('post banner shows once pre is taken and course complete', () async {
    _base(fs, progressPct: 100);
    fs.assessments = [
      _assessment('pre1', AssessmentKind.pre),
      _assessment('post1', AssessmentKind.post),
    ];
    fs.attempts = [_attempt('pre1', false)]; // pre attempted (pass irrelevant)
    final c = _controller(fs);
    await c.load();
    expect(c.postLockedByPre, isFalse);
    expect(c.showPostBanner, isTrue);
    c.dispose();
  });

  test('permission-denied on modules read → locked state', () async {
    fs.course = _course();
    fs.modulesThrow = FirebaseException(
      plugin: 'cloud_firestore',
      code: 'permission-denied',
      message: 'denied',
    );
    final c = _controller(fs);
    await c.load();
    expect(c.permissionDenied, isTrue);
    expect(c.loading, isFalse);
    c.dispose();
  });

  test('latest attempt wins when multiple exist for one assessment', () async {
    _base(fs, progressPct: 100);
    fs.assessments = [_assessment('post1', AssessmentKind.post)];
    final older = Attempt(
      id: 'old',
      userId: 'u1',
      assessmentId: 'post1',
      courseId: 'c1',
      kind: AssessmentKind.post,
      score: 1,
      total: 10,
      passed: false,
      submittedAt: DateTime.fromMillisecondsSinceEpoch(1000),
    );
    final newer = Attempt(
      id: 'new',
      userId: 'u1',
      assessmentId: 'post1',
      courseId: 'c1',
      kind: AssessmentKind.post,
      score: 9,
      total: 10,
      passed: true,
      submittedAt: DateTime.fromMillisecondsSinceEpoch(9000),
    );
    fs.attempts = [older, newer];
    final c = _controller(fs);
    await c.load();
    expect(c.postAttempt!.id, 'new');
    expect(c.certEligible, isTrue);
    c.dispose();
  });
}
