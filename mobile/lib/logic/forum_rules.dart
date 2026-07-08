import '../models/forum.dart';
import 'search.dart';
import 'threading.dart';

/// forum_rules — pure, framework-free helpers for the community forum (7B).
///
/// Direct port of the firebase-free parts of `src/lib/forum.ts`. Category
/// visibility, thread ordering, edit-window checks, moderation filtering, and
/// search all live here so they are unit-testable and mirror the web + rules
/// exactly. Threading itself reuses logic/threading.dart (single source of
/// truth, shared with discussions).

/// Authors may edit their own thread/post for this long after creating it.
const int editWindowMs = 15 * 60 * 1000; // 15 minutes

const int maxTitleLength = 200;
const int maxBodyLength = 5000;
const int maxNameLength = 100;

/// A small fixed reaction palette (kept server-validatable & predictable).
/// Matches the web `REACTION_EMOJI`.
const List<String> reactionEmoji = ['👍', '❤️', '🎉', '👀'];

// ── Category visibility ──────────────────────────────────────────────────────

/// Whether a viewer may see [category]. Admins see everything; "all" categories
/// are visible to any authed user; "cohort" categories require an intersection
/// between the viewer's cohortIds and the category's cohortIds. Mirrors the
/// Firestore rule (firestore.rules lines 400-408) so the UI never shows a
/// category a read would be denied for.
bool canViewCategory({
  String? role,
  List<String> cohortIds = const [],
  required ForumCategory category,
}) {
  if (role == 'admin') return true;
  if (category.visibility == 'all') return true;
  return cohortIds.any((c) => category.cohortIds.contains(c));
}

/// Filter + order categories the viewer may see (by `order`, then name).
List<ForumCategory> visibleCategories({
  String? role,
  List<String> cohortIds = const [],
  required List<ForumCategory> categories,
}) {
  final visible = categories
      .where((c) =>
          canViewCategory(role: role, cohortIds: cohortIds, category: c))
      .toList()
    ..sort((a, b) {
      if (a.order != b.order) return a.order - b.order;
      return normalizeForSearch(a.name).compareTo(normalizeForSearch(b.name));
    });
  return visible;
}

// ── Moderation (read-side only) ──────────────────────────────────────────────

/// Hide `moderation == "pending"` threads from non-admins. There is no
/// rule-level hide — this replicates the web UI filter exactly (§2.8 of the
/// plan). Admins see everything.
List<ForumThread> visibleThreads({
  String? role,
  required List<ForumThread> threads,
}) {
  if (role == 'admin') return threads;
  return threads.where((t) => !t.isPending).toList();
}

// ── Thread ordering ──────────────────────────────────────────────────────────

/// Order threads in a category: pinned first, then by last activity
/// (lastReplyAt, falling back to createdAt) newest-first. Pending writes (null)
/// float to the top within their pinned/unpinned group. Mirrors `sortThreads`.
List<ForumThread> sortThreads(List<ForumThread> threads) {
  final copy = [...threads]..sort((a, b) {
      if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
      final aLast = a.lastReplyAtMillis ?? a.createdAtMillis;
      final bLast = b.lastReplyAtMillis ?? b.createdAtMillis;
      return compareNewestFirst(
        _SortKey(a.id, aLast),
        _SortKey(b.id, bLast),
      );
    });
  return copy;
}

/// Lightweight [ThreadNode] used only to reuse the shared comparators.
class _SortKey implements ThreadNode {
  @override
  final String id;
  @override
  final String? parentId = null;
  @override
  final int? createdAtMillis;
  _SortKey(this.id, this.createdAtMillis);
}

/// Flatten posts oldest-first (forum reply view is chronological). Mirrors
/// `sortPostsChronological`.
List<ForumPost> sortPostsChronological(List<ForumPost> posts) =>
    [...posts]..sort(compareOldestFirst);

// ── Permissions ──────────────────────────────────────────────────────────────

/// Author-or-admin: may delete a thread or post (mirrors `canModerate`).
bool canModerate({
  required String viewerUid,
  String? viewerRole,
  required String authorId,
}) =>
    isAuthorOrAdmin(
        viewerUid: viewerUid, viewerRole: viewerRole, authorId: authorId);

/// Only admins may pin/lock threads or manage categories (`canAdminister`).
bool canAdminister({String? role}) => role == 'admin';

/// Whether the viewer may edit an item right now. Admins may always edit. The
/// author may edit only within [editWindowMs] of creation (a missing/pending
/// createdAtMillis is treated as "just created" → editable). Mirrors `canEdit`.
bool canEdit({
  required String viewerUid,
  String? viewerRole,
  required String authorId,
  required int? createdAtMillis,
  required int nowMillis,
}) {
  if (viewerRole == 'admin') return true;
  if (viewerUid.isEmpty || viewerUid != authorId) return false;
  if (createdAtMillis == null) return true; // pending write — still fresh
  return nowMillis - createdAtMillis <= editWindowMs;
}

// ── Search ───────────────────────────────────────────────────────────────────

/// Filter threads by a free-text query over title + body + tags. Case- and
/// diacritic-insensitive. Empty query returns all threads unchanged. Mirrors
/// `searchThreads`.
List<ForumThread> searchThreads(List<ForumThread> threads, String queryText) {
  final q = normalizeForSearch(queryText.trim());
  if (q.isEmpty) return threads;
  return threads.where((t) {
    final hay = '${t.title} ${t.body} ${t.tags.join(' ')}';
    return normalizeForSearch(hay).contains(q);
  }).toList();
}
