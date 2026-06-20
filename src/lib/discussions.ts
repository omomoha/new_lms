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
 *
 * The sort/group/permission logic lives in the shared src/lib/threading.ts
 * module (also used by the community forum) — this file adapts the discussion
 * doc shape (which keys identity off `userId`) onto those generic helpers and
 * keeps the long-standing public API (buildThreads / canDelete) intact.
 */

import {
  buildThreadTree,
  isAuthorOrAdmin,
  type Thread,
} from "./threading";

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
export type DiscussionThread = Thread<DiscussionDoc>;

/**
 * Group a flat list of discussion docs into threads.
 *
 * - Top-level posts (parentId === null) sorted newest-first.
 * - Replies sorted oldest-first under their parent.
 * - Replies whose parentId does not match a top-level post in `docs`
 *   (orphans, or replies-to-replies) are dropped.
 */
export function buildThreads(docs: DiscussionDoc[]): DiscussionThread[] {
  return buildThreadTree(docs);
}

/**
 * Whether `viewer` may delete `post`: the author themselves, or an admin.
 * Mirrors the Firestore rule — clients may only create and delete, never update.
 */
export function canDelete(
  viewer: { uid: string; role?: string },
  post: { userId: string }
): boolean {
  return isAuthorOrAdmin(viewer, { authorId: post.userId });
}
