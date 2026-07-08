import 'package:cloud_firestore/cloud_firestore.dart';

import '../logic/threading.dart';

/// Community Forum models (Phase 7B), flattened for client use.
///
/// Mirror the web shapes in `src/lib/forum.ts` (`ForumCategoryDoc`,
/// `ForumThreadDoc`, `ForumPostDoc`) and the collections' fields exactly:
///   - forumCategories/{id}
///   - forumThreads/{id}
///   - forumThreads/{id}/posts/{postId}
/// Timestamps are coerced to *Millis (Timestamp.millisecondsSinceEpoch, or null
/// while a local write is still pending) so the pure logic in
/// logic/forum_rules.dart + logic/threading.dart stays framework-free.

String _str(dynamic v, [String fallback = '']) =>
    v is String ? v : fallback;

int? _millis(dynamic v) => v is Timestamp ? v.millisecondsSinceEpoch : null;

/// forumCategories/{id} — read-only for learners (admin-managed).
class ForumCategory {
  final String id;
  final String name;
  final String description;
  final int order;
  final String visibility; // "all" | "cohort"
  final List<String> cohortIds;
  final bool aiModeration;
  final int postCount;
  final int? lastActivityAtMillis;

  const ForumCategory({
    required this.id,
    required this.name,
    required this.description,
    required this.order,
    required this.visibility,
    required this.cohortIds,
    required this.aiModeration,
    required this.postCount,
    required this.lastActivityAtMillis,
  });

  factory ForumCategory.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final x = doc.data() ?? <String, dynamic>{};
    return ForumCategory(
      id: doc.id,
      name: _str(x['name'], 'Untitled'),
      description: _str(x['description']),
      order: x['order'] is num ? (x['order'] as num).toInt() : 0,
      visibility: x['visibility'] == 'cohort' ? 'cohort' : 'all',
      cohortIds:
          x['cohortIds'] is List ? List<String>.from(x['cohortIds'] as List) : const [],
      aiModeration: x['aiModeration'] == true,
      postCount: x['postCount'] is num ? (x['postCount'] as num).toInt() : 0,
      lastActivityAtMillis: _millis(x['lastActivityAt']),
    );
  }
}

/// forumThreads/{id} — the topic / original post.
class ForumThread {
  final String id;
  final String categoryId;
  final String authorId;
  final String authorName;
  final String title;
  final String body;
  final bool pinned;
  final bool locked;
  final int replyCount;
  final List<String> tags;

  /// Learner-visible moderation state. Threads with "pending" are hidden from
  /// non-admins client-side (there is no rule-level hide — mirror the web UI).
  final String? moderation; // e.g. "pending" | null
  final String? moderationReason;

  final int? createdAtMillis;
  final int? lastReplyAtMillis;
  final int? editedAtMillis;

  const ForumThread({
    required this.id,
    required this.categoryId,
    required this.authorId,
    required this.authorName,
    required this.title,
    required this.body,
    required this.pinned,
    required this.locked,
    required this.replyCount,
    required this.tags,
    required this.moderation,
    required this.moderationReason,
    required this.createdAtMillis,
    required this.lastReplyAtMillis,
    required this.editedAtMillis,
  });

  bool get isPending => moderation == 'pending';

  factory ForumThread.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final x = doc.data() ?? <String, dynamic>{};
    return ForumThread(
      id: doc.id,
      categoryId: _str(x['categoryId']),
      authorId: _str(x['authorId']),
      authorName: _str(x['authorName'], 'Member'),
      title: _str(x['title'], '(untitled)'),
      body: _str(x['body']),
      pinned: x['pinned'] == true,
      locked: x['locked'] == true,
      replyCount:
          x['replyCount'] is num ? (x['replyCount'] as num).toInt() : 0,
      tags: x['tags'] is List ? List<String>.from(x['tags'] as List) : const [],
      moderation: x['moderation'] is String ? x['moderation'] as String : null,
      moderationReason:
          x['moderationReason'] is String ? x['moderationReason'] as String : null,
      createdAtMillis: _millis(x['createdAt']),
      lastReplyAtMillis: _millis(x['lastReplyAt']),
      editedAtMillis: _millis(x['editedAt']),
    );
  }
}

/// forumThreads/{id}/posts/{postId} — a reply within a thread. Implements
/// [ThreadNode] so it can feed the shared single-level threading helpers.
class ForumPost implements ThreadNode {
  @override
  final String id;
  final String authorId;
  final String authorName;
  final String body;
  @override
  final String? parentId; // null = top-level; else the top-level post id
  @override
  final int? createdAtMillis;
  final int? editedAtMillis;

  /// emoji → list of uids who reacted with it.
  final Map<String, List<String>> reactions;

  const ForumPost({
    required this.id,
    required this.authorId,
    required this.authorName,
    required this.body,
    required this.parentId,
    required this.createdAtMillis,
    required this.editedAtMillis,
    required this.reactions,
  });

  factory ForumPost.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final x = doc.data() ?? <String, dynamic>{};
    final raw = x['reactions'];
    final reactions = <String, List<String>>{};
    if (raw is Map) {
      raw.forEach((k, v) {
        if (v is List) reactions[k.toString()] = List<String>.from(v);
      });
    }
    return ForumPost(
      id: doc.id,
      authorId: _str(x['authorId']),
      authorName: _str(x['authorName'], 'Member'),
      body: _str(x['body']),
      parentId: x['parentId'] is String ? x['parentId'] as String : null,
      createdAtMillis: _millis(x['createdAt']),
      editedAtMillis: _millis(x['editedAt']),
      reactions: reactions,
    );
  }
}
