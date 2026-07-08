// FirestoreService against fake_cloud_firestore — proves the ACTUAL Firestore
// read/query shapes and, critically, the WRITE shapes that the security-rules
// invariants depend on:
//   * markLessonComplete   → progress {watchedPct:100, positionSec:0,
//                            completedAt: <server ts>} + enrollment
//                            {progressPct, lastLessonId, cohortId, updatedAt}
//   * saveVideoProgress    → completedAt:null merge (never removes sibling keys)
//   * markNotificationsRead→ ONLY the readAt field mutates (rules: hasOnly
//                            ["readAt"])
//   * updateFlashcardSchedule → ONLY {interval,ease,reps,due} mutate (rules:
//                            hasOnly those four)
//   * saveLessonFeedback   → rating int, comment clamped <=1000
//   * getUser* list reads   → single-field where(userId==uid) (only own docs)
//   * getCertificate        → certId upper-cased before the get
//
// FirestoreService's constructor resolves `storage ?? FirebaseStorage.instance`
// (the RHS throws with no live Firebase app). `??` short-circuits, so passing a
// no-op fake storage keeps the RHS from evaluating; storage is never used here.
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:andela_lms_mobile/models/enrollment.dart';
import 'package:andela_lms_mobile/models/lesson_progress.dart';
import 'package:andela_lms_mobile/services/firestore_service.dart';

