// LessonController.markComplete — pct recompute over ALL lessons and the
// completedAt guard (already-complete lessons are not re-written).
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/course.dart';
import 'package:andela_lms_mobile/models/course_module.dart';
import 'package:andela_lms_mobile/models/enrollment.dart';
import 'package:andela_lms_mobile/models/lesson.dart';
import 'package:andela_lms_mobile/models/lesson_progress.dart';
import 'package:andela_lms_mobile/state/lesson_controller.dart';

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

Lesson _lesson(String id, int order) =>
    Lesson(id: id, title: id, type: LessonType.text, order: order);

LessonProgress _completed(String lessonId) => LessonProgress(
      userId: 'u1',
      lessonId: lessonId,
      courseId: 'c1',
      watchedPct: 100,
      positionSec: 0,
      completedAt: DateTime.fromMillisecondsSinceEpoch(1000),
    );

void _wire(FakeFirestoreService fs) {
  fs.course = _course();
  fs.modules = const [
    CourseModule(id: 'm1', title: 'M1', order: 0, lessonOrder: []),
    CourseModule(id: 'm2', title: 'M2', order: 1, lessonOrder: []),
  ];
  fs.lessonsByModule = {
    'm1': [_lesson('L1', 0), _lesson('L2', 1)],
    'm2': [_lesson('L3', 0), _lesson('L4', 1)],
  };
  fs.enrollment = Enrollment(
    userId: 'u1',
    courseId: 'c1',
    cohortId: 'cohortA',
    progressPct: 25,
    lastLessonId: 'L1',
    updatedAt: DateTime.now(),
  );
}

void main() {
  late FakeFirestoreService fs;

  setUp(() => fs = FakeFirestoreService());
  tearDown(() => fs.dispose());

  test('markComplete recomputes pct over ALL lessons (1 prior + this = 2/4 = 50)',
      () async {
    _wire(fs);
    fs.courseProgress = {'L1': _completed('L1')};
    final c = LessonController(
      firestore: fs,
      courseId: 'c1',
      lessonId: 'L2',
      uid: 'u1',
      cohortId: 'cohortA',
    );
    await c.load();
    await c.markComplete();

    expect(fs.markCallCount, 1);
    expect(fs.markCall!.lessonId, 'L2');
    expect(fs.markCall!.courseProgressPct, 50.0);
    // Local reflection so the UI updates immediately.
    expect(c.currentCompleted, isTrue);
    expect(c.enrollmentPct, 50);
    c.dispose();
  });

  test('markComplete preserves the existing enrollment cohortId', () async {
    _wire(fs);
    fs.courseProgress = {};
    final c = LessonController(
      firestore: fs,
      courseId: 'c1',
      lessonId: 'L1',
      uid: 'u1',
      cohortId: 'fallbackCohort',
    );
    await c.load();
    await c.markComplete();
    expect(fs.markCall!.cohortId, 'cohortA'); // from existing enrollment
    c.dispose();
  });

  test('completedAt guard: markComplete is a no-op when already completed', () async {
    _wire(fs);
    fs.courseProgress = {'L1': _completed('L1')};
    final c = LessonController(
      firestore: fs,
      courseId: 'c1',
      lessonId: 'L1', // already completed
      uid: 'u1',
      cohortId: 'cohortA',
    );
    await c.load();
    expect(c.currentCompleted, isTrue);
    await c.markComplete();
    expect(fs.markCallCount, 0); // never re-written → completedAt not clobbered
    c.dispose();
  });

  test('nextLessonId walks the flattened module→lesson order', () async {
    _wire(fs);
    fs.courseProgress = {};
    final c = LessonController(
      firestore: fs,
      courseId: 'c1',
      lessonId: 'L2',
      uid: 'u1',
      cohortId: 'cohortA',
    );
    await c.load();
    expect(c.nextLessonId, 'L3'); // crosses the module boundary
    c.dispose();
  });
}
