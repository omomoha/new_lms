// ReviewController — due/future split by `due`, nextDue selection, generate
// error mapping, and the schedule-persist pass-through.
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/app_user.dart';
import 'package:andela_lms_mobile/models/course.dart';
import 'package:andela_lms_mobile/models/flashcard.dart';
import 'package:andela_lms_mobile/services/callable_service.dart';
import 'package:andela_lms_mobile/state/review_controller.dart';

import '../support/fakes.dart';

Flashcard _card(String id, DateTime due) => Flashcard(
      id: id,
      userId: 'u1',
      courseId: 'c1',
      front: 'q',
      back: 'a',
      interval: 0,
      ease: 2.5,
      reps: 0,
      due: due,
    );

AppUser _user() => const AppUser(
      uid: 'u1',
      email: 'a@x.com',
      name: 'Ada',
      role: 'learner',
      cohortIds: [],
      status: 'active',
    );

void main() {
  late FakeFirestoreService fs;
  late FakeCallableService cs;

  setUp(() {
    fs = FakeFirestoreService();
    cs = FakeCallableService();
  });
  tearDown(() => fs.dispose());

  test('splits due (<=now) from future and selects the earliest future as nextDue',
      () async {
    final past = DateTime.now().subtract(const Duration(days: 1));
    final soon = DateTime.now().add(const Duration(days: 2));
    final later = DateTime.now().add(const Duration(days: 5));
    fs.flashcards = [_card('a', past), _card('b', later), _card('c', soon)];
    fs.published = [
      const Course(
        id: 'c1',
        title: 't',
        description: '',
        status: 'published',
        moduleOrder: [],
        assignedCohortIds: [],
        availability: 'all',
      ),
    ];

    final c = ReviewController(firestore: fs, callable: cs);
    await c.load(_user());

    expect(c.dueCards.map((x) => x.id), ['a']);
    expect(c.nextDue!.millisecondsSinceEpoch, soon.millisecondsSinceEpoch);
    c.dispose();
  });

  test('generate maps resource-exhausted to the hourly-limit message', () async {
    fs.flashcards = [];
    fs.published = [];
    cs.genThrow =
        const CallableException('resource-exhausted', 'limit');
    final c = ReviewController(firestore: fs, callable: cs);
    await c.load(_user());
    c.selectCourse('c1');
    await c.generate();
    expect(c.genError, contains('hourly limit'));
    c.dispose();
  });

  test('saveSchedule forwards the exact map to updateFlashcardSchedule',
      () async {
    fs.flashcards = [];
    fs.published = [];
    final c = ReviewController(firestore: fs, callable: cs);
    await c.load(_user());
    final update = {'interval': 1, 'ease': 2.5, 'reps': 1, 'due': 123};
    await c.saveSchedule('card1', update);
    expect(fs.flashcardUpdates.single, update);
    c.dispose();
  });

  test('accessible-course selector honours availability=all', () async {
    fs.flashcards = [];
    fs.published = [
      const Course(
        id: 'cAll',
        title: 'Open',
        description: '',
        status: 'published',
        moduleOrder: [],
        assignedCohortIds: [],
        availability: 'all',
      ),
      const Course(
        id: 'cLocked',
        title: 'Locked',
        description: '',
        status: 'published',
        moduleOrder: [],
        assignedCohortIds: ['zzz'],
        availability: 'cohorts',
      ),
    ];
    final c = ReviewController(firestore: fs, callable: cs);
    await c.load(_user());
    expect(c.courses.map((x) => x.id), ['cAll']);
    expect(c.selectedCourseId, 'cAll');
    c.dispose();
  });
}
