// FirestoreService WRITE/READ-SHAPE tests for tutor feedback (7A) and lesson
// discussions (7C) on fake_cloud_firestore.
//
//   * submitTutorFeedback → uid-prefixed doc id, rating/reason bounds, exact
//                           key set. (rules: feedbackId matches uid_.+, rating
//                           in {up,down}, reason <=1000)
//   * tutorConversations  → the service exposes READS ONLY; there is no client
//                           writer (rules: allow write:false). Verified by
//                           reading a server-seeded doc.
//   * createDiscussion    → exact key set; body 1..2000, userName <=100.
//   * fetchDiscussions    → the two-equality (courseId AND lessonId) query; a
//                           lessonId mismatch returns nothing.

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter_test/flutter_test.dart';
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

  group('submitTutorFeedback', () {
    test('uid-prefixed doc id + exact key set + values', () async {
      await svc.submitTutorFeedback(
        uid: 'u1',
        conversationId: 'conv9',
        turnIndex: 3,
        courseId: 'c1',
        rating: 'up',
        reason: 'clear',
      );
      final ref = db.collection('tutorFeedback').doc('u1_conv9_3');
      final data = (await ref.get()).data()!;
      expect(data.keys.toSet(), {
        'userId',
        'conversationId',
        'turnIndex',
        'courseId',
        'rating',
        'reason',
        'createdAt',
      });
      expect(data['userId'], 'u1');
      expect(data['rating'], 'up');
      expect(data['turnIndex'], 3);
      expect(data['reason'], 'clear');
      // Doc-id begins with "<uid>_" so the rule feedbackId.matches(uid + "_.+")
      // holds.
      expect(ref.id.startsWith('u1_'), isTrue);
    });

    test('re-rating overwrites the same doc (never duplicates)', () async {
      await svc.submitTutorFeedback(
          uid: 'u1', conversationId: 'c', turnIndex: 1, courseId: 'x', rating: 'up');
      await svc.submitTutorFeedback(
          uid: 'u1', conversationId: 'c', turnIndex: 1, courseId: 'x', rating: 'down');
      final all = await db.collection('tutorFeedback').get();
      expect(all.docs, hasLength(1));
      expect(all.docs.first.data()['rating'], 'down');
    });

    test('reason is clamped to 1000 chars', () async {
      await svc.submitTutorFeedback(
        uid: 'u1',
        conversationId: 'c',
        turnIndex: 0,
        courseId: 'x',
        rating: 'down',
        reason: 'z' * 5000,
      );
      final data =
          (await db.collection('tutorFeedback').doc('u1_c_0').get()).data()!;
      expect((data['reason'] as String).length, 1000);
    });
  });

  group('tutorConversations is read-only for the client', () {
    test('reads a server-seeded conversation; no client writer exists',
        () async {
      // Simulate the server (admin SDK) having persisted a conversation.
      await db
          .collection('users')
          .doc('u1')
          .collection('tutorConversations')
          .doc('k1')
          .set({
        'title': 'What is X?',
        'courseId': 'c1',
        'turns': [
          {'role': 'user', 'content': 'hi', 'at': 1},
          {'role': 'assistant', 'content': 'hello', 'at': 2},
        ],
        'updatedAt': Timestamp.now(),
      });

      final list = await svc.getTutorConversations('u1');
      expect(list, hasLength(1));
      expect(list.first.title, 'What is X?');
      expect(list.first.turns, hasLength(2));

      final one = await svc.getTutorConversation('u1', 'k1');
      expect(one, isNotNull);
      expect(one!.courseId, 'c1');
      // NOTE: FirestoreService intentionally provides NO method that writes to
      // users/{uid}/tutorConversations (rules: allow write: if false). This is
      // asserted by the surface: only getTutorConversations / getTutorConversation
      // exist. Any client write attempt would be denied server-side.
    });
  });

  group('createDiscussion', () {
    test('writes ONLY the rules-allowed key set', () async {
      await svc.createDiscussion(
        courseId: 'c1',
        lessonId: 'l1',
        uid: 'u1',
        userName: 'Ada',
        body: '  a question  ',
        parentId: null,
      );
      final snap = await db.collection('discussions').get();
      final data = snap.docs.first.data();
      expect(data.keys.toSet(), {
        'courseId',
        'lessonId',
        'userId',
        'userName',
        'body',
        'parentId',
        'createdAt',
      });
      expect(data['userId'], 'u1');
      expect(data['body'], 'a question'); // trimmed
      expect(data['parentId'], isNull);
    });

    test('clamps body to 2000 and userName to 100', () async {
      await svc.createDiscussion(
        courseId: 'c1',
        lessonId: 'l1',
        uid: 'u1',
        userName: 'n' * 300,
        body: 'b' * 5000,
        parentId: 'q1',
      );
      final data = (await db.collection('discussions').get()).docs.first.data();
      expect((data['body'] as String).length, 2000);
      expect((data['userName'] as String).length, 100);
      expect(data['parentId'], 'q1');
    });
  });

  group('fetchDiscussions two-equality query', () {
    setUp(() async {
      await db.collection('discussions').add({
        'courseId': 'c1',
        'lessonId': 'l1',
        'userId': 'u1',
        'userName': 'Ada',
        'body': 'match',
        'parentId': null,
        'createdAt': Timestamp.now(),
      });
      await db.collection('discussions').add({
        'courseId': 'c1',
        'lessonId': 'OTHER',
        'userId': 'u1',
        'userName': 'Ada',
        'body': 'wrong lesson',
        'parentId': null,
        'createdAt': Timestamp.now(),
      });
    });

    test('returns only docs matching BOTH courseId and lessonId', () async {
      final out = await svc.fetchDiscussions('c1', 'l1');
      expect(out, hasLength(1));
      expect(out.first.body, 'match');
    });

    test('a mismatched lessonId yields nothing', () async {
      expect(await svc.fetchDiscussions('c1', 'nope'), isEmpty);
    });
  });

  group('deleteDiscussion', () {
    test('removes the doc', () async {
      final ref = await db.collection('discussions').add({
        'courseId': 'c1',
        'lessonId': 'l1',
        'userId': 'u1',
        'userName': 'Ada',
        'body': 'x',
        'parentId': null,
        'createdAt': Timestamp.now(),
      });
      await svc.deleteDiscussion(ref.id);
      expect((await db.collection('discussions').doc(ref.id).get()).exists,
          isFalse);
    });
  });
}
