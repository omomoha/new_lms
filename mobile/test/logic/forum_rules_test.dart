// Pure-unit tests for logic/forum_rules.dart (7B). Ports the web expectations in
// tests/forum.test.ts: canViewCategory, visibleCategories, sortThreads,
// sortPostsChronological, searchThreads, canEdit (15-min boundary),
// canModerate/canAdminister, plus the mobile-only visibleThreads pending filter
// (client-side hide of moderation=="pending" for non-admins, §2.8 of the plan).

import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/forum_rules.dart';
import 'package:andela_lms_mobile/models/forum.dart';

ForumCategory _cat({
  required String id,
  String name = 'General',
  int order = 0,
  String visibility = 'all',
  List<String> cohortIds = const [],
}) =>
    ForumCategory(
      id: id,
      name: name,
      description: '',
      order: order,
      visibility: visibility,
      cohortIds: cohortIds,
      aiModeration: false,
      postCount: 0,
      lastActivityAtMillis: null,
    );

ForumThread _thread({
  required String id,
  String title = 'Title',
  String body = 'Body',
  bool pinned = false,
  List<String> tags = const [],
  String? moderation,
  int? createdAtMillis = 1000,
  int? lastReplyAtMillis = 1000,
}) =>
    ForumThread(
      id: id,
      categoryId: 'cat1',
      authorId: 'u1',
      authorName: 'Ada',
      title: title,
      body: body,
      pinned: pinned,
      locked: false,
      replyCount: 0,
      tags: tags,
      moderation: moderation,
      moderationReason: null,
      createdAtMillis: createdAtMillis,
      lastReplyAtMillis: lastReplyAtMillis,
      editedAtMillis: null,
    );

ForumPost _post({required String id, int? createdAtMillis = 1000}) => ForumPost(
      id: id,
      authorId: 'u1',
      authorName: 'Ada',
      body: 'hi',
      parentId: null,
      createdAtMillis: createdAtMillis,
      editedAtMillis: null,
      reactions: const {},
    );

