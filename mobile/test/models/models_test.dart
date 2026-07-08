// Model fromDoc / toMap round-trips against representative Firestore maps,
// using fake_cloud_firestore so DocumentSnapshot has the real API surface.
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/logic/due_dates.dart';
import 'package:andela_lms_mobile/logic/spaced_repetition.dart';
import 'package:andela_lms_mobile/models/app_user.dart';
import 'package:andela_lms_mobile/models/course.dart';
import 'package:andela_lms_mobile/models/course_module.dart';
import 'package:andela_lms_mobile/models/lesson.dart';
import 'package:andela_lms_mobile/models/enrollment.dart';
import 'package:andela_lms_mobile/models/lesson_progress.dart';
import 'package:andela_lms_mobile/models/cohort.dart';
import 'package:andela_lms_mobile/models/assessment.dart';
import 'package:andela_lms_mobile/models/attempt.dart';
import 'package:andela_lms_mobile/models/certificate.dart';
import 'package:andela_lms_mobile/models/flashcard.dart';
import 'package:andela_lms_mobile/models/app_notification.dart';
import 'package:andela_lms_mobile/models/lesson_feedback.dart';

void main() {
  late FakeFirebaseFirestore db;
  setUp(() => db = FakeFirebaseFirestore());

  Future<DocumentSnapshot<Map<String, dynamic>>> seed(
      String col, String id, Map<String, dynamic> data) async {
    await db.collection(col).doc(id).set(data);
    return db.collection(col).doc(id).get();
  }

  test('AppUser.fromDoc parses fields and role/status defaults', () async {
    final snap = await seed('users', 'uid1', {
      'email': 'ada@x.com',
      'name': 'Ada',
      'role': 'learner',
      'cohortIds': ['c1', 'c2'],
      'status': 'active',
    });
    final u = AppUser.fromDoc(snap);
    expect(u.uid, 'uid1');
    expect(u.email, 'ada@x.com');
    expect(u.role, 'learner');
    expect(u.isLearner, isTrue);
    expect(u.cohortIds, ['c1', 'c2']);
    expect(u.status, 'active');

    // Missing role/status fall back to sane defaults.
    final bare = AppUser.fromDoc(await seed('users', 'uid2', {}));
    expect(bare.role, 'learner');
    expect(bare.status, 'active');
  });

  test('Course.fromDoc parses availability + cert fields; hasAccessFor', () async {
    final snap = await seed('courses', 'crs1', {
      'title': 'Docker',
      'description': 'Containers',
      'status': 'published',
      'moduleOrder': ['m1'],
      'assignedCohortIds': ['cohortA'],
      'availability': 'cohorts',
      'thumbPath': 'thumbs/a.png',
      'certTemplatePath': 'tpl.png',
      'certSignatoryName': 'Dr Who',
    });
    final c = Course.fromDoc(snap);
    expect(c.availability, 'cohorts');
    expect(c.certTemplatePath, 'tpl.png');
    expect(c.certSignatoryName, 'Dr Who');
    expect(c.hasAccessFor(['cohortA']), isTrue);
    expect(c.hasAccessFor(['other']), isFalse);

    final open =
        Course.fromDoc(await seed('courses', 'crs2', {'availability': 'all'}));
    expect(open.hasAccessFor(const []), isTrue); // availability:all -> open
    // default availability when absent is "cohorts"
    final def = Course.fromDoc(await seed('courses', 'crs3', {}));
    expect(def.availability, 'cohorts');
  });

  test('CourseModule.fromDoc parses order + lessonOrder', () async {
    final m = CourseModule.fromDoc(await seed('modules', 'm1', {
      'title': 'Week 1',
      'order': 2,
      'lessonOrder': ['l1', 'l2'],
    }));
    expect(m.order, 2);
    expect(m.lessonOrder, ['l1', 'l2']);
  });

  test('Lesson.fromDoc parses union fields (video + captions + transcript)',
      () async {
    final l = Lesson.fromDoc(await seed('lessons', 'l1', {
      'title': 'Intro',
      'type': 'video',
      'order': 0,
      'videoUrl': 'https://youtu.be/dQw4w9WgXcQ',
      'captionsPath': 'caps/l1.vtt',
      'transcript': 'hello world',
    }));
    expect(l.type, LessonType.video);
    expect(l.videoUrl, 'https://youtu.be/dQw4w9WgXcQ');
    expect(l.captionsPath, 'caps/l1.vtt');
    expect(l.transcript, 'hello world');

    final unknown =
        Lesson.fromDoc(await seed('lessons', 'l2', {'type': 'podcast'}));
    expect(unknown.type, LessonType.unknown);
  });

  test('Enrollment.fromDoc exposes updatedAtMillis + docId', () async {
    final when = DateTime(2026, 6, 1, 10);
    final e = Enrollment.fromDoc(await seed('enrollments', 'uid1_crs1', {
      'userId': 'uid1',
      'courseId': 'crs1',
      'cohortId': 'cohortA',
      'progressPct': 42,
      'lastLessonId': 'l3',
      'updatedAt': Timestamp.fromDate(when),
    }));
    expect(e.progressPct, 42.0);
    expect(e.lastLessonId, 'l3');
    expect(e.updatedAtMillis, when.millisecondsSinceEpoch);
    expect(Enrollment.docId('uid1', 'crs1'), 'uid1_crs1');
  });

  test('LessonProgress.fromDoc completedAt -> isCompleted', () async {
    final done = LessonProgress.fromDoc(await seed('progress', 'uid1_l1', {
      'userId': 'uid1',
      'lessonId': 'l1',
      'courseId': 'crs1',
      'watchedPct': 100,
      'positionSec': 30,
      'completedAt': Timestamp.fromDate(DateTime(2026, 6, 2)),
    }));
    expect(done.isCompleted, isTrue);
    expect(done.watchedPct, 100.0);
    expect(done.positionSec, 30);

    final open = LessonProgress.fromDoc(await seed('progress', 'uid1_l2', {
      'userId': 'uid1',
      'lessonId': 'l2',
      'courseId': 'crs1',
    }));
    expect(open.isCompleted, isFalse);
    expect(LessonProgress.docId('uid1', 'l1'), 'uid1_l1');
  });

  test('Cohort.fromDoc courseDueDates + toDueDateCohort feeds resolveDueDate',
      () async {
    final due = DateTime(2026, 7, 1);
    final cohort = Cohort.fromDoc(await seed('cohorts', 'cohortA', {
      'name': 'Q1',
      'tag': 'q1',
      'color': '#fff',
      'courseIds': ['crs1'],
      'courseDueDates': {'crs1': Timestamp.fromDate(due)},
    }));
    expect(cohort.courseDueDates['crs1'], isNotNull);
    final resolved = resolveDueDate('crs1', [cohort.toDueDateCohort()]);
    expect(resolved, due.millisecondsSinceEpoch);
  });

  test('Assessment.fromDoc parses questions and NEVER carries answers', () async {
    final a = Assessment.fromDoc(await seed('assessments', 'a1', {
      'courseId': 'crs1',
      'kind': 'quiz',
      'lessonId': 'l9',
      'title': 'Quiz 1',
      'passMark': 70,
      'questions': [
        {'id': 'q1', 'prompt': '2+2?', 'type': 'mcq', 'options': ['3', '4']},
      ],
    }));
    expect(a.kind, AssessmentKind.quiz);
    expect(a.lessonId, 'l9');
    expect(a.passMark, 70);
    expect(a.questions.single.options, ['3', '4']);
    // Correct-answer keys must not be modelled anywhere on the question.
    expect((a.questions.single as dynamic).toString(), isNot(contains('answer')));
  });

  test('Attempt.fromDoc scorePct', () async {
    final at = Attempt.fromDoc(await seed('attempts', 'uid1_a1_x', {
      'userId': 'uid1',
      'assessmentId': 'a1',
      'courseId': 'crs1',
      'kind': 'quiz',
      'score': 3,
      'total': 4,
      'passed': true,
    }));
    expect(at.scorePct, 75);
    expect(at.passed, isTrue);
  });

  test('Certificate.fromDoc falls back to doc id when certId absent', () async {
    final c = Certificate.fromDoc(await seed('certificates', 'CERT123', {
      'userId': 'uid1',
      'courseId': 'crs1',
      'courseTitle': 'Docker',
      'learnerName': 'Ada',
    }));
    expect(c.certId, 'CERT123');
    expect(c.courseTitle, 'Docker');
  });

  test('Flashcard.fromDoc schedule + scheduleUpdate writes only 4 fields',
      () async {
    final f = Flashcard.fromDoc(await seed('flashcards', 'card1', {
      'userId': 'uid1',
      'courseId': 'crs1',
      'front': 'Q',
      'back': 'A',
      'interval': 3,
      'ease': 2.35,
      'reps': 2,
      'due': Timestamp.fromDate(DateTime(2026, 6, 10)),
    }));
    expect(f.schedule.interval, 3);
    expect(f.schedule.ease, 2.35);
    expect(f.schedule.reps, 2);

    final r = review(f.schedule, ReviewGrade.good, DateTime.utc(2026, 6, 10));
    final update = Flashcard.scheduleUpdate(r);
    expect(update.keys.toSet(), {'interval', 'ease', 'reps', 'due'});
    expect(update['due'], isA<Timestamp>());
  });

  test('AppNotification.fromDoc readAt -> isRead', () async {
    final unread = AppNotification.fromDoc(await seed('notifications', 'n1', {
      'userId': 'uid1',
      'title': 'Hi',
      'body': 'b',
      'link': '/x',
    }));
    expect(unread.isRead, isFalse);

    final read = AppNotification.fromDoc(await seed('notifications', 'n2', {
      'userId': 'uid1',
      'readAt': Timestamp.fromDate(DateTime(2026, 6, 10)),
    }));
    expect(read.isRead, isTrue);
  });

  test('LessonFeedback.toMap writes rules-permitted fields; docId', () {
    const fb = LessonFeedback(
        userId: 'uid1', lessonId: 'l1', rating: 4, comment: 'good');
    final map = fb.toMap();
    expect(map['userId'], 'uid1');
    expect(map['lessonId'], 'l1');
    expect(map['rating'], 4);
    expect(map['comment'], 'good');
    expect(map.containsKey('updatedAt'), isTrue);
    expect(LessonFeedback.docId('uid1', 'l1'), 'uid1_l1');
  });
}