class _NoopStorage implements FirebaseStorage {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

FirestoreService _svc(FakeFirebaseFirestore db) =>
    FirestoreService(db: db, storage: _NoopStorage());

void main() {
  late FakeFirebaseFirestore db;
  late FirestoreService svc;

  setUp(() {
    db = FakeFirebaseFirestore();
    svc = _svc(db);
  });

  group('markLessonComplete write shape', () {
    test('writes the exact progress + enrollment doc shape', () async {
      await svc.markLessonComplete(
        uid: 'u1',
        courseId: 'c1',
        lessonId: 'L1',
        cohortId: 'coh1',
        courseProgressPct: 50,
      );

      final prog = (await db
              .collection('progress')
              .doc(LessonProgress.docId('u1', 'L1'))
              .get())
          .data()!;
      expect(prog['userId'], 'u1');
      expect(prog['lessonId'], 'L1');
      expect(prog['courseId'], 'c1');
      expect(prog['watchedPct'], 100);
      expect(prog['positionSec'], 0); // exact web parity: mark-complete sets 0
      expect(prog['completedAt'], isA<Timestamp>()); // serverTimestamp resolved

      final enr = (await db
              .collection('enrollments')
              .doc(Enrollment.docId('u1', 'c1'))
              .get())
          .data()!;
      expect(enr['userId'], 'u1');
      expect(enr['courseId'], 'c1');
      expect(enr['cohortId'], 'coh1');
      expect(enr['progressPct'], 50);
      expect(enr['lastLessonId'], 'L1');
      expect(enr['updatedAt'], isA<Timestamp>());
    });
  });

  group('saveVideoProgress', () {
    test('writes completedAt:null and merges without dropping sibling keys',
        () async {
      // Seed a completed progress doc, then a throttled video save must merge
      // the position while writing completedAt:null (the completedRef guard
      // lives in the widget; the SERVICE always writes null — proven here).
      final ref = db.collection('progress').doc(LessonProgress.docId('u1', 'L1'));
      await ref.set({
        'userId': 'u1',
        'lessonId': 'L1',
        'courseId': 'c1',
        'watchedPct': 100,
        'positionSec': 12,
        'completedAt': Timestamp.now(),
        'extra': 'keep-me',
      });

      await svc.saveVideoProgress(
        uid: 'u1',
        courseId: 'c1',
        lessonId: 'L1',
        positionSec: 42,
        watchedPct: 80,
      );

      final data = (await ref.get()).data()!;
      expect(data['positionSec'], 42);
      expect(data['watchedPct'], 80);
      expect(data['completedAt'], isNull); // written back to null
      expect(data['extra'], 'keep-me'); // merge preserved untouched keys
    });
  });

  group('notifications readAt-only write', () {
    test('markNotificationRead mutates ONLY readAt', () async {
      await db.collection('notifications').doc('n1').set({
        'userId': 'u1',
        'title': 'Hi',
        'body': 'Body',
        'link': '/x',
        'readAt': null,
        'createdAt': Timestamp.now(),
      });

      await svc.markNotificationRead('n1');

      final data = (await db.collection('notifications').doc('n1').get()).data()!;
      expect(data['readAt'], isA<Timestamp>()); // now set
      // Every other field is untouched — proves the hasOnly(["readAt"]) rule.
      expect(data['title'], 'Hi');
      expect(data['body'], 'Body');
      expect(data['link'], '/x');
      expect(data['userId'], 'u1');
    });

    test('markNotificationsRead batches readAt for each id only', () async {
      for (final id in ['n1', 'n2']) {
        await db.collection('notifications').doc(id).set({
          'userId': 'u1',
          'title': id,
          'readAt': null,
        });
      }

      await svc.markNotificationsRead(['n1', 'n2']);

      for (final id in ['n1', 'n2']) {
        final data =
            (await db.collection('notifications').doc(id).get()).data()!;
        expect(data['readAt'], isA<Timestamp>());
        expect(data['title'], id); // unchanged
      }
    });
  });

  group('flashcard scheduling write', () {
    test('updateFlashcardSchedule mutates ONLY the four scheduling fields',
        () async {
      final due = Timestamp.fromDate(DateTime(2026, 8, 1));
      await db.collection('flashcards').doc('card1').set({
        'userId': 'u1',
        'courseId': 'c1',
        'front': 'Q',
        'back': 'A',
        'interval': 0,
        'ease': 2.5,
        'reps': 0,
        'due': Timestamp.now(),
      });

      await svc.updateFlashcardSchedule('card1', {
        'interval': 3,
        'ease': 2.6,
        'reps': 2,
        'due': due,
      });

      final data = (await db.collection('flashcards').doc('card1').get()).data()!;
      expect(data['interval'], 3);
      expect(data['ease'], 2.6);
      expect(data['reps'], 2);
      expect(data['due'], due);
      // Content + ownership immutable from the client — untouched.
      expect(data['front'], 'Q');
      expect(data['back'], 'A');
      expect(data['userId'], 'u1');
      expect(data['courseId'], 'c1');
    });
  });

  group('lessonFeedback write validation shape', () {
    test('clamps comment to 1000 chars and writes an int rating', () async {
      await svc.saveLessonFeedback(
        uid: 'u1',
        lessonId: 'L1',
        courseId: 'c1',
        rating: 5,
        comment: 'x' * 1500,
      );

      final data = (await db
              .collection('lessonFeedback')
              .doc('u1_L1')
              .get())
          .data()!;
      expect(data['rating'], 5);
      expect(data['rating'], isA<int>());
      expect((data['comment'] as String).length, 1000);
      expect(data['userId'], 'u1');
    });
  });

  group('single-field owner list queries', () {
    setUp(() async {
      // Two users' docs across each owned collection; queries must return only
      // the caller's own (the where(userId==uid) rules-provable pattern).
      for (final u in ['u1', 'u2']) {
        await db.collection('progress').doc('${u}_L1').set({
          'userId': u,
          'lessonId': 'L1',
          'courseId': 'c1',
          'watchedPct': 100,
          'positionSec': 0,
          'completedAt': Timestamp.now(),
        });
        await db.collection('enrollments').doc('${u}_c1').set({
          'userId': u,
          'courseId': 'c1',
          'cohortId': '',
          'progressPct': 10,
        });
        await db.collection('attempts').doc('${u}_a').set({
          'userId': u,
          'assessmentId': 'as1',
          'courseId': 'c1',
          'kind': 'quiz',
          'score': 1,
          'total': 1,
          'passed': true,
        });
        await db.collection('certificates').doc('CERT-$u').set({
          'certId': 'CERT-$u',
          'userId': u,
          'courseId': 'c1',
          'courseTitle': 'C',
          'learnerName': 'N',
        });
        await db.collection('flashcards').doc('fc-$u').set({
          'userId': u,
          'courseId': 'c1',
          'front': 'q',
          'back': 'a',
          'interval': 0,
          'ease': 2.5,
          'reps': 0,
          'due': Timestamp.now(),
        });
      }
    });

    test('each owner query returns only the caller\'s docs', () async {
      expect((await svc.getUserProgress('u1')).map((p) => p.userId), ['u1']);
      expect((await svc.getUserEnrollments('u1')).map((e) => e.userId), ['u1']);
      expect((await svc.getUserAttempts('u1')).map((a) => a.userId), ['u1']);
      expect(
          (await svc.getUserCertificates('u1')).map((c) => c.userId), ['u1']);
      expect((await svc.getUserFlashcards('u1')).map((f) => f.userId), ['u1']);
    });

    test('getCourseProgress filters client-side by courseId', () async {
      await db.collection('progress').doc('u1_L2').set({
        'userId': 'u1',
        'lessonId': 'L2',
        'courseId': 'other',
        'watchedPct': 100,
        'positionSec': 0,
        'completedAt': Timestamp.now(),
      });
      final byLesson = await svc.getCourseProgress('u1', 'c1');
      expect(byLesson.keys, ['L1']); // the 'other' course lesson is excluded
    });
  });

  group('getCertificate', () {
    test('upper-cases the certId before the get (verify parity)', () async {
      await db.collection('certificates').doc('ABC123').set({
        'certId': 'ABC123',
        'userId': 'u1',
        'courseId': 'c1',
        'courseTitle': 'C',
        'learnerName': 'N',
      });
      final cert = await svc.getCertificate('abc123');
      expect(cert, isNotNull);
      expect(cert!.certId, 'ABC123');
    });

    test('returns null for an unknown certId', () async {
      expect(await svc.getCertificate('nope'), isNull);
    });
  });
}
