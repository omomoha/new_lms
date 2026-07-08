// Pure-unit tests for logic/discussions.dart (7C). Ports tests/discussions.test.ts
// (buildThreads grouping + canDelete author/admin).

import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/discussions.dart';
import 'package:andela_lms_mobile/models/discussion.dart';

Discussion _doc({
  required String id,
  String userId = 'u1',
  String? parentId,
  int? createdAtMillis = 1000,
}) =>
    Discussion(
      id: id,
      courseId: 'c1',
      lessonId: 'l1',
      userId: userId,
      userName: 'Ada',
      body: 'Hello',
      parentId: parentId,
      createdAtMillis: createdAtMillis,
    );

void main() {
  group('buildThreads', () {
    test('empty in → empty out', () {
      expect(buildThreads(const []), isEmpty);
    });

    test('top-level newest-first', () {
      final t = buildThreads([
        _doc(id: 'old', createdAtMillis: 1000),
        _doc(id: 'new', createdAtMillis: 3000),
        _doc(id: 'mid', createdAtMillis: 2000),
      ]);
      expect(t.map((x) => x.post.id), ['new', 'mid', 'old']);
    });

    test('replies oldest-first under their parent', () {
      final t = buildThreads([
        _doc(id: 'q1', createdAtMillis: 1000),
        _doc(id: 'r-late', parentId: 'q1', createdAtMillis: 5000),
        _doc(id: 'r-early', parentId: 'q1', createdAtMillis: 2000),
        _doc(id: 'r-mid', parentId: 'q1', createdAtMillis: 3000),
      ]);
      expect(t, hasLength(1));
      expect(t.first.replies.map((r) => r.id), ['r-early', 'r-mid', 'r-late']);
    });

    test('drops orphan replies (missing parent)', () {
      final t = buildThreads([
        _doc(id: 'q1'),
        _doc(id: 'orphan', parentId: 'deleted', createdAtMillis: 2000),
      ]);
      expect(t, hasLength(1));
      expect(t.first.replies, isEmpty);
    });

    test('drops replies that point at another reply (no nesting)', () {
      final t = buildThreads([
        _doc(id: 'q1', createdAtMillis: 1000),
        _doc(id: 'r1', parentId: 'q1', createdAtMillis: 2000),
        _doc(id: 'nested', parentId: 'r1', createdAtMillis: 3000),
      ]);
      expect(t.first.replies.map((r) => r.id), ['r1']);
    });
  });

  group('canDelete', () {
    test('author may delete own', () {
      expect(
          canDelete(
              viewerUid: 'u1', viewerRole: 'learner', post: _doc(id: 'x', userId: 'u1')),
          isTrue);
    });
    test('learner may not delete another', () {
      expect(
          canDelete(
              viewerUid: 'u1', viewerRole: 'learner', post: _doc(id: 'x', userId: 'u2')),
          isFalse);
    });
    test('admin may delete anyone', () {
      expect(
          canDelete(
              viewerUid: 'a', viewerRole: 'admin', post: _doc(id: 'x', userId: 'u2')),
          isTrue);
    });
    test('empty uid denied even when post userId empty', () {
      expect(canDelete(viewerUid: '', post: _doc(id: 'x', userId: '')), isFalse);
    });
  });
}
