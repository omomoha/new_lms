// DashboardController — access/locked computation, resume selection, streak
// wiring, and the "one enrollments query + one progress query" read budget.
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/logic/resume.dart';
import 'package:andela_lms_mobile/models/app_user.dart';
import 'package:andela_lms_mobile/models/cohort.dart';
import 'package:andela_lms_mobile/models/course.dart';
import 'package:andela_lms_mobile/models/enrollment.dart';
import 'package:andela_lms_mobile/state/dashboard_controller.dart';

import '../support/fakes.dart';

Course _course(String id,
        {String availability = 'cohorts',
        List<String> assigned = const [],
        String title = 't'}) =>
    Course(
      id: id,
      title: title,
      description: 'd',
      status: 'published',
      moduleOrder: const [],
      assignedCohortIds: assigned,
      availability: availability,
    );

AppUser _user(List<String> cohorts) => AppUser(
      uid: 'u1',
      email: 'a@x.com',
      name: 'Ada Lovelace',
      role: 'learner',
      cohortIds: cohorts,
      status: 'active',
    );

void main() {
  late FakeFirestoreService fs;
  late DashboardController c;

  setUp(() {
    fs = FakeFirestoreService();
    c = DashboardController(firestore: fs);
  });

  tearDown(() {
    c.dispose();
    fs.dispose();
  });

  test('computes access: availability=all and cohort overlap are accessible, '
      'unassigned cohort course is locked', () async {
    fs.published = [
      _course('cAll', availability: 'all', title: 'Open to all'),
      _course('cMine', availability: 'cohorts', assigned: ['cohortA'], title: 'Mine'),
      _course('cOther', availability: 'cohorts', assigned: ['cohortZ'], title: 'Other'),
    ];
    fs.cohortIds = ['cohortA'];
    await c.load(_user(['cohortA']));

    final byId = {for (final r in c.courses) r.course.id: r};
    expect(byId['cAll']!.hasAccess, isTrue);
    expect(byId['cMine']!.hasAccess, isTrue);
    expect(byId['cOther']!.hasAccess, isFalse);
  });

  test('sorts accessible courses before locked ones', () async {
    fs.published = [
      _course('cOther', assigned: ['cohortZ']), // locked
      _course('cAll', availability: 'all'), // accessible
    ];
    fs.cohortIds = [];
    await c.load(_user([]));
    expect(c.courses.first.hasAccess, isTrue);
    expect(c.courses.last.hasAccess, isFalse);
  });

  test('resume picks most-recently-touched in-progress course; excludes '
      'completed (100%) and locked', () async {
    fs.published = [
      _course('c1', availability: 'all'),
      _course('c2', availability: 'all'),
      _course('c3', availability: 'all'),
    ];
    fs.cohortIds = [];
    fs.enrollments = [
      Enrollment(
        userId: 'u1',
        courseId: 'c1',
        cohortId: '',
        progressPct: 40,
        lastLessonId: 'L1',
        updatedAt: DateTime.fromMillisecondsSinceEpoch(1000),
      ),
      Enrollment(
        userId: 'u1',
        courseId: 'c2',
        cohortId: '',
        progressPct: 60,
        lastLessonId: 'L9',
        updatedAt: DateTime.fromMillisecondsSinceEpoch(5000), // most recent
      ),
      Enrollment(
        userId: 'u1',
        courseId: 'c3',
        cohortId: '',
        progressPct: 100, // complete → excluded
        updatedAt: DateTime.fromMillisecondsSinceEpoch(9000),
      ),
    ];
    await c.load(_user([]));

    final ResumeSelection? sel = c.resume;
    expect(sel, isNotNull);
    expect(sel!.course.course.id, 'c2');
    expect(sel.basis, ResumeBasis.recency);
  });

  test('resume is null when nothing is in progress', () async {
    fs.published = [_course('c1', availability: 'all')];
    fs.cohortIds = [];
    fs.enrollments = [];
    await c.load(_user([]));
    expect(c.resume, isNull);
  });

  test('streak stats are computed from completion dates', () async {
    fs.published = [_course('c1', availability: 'all')];
    fs.cohortIds = [];
    final now = DateTime.now();
    fs.dates = [now, now.subtract(const Duration(days: 1))];
    await c.load(_user([]));
    expect(c.streaks, isNotNull);
    expect(c.streaks!.currentStreak, greaterThanOrEqualTo(1));
  });

  test('read budget: exactly one enrollments query and one progress query', () async {
    fs.published = [_course('c1', availability: 'all')];
    fs.cohortIds = [];
    await c.load(_user([]));
    expect(fs.enrollmentsQueries, 1);
    expect(fs.progressQueries, 1); // completionDates (streak) — single query
    expect(fs.publishedQueries, 1);
  });

  test('due date resolved from earliest member-cohort courseDueDates', () async {
    fs.published = [_course('c1', availability: 'all')];
    fs.cohortIds = ['cohortA'];
    final due = DateTime.now().add(const Duration(days: 3));
    fs.memberCohorts = [
      Cohort(
        id: 'cohortA',
        name: 'A',
        tag: '',
        color: '',
        courseIds: const [],
        courseDueDates: {'c1': Timestamp.fromDate(due)},
      ),
    ];
    await c.load(_user(['cohortA']));
    final row = c.courses.firstWhere((r) => r.course.id == 'c1');
    expect(row.dueMillis, isNotNull);
    expect(row.dueMillis, due.millisecondsSinceEpoch);
  });

  test('search filters case/diacritic-insensitively on title', () async {
    fs.published = [
      _course('c1', availability: 'all', title: 'Álgebra'),
      _course('c2', availability: 'all', title: 'Biology'),
    ];
    fs.cohortIds = [];
    await c.load(_user([]));

    c.setQuery('algebra');
    expect(c.visibleCourses.length, 1);
    expect(c.visibleCourses.single.course.id, 'c1');
    expect(c.isSearching, isTrue);
  });
}
