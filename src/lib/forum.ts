/**
 * forum — pure, framework-free helpers for the community forum.
 *
 * NO firebase imports here so every function is unit-testable in Node. The UI
 * maps Firestore snapshots into the flattened shapes below (Timestamp →
 * *Millis via toMillis() ?? null) before calling these.
 *
 * Shapes:
 *   - ForumCategoryDoc  — forumCategories/{id}
 *   - ForumThreadDoc    — forumThreads/{id}            (the topic)
 *   - ForumPostDoc      — forumThreads/{id}/posts/{id} (a reply within a thread)
 *
 * Threading inside a thread is single-level and reuses src/lib/threading.ts
 * (the same logic per-lesson discussions use). The "post" of a forum thread is
 * the thread body itself (a synthetic root); replies are the posts subcollection.
 */

import {
  buildThreadTree,
  compareNewestFirst,
  compareOldestFirst,
  isAuthorOrAdmin,
  type Thread,
  type ThreadNode,
} from "./threading";
import { normalizeForSearch } from "./search";

// ── Document shapes (flattened for client use) ───────────────────────────────

export type ForumVisibility = "all" | "cohort";

/** forumCategories/{id} */
export interface ForumCategoryDoc {
  id: string;
  name: string;
  description: string;
  order: number;
  visibility: ForumVisibility;
  /** Required when visibility === "cohort"; cohorts allowed to see it. */
  cohortIds?: string[];
  /** Admin opt-in: run new posts through AI pre-moderation before they appear. */
  aiModeration?: boolean;
  postCount?: number;
  lastActivityAtMillis?: number | null;
}

/** forumThreads/{id} — the topic / original post. */
export interface ForumThreadDoc {
  id: string;
  categoryId: string;
  authorId: string;
  authorName: string;
  title: string;
  body: string;
  pinned: boolean;
  locked: boolean;
  replyCount: number;
  tags?: string[];
  createdAtMillis: number | null;
  lastReplyAtMillis: number | null;
  editedAtMillis?: number | null;
}

/** forumThreads/{id}/posts/{postId} — a reply within a thread. */
export interface ForumPostDoc extends ThreadNode {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  parentId: string | null;
  createdAtMillis: number | null;
  editedAtMillis?: number | null;
  reactions?: Record<string, string[]>; // emoji → list of uids
}

export type ForumPostThread = Thread<ForumPostDoc>;

// ── Constants ────────────────────────────────────────────────────────────────

/** Authors may edit their own post for this long after creating it. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const MAX_TITLE_LENGTH = 200;
export const MAX_BODY_LENGTH = 5000;
export const MAX_NAME_LENGTH = 100;

/** A small fixed reaction palette (kept server-validatable & predictable). */
export const REACTION_EMOJI = ["👍", "❤️", "🎉", "👀"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

// ── Category visibility ──────────────────────────────────────────────────────

/**
 * Whether `viewer` may see `category`. Admins see everything; "all" categories
 * are visible to any authed user; "cohort" categories require an intersection
 * between the viewer's cohortIds and the category's cohortIds. Mirrors the
 * Firestore rule so the UI never shows a category a read would be denied for.
 */
export function canViewCategory(
  viewer: { role?: string; cohortIds?: string[] },
  category: Pick<ForumCategoryDoc, "visibility" | "cohortIds">
): boolean {
  if (viewer.role === "admin") return true;
  if (category.visibility === "all") return true;
  const mine = viewer.cohortIds ?? [];
  const theirs = category.cohortIds ?? [];
  return mine.some((c) => theirs.includes(c));
}

/** Filter + order categories the viewer may see (by `order`, then name). */
export function visibleCategories(
  viewer: { role?: string; cohortIds?: string[] },
  categories: ForumCategoryDoc[]
): ForumCategoryDoc[] {
  return categories
    .filter((c) => canViewCategory(viewer, c))
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return normalizeForSearch(a.name).localeCompare(normalizeForSearch(b.name));
    });
}

// ── Thread ordering ──────────────────────────────────────────────────────────

/**
 * Order threads in a category: pinned first, then by last activity
 * (lastReplyAt, falling back to createdAt) newest-first. Pending writes (null)
 * float to the top within their pinned/unpinned group.
 */
export function sortThreads(threads: ForumThreadDoc[]): ForumThreadDoc[] {
  return [...threads].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const aLast = a.lastReplyAtMillis ?? a.createdAtMillis;
    const bLast = b.lastReplyAtMillis ?? b.createdAtMillis;
    return compareNewestFirst(
      { id: a.id, parentId: null, createdAtMillis: aLast },
      { id: b.id, parentId: null, createdAtMillis: bLast }
    );
  });
}

/** Build the single-level reply tree for a thread's posts subcollection. */
export function buildPostThreads(posts: ForumPostDoc[]): ForumPostThread[] {
  return buildThreadTree(posts);
}

/** Flatten posts oldest-first (forum reply view is chronological). */
export function sortPostsChronological(posts: ForumPostDoc[]): ForumPostDoc[] {
  return [...posts].sort(compareOldestFirst);
}

// ── Permissions ──────────────────────────────────────────────────────────────

/** Author-or-admin: may delete a thread or post. */
export function canModerate(
  viewer: { uid: string; role?: string },
  item: { authorId: string }
): boolean {
  return isAuthorOrAdmin(viewer, item);
}

/** Only admins may pin/lock threads or manage categories. */
export function canAdminister(viewer: { role?: string }): boolean {
  return viewer.role === "admin";
}

/**
 * Whether `viewer` may edit `item` right now. Admins may always edit. The
 * author may edit only within EDIT_WINDOW_MS of creation (a missing/pending
 * createdAtMillis is treated as "just created" → editable by the author).
 */
export function canEdit(
  viewer: { uid: string; role?: string },
  item: { authorId: string; createdAtMillis: number | null },
  nowMillis: number
): boolean {
  if (viewer.role === "admin") return true;
  if (!viewer.uid || viewer.uid !== item.authorId) return false;
  if (item.createdAtMillis === null) return true; // pending write — still fresh
  return nowMillis - item.createdAtMillis <= EDIT_WINDOW_MS;
}

// ── @mentions ────────────────────────────────────────────────────────────────

/**
 * Extract @mention handles from post/thread body text. A handle is the run of
 * word characters (letters, digits, dot, underscore, hyphen) after an "@" that
 * is preceded by start-of-string or whitespace. Returns lowercased, de-duped
 * handles (the email local-part convention: "@ada.lovelace"). Used to fan out
 * notifications; resolution to uids happens server-side.
 */
export function extractMentions(body: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|\s)@([A-Za-z0-9._-]{2,100})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    // Trim trailing punctuation that commonly follows a mention.
    const handle = m[1].replace(/[.\-_]+$/, "").toLowerCase();
    if (handle.length >= 2) out.add(handle);
  }
  return Array.from(out);
}

// ── Search ───────────────────────────────────────────────────────────────────

/**
 * Filter threads by a free-text query over title + body + tags.
 * Case- and diacritic-insensitive (reuses normalizeForSearch). Empty query
 * returns all threads unchanged.
 */
export function searchThreads(
  threads: ForumThreadDoc[],
  queryText: string
): ForumThreadDoc[] {
  const q = normalizeForSearch(queryText.trim());
  if (!q) return threads;
  return threads.filter((t) => {
    const hay = `${t.title} ${t.body} ${(t.tags ?? []).join(" ")}`;
    return normalizeForSearch(hay).includes(q);
  });
}
