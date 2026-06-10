/**
 * Discussions — pure helpers for per-lesson Q&A threads.
 *
 * NO firebase imports here: the UI maps Firestore snapshots into the plain
 * `DiscussionDoc` shape (createdAt → createdAtMillis via toMillis() ?? null)
 * before calling these, which keeps every function unit-testable.
 *
 * Threading model (single level):
 *   - parentId === null            → top-level question
 *   - parentId === <top-level id>  → reply, attached to that question
 *   - parentId pointing anywhere else (missing doc, or another reply)
 *     → DROPPED from the output entirely.
 */

/** A "discussions" collection document, flattened for client-side use. */
export interface DiscussionDoc {
  id: string;
  courseId: string;
  lessonId: string;
  userId: string;
  userName: string;
  body: string;
  parentId: string | null;
  /** serverTimestamp().toMillis(), or null while the local write is pending. */
  createdAtMillis: number | null;
}

/** One top-level question plus its (single-level) replies. */
export interface DiscussionThread {
  post: DiscussionDoc;
  replies: DiscussionDoc[];
}

/**
 * Newest-first comparator for top-level posts.
 * null createdAtMillis (pending server timestamp / malformed doc) sorts LAST.
 * Ties break on id (ascending) so ordering is deterministic.
 */
function compareNewestFirst(a: DiscussionDoc, b: DiscussionDoc): number {
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
function compareOldestFirst(a: DiscussionDoc, b: DiscussionDoc): number {
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
 * Group a flat list of discussion docs into threads.
 *
 * - Top-level posts (parentId === null) sorted newest-first.
 * - Replies sorted oldest-first under their parent.
 * - Replies whose parentId does not match a top-level post in `docs`
 *   (orphans, or replies-to-replies) are dropped.
 */
export function buildThreads(docs: DiscussionDoc[]): DiscussionThread[] {
  const topLevel = docs.filter((d) => d.parentId === null);
  const topLevelIds = new Set(topLevel.map((d) => d.id));

  const repliesByParent = new Map<string, DiscussionDoc[]>();
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
 * Whether `viewer` may delete `post`: the author themselves, or an admin.
 * Mirrors the Firestore rule — clients may only create and delete, never update.
 */
export function canDelete(
  viewer: { uid: string; role?: string },
  post: { userId: string }
): boolean {
  if (viewer.role === "admin") return true;
  return viewer.uid.length > 0 && viewer.uid === post.userId;
}
