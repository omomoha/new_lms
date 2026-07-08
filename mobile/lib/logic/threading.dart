/// threading — framework-free helpers for single-level comment threads.
///
/// Direct port of the web `src/lib/threading.ts`. Both per-lesson discussions
/// and (later) the community forum build the same shape: a flat list of
/// timestamped docs where each is either a top-level post (parentId == null) or
/// a one-level reply (parentId == <top-level id>). Replies that point at a
/// missing post, or at another reply, are dropped (no nesting).
///
/// Kept pure (no firebase imports) so it is unit-testable.

/// The minimal fields the threading helpers need from any thread doc.
abstract class ThreadNode {
  String get id;
  String? get parentId;

  /// serverTimestamp().millisecondsSinceEpoch, or null while a local write is
  /// still pending.
  int? get createdAtMillis;
}

/// One top-level post plus its (single-level) replies.
class Thread<T extends ThreadNode> {
  final T post;
  final List<T> replies;
  const Thread({required this.post, required this.replies});
}

/// Newest-first comparator for top-level posts.
/// null createdAtMillis (pending timestamp / malformed doc) sorts LAST.
/// Ties break on id (ascending) so ordering is deterministic.
int compareNewestFirst(ThreadNode a, ThreadNode b) {
  final am = a.createdAtMillis;
  final bm = b.createdAtMillis;
  if (am == null && bm == null) return a.id.compareTo(b.id);
  if (am == null) return 1;
  if (bm == null) return -1;
  if (bm != am) return bm - am;
  return a.id.compareTo(b.id);
}

/// Oldest-first comparator for replies.
/// null createdAtMillis sorts LAST (a pending write is the newest reply).
int compareOldestFirst(ThreadNode a, ThreadNode b) {
  final am = a.createdAtMillis;
  final bm = b.createdAtMillis;
  if (am == null && bm == null) return a.id.compareTo(b.id);
  if (am == null) return 1;
  if (bm == null) return -1;
  if (am != bm) return am - bm;
  return a.id.compareTo(b.id);
}

/// Group a flat list of thread docs into single-level threads.
///
/// - Top-level posts (parentId == null) sorted newest-first.
/// - Replies sorted oldest-first under their parent.
/// - Replies whose parentId does not match a top-level post in [docs]
///   (orphans, or replies-to-replies) are dropped.
List<Thread<T>> buildThreadTree<T extends ThreadNode>(List<T> docs) {
  final topLevel = docs.where((d) => d.parentId == null).toList();
  final topLevelIds = topLevel.map((d) => d.id).toSet();

  final repliesByParent = <String, List<T>>{};
  for (final d in docs) {
    final pid = d.parentId;
    if (pid == null) continue;
    if (!topLevelIds.contains(pid)) continue; // orphan / reply-to-reply → drop
    repliesByParent.putIfAbsent(pid, () => <T>[]).add(d);
  }

  final sortedTop = [...topLevel]..sort(compareNewestFirst);
  return sortedTop.map((post) {
    final replies = [...(repliesByParent[post.id] ?? const [])]
      ..sort(compareOldestFirst);
    return Thread<T>(post: post, replies: replies);
  }).toList();
}

/// Whether [viewerUid]/[viewerRole] may modify (delete) a post authored by
/// [authorId]: the author themselves, or an admin. Mirrors the Firestore rule's
/// author-or-admin model.
bool isAuthorOrAdmin({
  required String viewerUid,
  String? viewerRole,
  required String authorId,
}) {
  if (viewerRole == 'admin') return true;
  return viewerUid.isNotEmpty && viewerUid == authorId;
}
