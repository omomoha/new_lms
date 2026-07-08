// Pure-unit tests for logic/threading.dart — the shared single-level threading
// helpers used by both the community forum (7B) and per-lesson discussions (7C).
// Ports the web expectations in tests/forum.test.ts + tests/discussions.test.ts
// (buildThreadTree section) verbatim: newest-first top level, oldest-first
// replies, orphan/reply-to-reply drop, null-timestamp-last, id tie-break.

import 'package:flutter_test/flutter_test.dart';
import 'package:andela_lms_mobile/logic/threading.dart';

/// Minimal concrete [ThreadNode] for exercising the generic helpers.
class _Node implements ThreadNode {
  @override
  final String id;
  @override
  final String? parentId;
  @override
  final int? createdAtMillis;
  const _Node(this.id, {this.parentId, this.createdAtMillis = 1000});
}

void main() {
  group('buildThreadTree', () {
    test('returns empty for empty input', () {
      expect(buildThreadTree(<_Node>[]), isEmpty);
    });

    test('top-level newest-first, replies oldest-first, drops orphans + nested',
        () {
      final docs = [
        const _Node('q-old', createdAtMillis: 1000),
        const _Node('q-new', createdAtMillis: 3000),
        const _Node('r-late', parentId: 'q-new', createdAtMillis: 9000),
        const _Node('r-early', parentId: 'q-new', createdAtMillis: 4000),
        const _Node('orphan', parentId: 'missing', createdAtMillis: 5000),
        const _Node('nested', parentId: 'r-late', createdAtMillis: 6000),
      ];
      final tree = buildThreadTree(docs);
      expect(tree.map((t) => t.post.id), ['q-new', 'q-old']);
      expect(tree.first.replies.map((r) => r.id), ['r-early', 'r-late']);
    });

    test('attaches replies to the correct parent across multiple threads', () {
      final docs = [
        const _Node('q1', createdAtMillis: 1000),
        const _Node('q2', createdAtMillis: 2000),
        const _Node('r1', parentId: 'q1', createdAtMillis: 3000),
        const _Node('r2', parentId: 'q2', createdAtMillis: 4000),
      ];
      final tree = buildThreadTree(docs);
      expect(tree.map((t) => t.post.id), ['q2', 'q1']);
      expect(tree[0].replies.map((r) => r.id), ['r2']);
      expect(tree[1].replies.map((r) => r.id), ['r1']);
    });

    test('sorts null timestamps last (pending server write)', () {
      final docs = [
        const _Node('pending', createdAtMillis: null),
        const _Node('newest', createdAtMillis: 9000),
        const _Node('oldest', createdAtMillis: 1000),
      ];
      expect(
        buildThreadTree(docs).map((t) => t.post.id),
        ['newest', 'oldest', 'pending'],
      );
    });

    test('reply with null timestamp sorts last under its parent', () {
      final docs = [
        const _Node('q1', createdAtMillis: 1000),
        const _Node('r-pending', parentId: 'q1', createdAtMillis: null),
        const _Node('r-old', parentId: 'q1', createdAtMillis: 2000),
      ];
      expect(buildThreadTree(docs).first.replies.map((r) => r.id),
          ['r-old', 'r-pending']);
    });

    test('ties break deterministically on id', () {
      final docs = [
        const _Node('b', createdAtMillis: 1000),
        const _Node('a', createdAtMillis: 1000),
      ];
      expect(buildThreadTree(docs).map((t) => t.post.id), ['a', 'b']);
    });
  });

  group('comparators', () {
    test('compareNewestFirst: newer first, null last, id tie-break', () {
      expect(
          compareNewestFirst(const _Node('a', createdAtMillis: 2000),
                  const _Node('b', createdAtMillis: 1000)) <
              0,
          isTrue);
      expect(
          compareNewestFirst(const _Node('a', createdAtMillis: null),
                  const _Node('b', createdAtMillis: 1000)),
          1);
      expect(
          compareNewestFirst(const _Node('a', createdAtMillis: 1000),
              const _Node('b', createdAtMillis: 1000)),
          lessThan(0)); // 'a' < 'b'
    });

    test('compareOldestFirst: older first, null last', () {
      expect(
          compareOldestFirst(const _Node('a', createdAtMillis: 1000),
                  const _Node('b', createdAtMillis: 2000)) <
              0,
          isTrue);
      expect(
          compareOldestFirst(const _Node('a', createdAtMillis: null),
                  const _Node('b', createdAtMillis: 2000)),
          1);
    });
  });

  group('isAuthorOrAdmin', () {
    test('author may modify own', () {
      expect(isAuthorOrAdmin(viewerUid: 'u1', authorId: 'u1'), isTrue);
    });
    test('admin may modify anyone', () {
      expect(
          isAuthorOrAdmin(viewerUid: 'x', viewerRole: 'admin', authorId: 'u2'),
          isTrue);
    });
    test('non-author non-admin cannot', () {
      expect(isAuthorOrAdmin(viewerUid: 'u1', authorId: 'u2'), isFalse);
    });
    test('empty uid denied even against empty author', () {
      expect(isAuthorOrAdmin(viewerUid: '', authorId: ''), isFalse);
    });
  });
}
