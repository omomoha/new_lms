// FirestoreService community-forum WRITE-SHAPE tests on fake_cloud_firestore.
//
// These prove the client only ever writes the exact field-sets that
// firestore.rules validate — the security invariant the whole forum leans on:
//   * createForumThread  → fixed initial shape, pinned/locked false,
//                          replyCount 0, and NEVER moderation/moderationReason.
//   * editForumThread    → only title/body/editedAt change (threadAuthorEditKeys).
//   * createForumReply   → author-as-self, no reactions on create.
//   * editForumPost      → only body/editedAt change (postAuthorEditKeys).
//   * toggleForumReaction→ reactions-only diff (reactionOnlyChange); empty lists
//                          are pruned from the map.
//   * reportForumContent → reporter-as-self, resolved:false, postId null-able.

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

/// createForumThread is intentionally fire-and-forget (returns the id before the
/// server ack). Let the queued microtask settle before reading the doc back.
Future<void> _settle() => Future<void>.delayed(Duration.zero);

void main() {
  late FakeFirebaseFirestore db;
  late FirestoreService svc;

  setUp(() {
    db = FakeFirebaseFirestore();
    svc = _svc(db);
  });

  group('createForumThread', () {
    test('writes ONLY the rules-allowed keys with fixed initial shape',
        () async {
      final res = svc.createForumThread(
        categoryId: 'cat1',
        authorId: 'u1',
        authorName: 'Ada',
        title: '  Hello  ',
        body: '  world  ',
        tags: const ['a', 'b'],
      );
      await res.ack;
      await _settle();
      final data =
          (await db.collection('forumThreads').doc(res.id).get()).data()!;

      expect(
        data.keys.toSet(),
        {
          'categoryId',
          'authorId',
          'authorName',
          'title',
          'body',
          'pinned',
          'locked',
          'replyCount',
          'tags',
          'createdAt',
          'lastReplyAt',
        },
      );
      expect(data['authorId'], 'u1');
      expect(data['title'], 'Hello'); // trimmed
      expect(data['body'], 'world'); // trimmed
      expect(data['pinned'], false);
      expect(data['locked'], false);
      expect(data['replyCount'], 0);
      expect(data['tags'], ['a', 'b']);
      // Admin-only fields must NEVER be written by the client.
      expect(data.containsKey('moderation'), isFalse);
      expect(data.containsKey('moderationReason'), isFalse);
    });

    test('clamps tags to 8 and clamps title/body/name lengths', () async {
      final res = svc.createForumThread(
        categoryId: 'c',
        authorId: 'u1',
        authorName: 'n' * 200,
        title: 't' * 300,
        body: 'b' * 6000,
        tags: List.generate(20, (i) => 't$i'),
      );
      await res.ack;
      await _settle();
      final data =
          (await db.collection('forumThreads').doc(res.id).get()).data()!;
      expect((data['tags'] as List).length, 8);
      expect((data['authorName'] as String).length, 100);
      expect((data['title'] as String).length, 200);
      expect((data['body'] as String).length, 5000);
    });
  });

  group('editForumThread', () {
    test('changes ONLY title/body/editedAt; never clobbers pinned/locked',
        () async {
      final ref = db.collection('forumThreads').doc('t1');
      await ref.set({
        'categoryId': 'c',
        'authorId': 'u1',
        'authorName': 'Ada',
        'title': 'old',
        'body': 'old body',
        'pinned': false,
        'locked': false,
        'replyCount': 3,
        'tags': const [],
        'createdAt': Timestamp.now(),
        'lastReplyAt': Timestamp.now(),
      });

      await svc.editForumThread(id: 't1', title: 'new', body: 'new body');
      final data = (await ref.get()).data()!;

      expect(data['title'], 'new');
      expect(data['body'], 'new body');
      expect(data.containsKey('editedAt'), isTrue);
      // Untouched admin/counter fields survive unchanged.
      expect(data['pinned'], false);
      expect(data['locked'], false);
      expect(data['replyCount'], 3);
      // No stray keys introduced beyond the original set + editedAt.
      expect(
        data.keys.toSet().difference({
          'categoryId', 'authorId', 'authorName', 'title', 'body', 'pinned',
          'locked', 'replyCount', 'tags', 'createdAt', 'lastReplyAt', 'editedAt',
        }),
        isEmpty,
      );
    });
  });

  group('createForumReply', () {
    test('writes ONLY allowed keys, no reactions on create', () async {
      await svc.createForumReply(
        threadId: 't1',
        authorId: 'u2',
        authorName: 'Bob',
        body: '  reply  ',
        parentId: null,
      );
      final snap =
          await db.collection('forumThreads').doc('t1').collection('posts').get();
      expect(snap.docs, hasLength(1));
      final data = snap.docs.first.data();
      expect(data.keys.toSet(),
          {'authorId', 'authorName', 'body', 'parentId', 'createdAt'});
      expect(data['authorId'], 'u2');
      expect(data['body'], 'reply');
      expect(data['parentId'], isNull);
      expect(data.containsKey('reactions'), isFalse);
    });

    test('preserves a non-null parentId for a threaded reply', () async {
      await svc.createForumReply(
        threadId: 't1',
        authorId: 'u2',
        authorName: 'Bob',
        body: 'child',
        parentId: 'top1',
      );
      final snap =
          await db.collection('forumThreads').doc('t1').collection('posts').get();
      expect(snap.docs.first.data()['parentId'], 'top1');
    });
  });

  group('editForumPost', () {
    test('changes ONLY body/editedAt', () async {
      final ref = db
          .collection('forumThreads')
          .doc('t1')
          .collection('posts')
          .doc('p1');
      await ref.set({
        'authorId': 'u2',
        'authorName': 'Bob',
        'body': 'old',
        'parentId': null,
        'createdAt': Timestamp.now(),
      });
      await svc.editForumPost(threadId: 't1', postId: 'p1', body: 'new');
      final data = (await ref.get()).data()!;
      expect(data['body'], 'new');
      expect(data.containsKey('editedAt'), isTrue);
      expect(data['authorId'], 'u2'); // untouched
      expect(
        data.keys.toSet().difference(
            {'authorId', 'authorName', 'body', 'parentId', 'createdAt', 'editedAt'}),
        isEmpty,
      );
    });
  });

  group('toggleForumReaction (reactions-only diff)', () {
    late DocumentReference<Map<String, dynamic>> ref;
    setUp(() async {
      ref = db.collection('forumThreads').doc('t1').collection('posts').doc('p1');
      await ref.set({
        'authorId': 'u2',
        'authorName': 'Bob',
        'body': 'hi',
        'parentId': null,
        'createdAt': Timestamp.now(),
        'reactions': <String, dynamic>{},
      });
    });

    test('adding a reaction writes ONLY the reactions field', () async {
      await svc.toggleForumReaction(
          threadId: 't1', postId: 'p1', emoji: '👍', uid: 'me');
      final data = (await ref.get()).data()!;
      expect(data['reactions'], {
        '👍': ['me']
      });
      // The author/body/etc are unchanged — this is a reactions-only diff.
      expect(data['authorId'], 'u2');
      expect(data['body'], 'hi');
    });

    test('toggling twice removes the uid and prunes the empty emoji key',
        () async {
      await svc.toggleForumReaction(
          threadId: 't1', postId: 'p1', emoji: '👍', uid: 'me');
      await svc.toggleForumReaction(
          threadId: 't1', postId: 'p1', emoji: '👍', uid: 'me');
      final data = (await ref.get()).data()!;
      expect((data['reactions'] as Map).containsKey('👍'), isFalse);
    });

    test('no-op on a missing post', () async {
      await svc.toggleForumReaction(
          threadId: 't1', postId: 'missing', emoji: '👍', uid: 'me');
      final snap = await db
          .collection('forumThreads')
          .doc('t1')
          .collection('posts')
          .doc('missing')
          .get();
      expect(snap.exists, isFalse);
    });
  });

  group('reportForumContent', () {
    test('writes reporter-as-self, resolved:false, exact key set (thread)',
        () async {
      await svc.reportForumContent(
        reporterId: 'me',
        reporterName: 'Me',
        threadId: 't1',
        reason: '  spam  ',
      );
      final snap = await db.collection('forumReports').get();
      final data = snap.docs.first.data();
      expect(data.keys.toSet(), {
        'reporterId',
        'reporterName',
        'threadId',
        'postId',
        'reason',
        'resolved',
        'createdAt',
      });
      expect(data['reporterId'], 'me');
      expect(data['reason'], 'spam'); // trimmed
      expect(data['resolved'], false);
      expect(data['postId'], isNull);
    });

    test('carries a non-null postId when reporting a reply', () async {
      await svc.reportForumContent(
        reporterId: 'me',
        reporterName: 'Me',
        threadId: 't1',
        postId: 'p9',
        reason: 'bad',
      );
      final snap = await db.collection('forumReports').get();
      expect(snap.docs.first.data()['postId'], 'p9');
    });
  });

  group('deletes', () {
    test('deleteForumThread / deleteForumPost remove the docs', () async {
      await db.collection('forumThreads').doc('t1').set({'authorId': 'u1'});
      await db
          .collection('forumThreads')
          .doc('t1')
          .collection('posts')
          .doc('p1')
          .set({'authorId': 'u1'});
      await svc.deleteForumPost('t1', 'p1');
      await svc.deleteForumThread('t1');
      expect((await db.collection('forumThreads').doc('t1').get()).exists,
          isFalse);
    });
  });
}
