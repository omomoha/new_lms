/**
 * threading — shared, framework-free helpers for single-level comment threads.
 *
 * Both the per-lesson discussions (src/lib/discussions.ts) and the community
 * forum (src/lib/forum.ts) build the SAME shape: a flat list of timestamped
 * docs where each is either a top-level post (parentId === null) or a one-level
 * reply (parentId === <top-level id>). Replies that point at a missing post, or
 * at another reply, are dropped (no nesting).
 *
 * These comparators and the grouping function are the proven logic originally
 * written for discussions, lifted here verbatim so there is a SINGLE source of
 * truth for sort order, orphan-dropping, and the author-or-admin permission
 * check. Keeping them pure (no firebase imports) keeps everything unit-testable.
 *
 * The minimal shape a doc must satisfy: a stable string `id`, a `parentId`
 * (null = top-level), and `createdAtMillis` (serverTimestamp().toMillis(), or
 * null while a local write is still pending).
 */

/** The minimal fields the threading helpers need from any thread doc. */
export interface ThreadNode {
  id: string;
  parentId: string | null;
  /** serverTimestamp().toMillis(), or null while the local write is pending. */
  createdAtMillis: number | null;
}

/** One top-level post plus its (single-level) replies. */
export interface Thread<T extends ThreadNode> {
  post: T;
  replies: T[];
}

/**
 * Newest-first comparator for top-level posts.
 * null createdAtMillis (pending server timestamp / malformed doc) sorts LAST.
 * Ties break on id (ascending) so ordering is deterministic.
 */
export function compareNewestFirst(a: ThreadNode, b: ThreadNode): number {
  if (a.createdAtMillis === null && b.createdAtMillis === null) {
    return a.id.localeCompare(b.id);
  }
  if (a.createdAtMillis === null) return 1;
  if (b.createdAtMillis === null) return -1;
  if (b.createdAtMillis !== a.createdAtMillis) {
    return b.createdAtMillis - a.createdAtMillis;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Oldest-first comparator for replies.
 * null createdAtMillis sorts LAST (a pending write is the newest reply).
 */
export function compareOldestFirst(a: ThreadNode, b: ThreadNode): number {
  if (a.createdAtMillis === null && b.createdAtMillis === null) {
    return a.id.localeCompare(b.id);
  }
  if (a.createdAtMillis === null) return 1;
  if (b.createdAtMillis === null) return -1;
  if (a.createdAtMillis !== b.createdAtMillis) {
    return a.createdAtMillis - b.createdAtMillis;
  }
  return a.id.localeCompare(b.id);
}

/**
 * Group a flat list of thread docs into single-level threads.
 *
 * - Top-level posts (parentId === null) sorted newest-first.
 * - Replies sorted oldest-first under their parent.
 * - Replies whose parentId does not match a top-level post in `docs`
 *   (orphans, or replies-to-replies) are dropped.
 *
 * Generic over the concrete doc type so callers keep their own richer fields.
 */
export function buildThreadTree<T extends ThreadNode>(docs: T[]): Thread<T>[] {
  const topLevel = docs.filter((d) => d.parentId === null);
  const topLevelIds = new Set(topLevel.map((d) => d.id));

  const repliesByParent = new Map<string, T[]>();
  for (const d of docs) {
    if (d.parentId === null) continue;
    if (!topLevelIds.has(d.parentId)) continue; // orphan / reply-to-reply → drop
    const bucket = repliesByParent.get(d.parentId);
    if (bucket) {
      bucket.push(d);
    } else {
      repliesByParent.set(d.parentId, [d]);
    }
  }

  return [...topLevel].sort(compareNewestFirst).map((post) => ({
    post,
    replies: [...(repliesByParent.get(post.id) ?? [])].sort(compareOldestFirst),
  }));
}

/**
 * Whether `viewer` may modify (delete/edit-as-moderator) `post`: the author
 * themselves, or an admin. Mirrors the Firestore rule's author-or-admin model.
 */
export function isAuthorOrAdmin(
  viewer: { uid: string; role?: string },
  post: { authorId: string }
): boolean {
  if (viewer.role === "admin") return true;
  return viewer.uid.length > 0 && viewer.uid === post.authorId;
}