void main() {
  group('canViewCategory', () {
    test('admin sees everything including cohort categories', () {
      expect(
        canViewCategory(
            role: 'admin',
            cohortIds: const [],
            category: _cat(id: 'x', visibility: 'cohort', cohortIds: ['c9'])),
        isTrue,
      );
    });
    test('any learner sees "all" categories', () {
      expect(
          canViewCategory(cohortIds: const [], category: _cat(id: 'a')), isTrue);
    });
    test('cohort category visible only on cohort intersection', () {
      expect(
        canViewCategory(
            cohortIds: const ['c1'],
            category: _cat(id: 'x', visibility: 'cohort', cohortIds: ['c1'])),
        isTrue,
      );
      expect(
        canViewCategory(
            cohortIds: const ['c2'],
            category: _cat(id: 'x', visibility: 'cohort', cohortIds: ['c1'])),
        isFalse,
      );
    });
    test('cohort category with no cohortIds hidden from learners', () {
      expect(
        canViewCategory(
            cohortIds: const ['c1'],
            category: _cat(id: 'x', visibility: 'cohort')),
        isFalse,
      );
    });
  });

  group('visibleCategories', () {
    test('filters by access, sorts by order then name', () {
      final cats = [
        _cat(id: 'b', name: 'Beta', order: 1),
        _cat(id: 'a', name: 'Alpha', order: 1),
        _cat(id: 'secret', name: 'Secret', order: 0, visibility: 'cohort', cohortIds: ['x']),
        _cat(id: 'mine', name: 'Mine', order: 0, visibility: 'cohort', cohortIds: ['c1']),
      ];
      final out = visibleCategories(cohortIds: const ['c1'], categories: cats);
      expect(out.map((c) => c.id), ['mine', 'a', 'b']);
    });
  });

  group('sortThreads', () {
    test('pinned first, then last activity newest-first', () {
      final out = sortThreads([
        _thread(id: 'a', lastReplyAtMillis: 5000),
        _thread(id: 'pinned-old', pinned: true, lastReplyAtMillis: 1000),
        _thread(id: 'b', lastReplyAtMillis: 8000),
      ]);
      expect(out.map((t) => t.id), ['pinned-old', 'b', 'a']);
    });
    test('falls back to createdAt when lastReplyAt is null', () {
      final out = sortThreads([
        _thread(id: 'x', lastReplyAtMillis: null, createdAtMillis: 2000),
        _thread(id: 'y', lastReplyAtMillis: null, createdAtMillis: 5000),
      ]);
      expect(out.map((t) => t.id), ['y', 'x']);
    });
  });

  group('sortPostsChronological', () {
    test('oldest-first with null last', () {
      final out = sortPostsChronological([
        _post(id: 'c', createdAtMillis: 3000),
        _post(id: 'pending', createdAtMillis: null),
        _post(id: 'a', createdAtMillis: 1000),
      ]);
      expect(out.map((p) => p.id), ['a', 'c', 'pending']);
    });
  });

  group('searchThreads', () {
    final threads = [
      _thread(id: '1', title: 'Async/await in JS', body: 'promises'),
      _thread(id: '2', title: 'CSS grid', body: 'layout', tags: ['frontend']),
      _thread(id: '3', title: 'Café tips', body: 'résumé writing'),
    ];
    test('empty query returns all', () {
      expect(searchThreads(threads, '  ').map((t) => t.id), ['1', '2', '3']);
    });
    test('matches title, body, tags case/diacritic-insensitively', () {
      expect(searchThreads(threads, 'PROMISES').map((t) => t.id), ['1']);
      expect(searchThreads(threads, 'frontend').map((t) => t.id), ['2']);
      expect(searchThreads(threads, 'cafe').map((t) => t.id), ['3']);
      expect(searchThreads(threads, 'resume').map((t) => t.id), ['3']);
    });
  });

  group('canEdit (time-boxed 15-min window)', () {
    const now = 1000000;
    test('admin can always edit', () {
      expect(
          canEdit(
              viewerUid: 'x',
              viewerRole: 'admin',
              authorId: 'u1',
              createdAtMillis: 0,
              nowMillis: now),
          isTrue);
    });
    test('author can edit within the window', () {
      expect(
          canEdit(
              viewerUid: 'u1',
              authorId: 'u1',
              createdAtMillis: now - 1000,
              nowMillis: now),
          isTrue);
    });
    test('boundary: exactly editWindowMs old is still editable', () {
      expect(
          canEdit(
              viewerUid: 'u1',
              authorId: 'u1',
              createdAtMillis: now - editWindowMs,
              nowMillis: now),
          isTrue);
    });
    test('author cannot edit one ms after the window', () {
      expect(
          canEdit(
              viewerUid: 'u1',
              authorId: 'u1',
              createdAtMillis: now - editWindowMs - 1,
              nowMillis: now),
          isFalse);
    });
    test('pending write (null createdAt) is editable by the author', () {
      expect(
          canEdit(
              viewerUid: 'u1',
              authorId: 'u1',
              createdAtMillis: null,
              nowMillis: now),
          isTrue);
    });
    test('non-author cannot edit', () {
      expect(
          canEdit(
              viewerUid: 'u2',
              authorId: 'u1',
              createdAtMillis: now,
              nowMillis: now),
          isFalse);
    });
  });

  group('canModerate / canAdminister', () {
    test('author or admin may moderate', () {
      expect(canModerate(viewerUid: 'u1', authorId: 'u1'), isTrue);
      expect(canModerate(viewerUid: 'x', viewerRole: 'admin', authorId: 'u1'),
          isTrue);
      expect(canModerate(viewerUid: 'u2', authorId: 'u1'), isFalse);
    });
    test('only admins may administer', () {
      expect(canAdminister(role: 'admin'), isTrue);
      expect(canAdminister(role: 'learner'), isFalse);
      expect(canAdminister(), isFalse);
    });
  });

  group('visibleThreads (pending-moderation client filter)', () {
    final threads = [
      _thread(id: 'ok'),
      _thread(id: 'pending', moderation: 'pending'),
    ];
    test('non-admin does NOT see pending threads', () {
      expect(visibleThreads(threads: threads).map((t) => t.id), ['ok']);
    });
    test('learner role does NOT see pending threads', () {
      expect(visibleThreads(role: 'learner', threads: threads).map((t) => t.id),
          ['ok']);
    });
    test('admin sees pending threads', () {
      expect(visibleThreads(role: 'admin', threads: threads).map((t) => t.id),
          ['ok', 'pending']);
    });
  });

  group('constants match the web palette + bounds', () {
    test('reaction palette + limits', () {
      expect(reactionEmoji, ['👍', '❤️', '🎉', '👀']);
      expect(editWindowMs, 15 * 60 * 1000);
      expect(maxTitleLength, 200);
      expect(maxBodyLength, 5000);
      expect(maxNameLength, 100);
    });
  });
}
