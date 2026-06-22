/**
 * forumClient — Firestore read/write helpers for the community forum UI.
 *
 * Pure threading/permission/search logic lives in src/lib/forum.ts (no firebase
 * imports, unit-tested). This module is the thin Firestore layer: real-time
 * subscriptions (onSnapshot, same pattern as NotificationsBell/DiscussionPanel)
 * and create/update/delete mutations whose shapes EXACTLY match firestore.rules.
 *
 * Security rules are written against these writes:
 *   - createThread: forumThreads add with { categoryId, authorId, authorName,
 *       title, body, pinned:false, locked:false, replyCount:0, tags?,
 *       createdAt, lastReplyAt }.
 *   - createReply:  forumThreads/{id}/posts add with { authorId, authorName,
 *       body, parentId, createdAt }. Rejected at the rules layer if the thread
 *       is locked.
 *   - editThread/editPost: author may change only title/body(+editedAt) /
 *       body(+editedAt). Admin may pin/lock.
 *   - toggleReaction: any authed user may change ONLY the reactions map.
 *   - report: forumReports add.
 *
 * User content is ALWAYS rendered as plain text by the UI (never HTML).
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import {
  MAX_BODY_LENGTH,
  MAX_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  type ForumCategoryDoc,
  type ForumPostDoc,
  type ForumThreadDoc,
} from "@/lib/forum";

const tsMillis = (t: unknown): number | null =>
  t && typeof (t as Timestamp).toMillis === "function"
    ? (t as Timestamp).toMillis()
    : null;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

// ── Categories ───────────────────────────────────────────────────────────────

export async function fetchCategories(): Promise<ForumCategoryDoc[]> {
  const snap = await getDocs(collection(db, "forumCategories"));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: str(x.name, "Untitled"),
      description: str(x.description),
      order: typeof x.order === "number" ? x.order : 0,
      visibility: x.visibility === "cohort" ? "cohort" : "all",
      cohortIds: Array.isArray(x.cohortIds) ? (x.cohortIds as string[]) : [],
      aiModeration: x.aiModeration === true,
      postCount: typeof x.postCount === "number" ? x.postCount : 0,
      lastActivityAtMillis: tsMillis(x.lastActivityAt),
    };
  });
}

export async function fetchCategory(id: string): Promise<ForumCategoryDoc | null> {
  const snap = await getDoc(doc(db, "forumCategories", id));
  if (!snap.exists()) return null;
  const x = snap.data();
  return {
    id: snap.id,
    name: str(x.name, "Untitled"),
    description: str(x.description),
    order: typeof x.order === "number" ? x.order : 0,
    visibility: x.visibility === "cohort" ? "cohort" : "all",
    cohortIds: Array.isArray(x.cohortIds) ? (x.cohortIds as string[]) : [],
    aiModeration: x.aiModeration === true,
    postCount: typeof x.postCount === "number" ? x.postCount : 0,
    lastActivityAtMillis: tsMillis(x.lastActivityAt),
  };
}

/** Admin: create/update/delete categories (rules enforce admin-only). */
export async function createCategory(input: {
  name: string;
  description: string;
  order: number;
  visibility: "all" | "cohort";
  cohortIds?: string[];
  aiModeration?: boolean;
}): Promise<void> {
  await addDoc(collection(db, "forumCategories"), {
    name: input.name.slice(0, 120),
    description: input.description.slice(0, 1000),
    order: input.order,
    visibility: input.visibility,
    cohortIds: input.visibility === "cohort" ? input.cohortIds ?? [] : [],
    aiModeration: input.aiModeration === true,
    postCount: 0,
    lastActivityAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
}

export async function updateCategory(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    order: number;
    visibility: "all" | "cohort";
    cohortIds: string[];
    aiModeration: boolean;
  }>
): Promise<void> {
  await updateDoc(doc(db, "forumCategories", id), patch);
}

export async function deleteCategory(id: string): Promise<void> {
  await deleteDoc(doc(db, "forumCategories", id));
}

// ── Threads ──────────────────────────────────────────────────────────────────

function mapThread(id: string, x: Record<string, unknown>): ForumThreadDoc {
  return {
    id,
    categoryId: str(x.categoryId),
    authorId: str(x.authorId),
    authorName: str(x.authorName, "Member"),
    title: str(x.title, "(untitled)"),
    body: str(x.body),
    pinned: x.pinned === true,
    locked: x.locked === true,
    replyCount: typeof x.replyCount === "number" ? x.replyCount : 0,
    tags: Array.isArray(x.tags) ? (x.tags as string[]) : [],
    createdAtMillis: tsMillis(x.createdAt),
    lastReplyAtMillis: tsMillis(x.lastReplyAt),
    editedAtMillis: tsMillis(x.editedAt),
  };
}

/** Subscribe to all threads in a category (single equality filter, no index). */
export function subscribeThreads(
  categoryId: string,
  onData: (threads: ForumThreadDoc[]) => void,
  onError: (err: unknown) => void
): () => void {
  const q = query(
    collection(db, "forumThreads"),
    where("categoryId", "==", categoryId)
  );
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => mapThread(d.id, d.data()))),
    onError
  );
}

export async function fetchThread(id: string): Promise<ForumThreadDoc | null> {
  const snap = await getDoc(doc(db, "forumThreads", id));
  if (!snap.exists()) return null;
  return mapThread(snap.id, snap.data());
}

export async function createThread(input: {
  categoryId: string;
  authorId: string;
  authorName: string;
  title: string;
  body: string;
  tags?: string[];
}): Promise<string> {
  const ref = await addDoc(collection(db, "forumThreads"), {
    categoryId: input.categoryId,
    authorId: input.authorId,
    authorName: input.authorName.slice(0, MAX_NAME_LENGTH),
    title: input.title.trim().slice(0, MAX_TITLE_LENGTH),
    body: input.body.trim().slice(0, MAX_BODY_LENGTH),
    pinned: false,
    locked: false,
    replyCount: 0,
    tags: (input.tags ?? []).slice(0, 8),
    createdAt: serverTimestamp(),
    lastReplyAt: serverTimestamp(),
  });
  return ref.id;
}

/** Author edit (title/body) — rules restrict the affected keys. */
export async function editThread(
  id: string,
  patch: { title: string; body: string }
): Promise<void> {
  await updateDoc(doc(db, "forumThreads", id), {
    title: patch.title.trim().slice(0, MAX_TITLE_LENGTH),
    body: patch.body.trim().slice(0, MAX_BODY_LENGTH),
    editedAt: serverTimestamp(),
  });
}

/** Admin pin/lock toggles. */
export async function setThreadFlags(
  id: string,
  flags: Partial<{ pinned: boolean; locked: boolean }>
): Promise<void> {
  await updateDoc(doc(db, "forumThreads", id), flags);
}

export async function deleteThread(id: string): Promise<void> {
  await deleteDoc(doc(db, "forumThreads", id));
}

// ── Posts (replies) ──────────────────────────────────────────────────────────

function mapPost(id: string, x: Record<string, unknown>): ForumPostDoc {
  return {
    id,
    authorId: str(x.authorId),
    authorName: str(x.authorName, "Member"),
    body: str(x.body),
    parentId: typeof x.parentId === "string" ? x.parentId : null,
    createdAtMillis: tsMillis(x.createdAt),
    editedAtMillis: tsMillis(x.editedAt),
    reactions:
      x.reactions && typeof x.reactions === "object"
        ? (x.reactions as Record<string, string[]>)
        : {},
  };
}

export function subscribePosts(
  threadId: string,
  onData: (posts: ForumPostDoc[]) => void,
  onError: (err: unknown) => void
): () => void {
  return onSnapshot(
    collection(db, "forumThreads", threadId, "posts"),
    (snap) => onData(snap.docs.map((d) => mapPost(d.id, d.data()))),
    onError
  );
}

export async function createReply(
  threadId: string,
  input: { authorId: string; authorName: string; body: string; parentId: string | null }
): Promise<void> {
  await addDoc(collection(db, "forumThreads", threadId, "posts"), {
    authorId: input.authorId,
    authorName: input.authorName.slice(0, MAX_NAME_LENGTH),
    body: input.body.trim().slice(0, MAX_BODY_LENGTH),
    parentId: input.parentId,
    createdAt: serverTimestamp(),
  });
}

export async function editPost(
  threadId: string,
  postId: string,
  body: string
): Promise<void> {
  await updateDoc(doc(db, "forumThreads", threadId, "posts", postId), {
    body: body.trim().slice(0, MAX_BODY_LENGTH),
    editedAt: serverTimestamp(),
  });
}

export async function deletePost(threadId: string, postId: string): Promise<void> {
  await deleteDoc(doc(db, "forumThreads", threadId, "posts", postId));
}

/**
 * Toggle a single emoji reaction by `uid` on a post. Reads the current map,
 * adds/removes the uid, and writes ONLY the reactions field (rules allow a
 * reactions-only diff by any authed user).
 */
export async function toggleReaction(
  threadId: string,
  postId: string,
  emoji: string,
  uid: string
): Promise<void> {
  const ref = doc(db, "forumThreads", threadId, "posts", postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const current = (snap.data().reactions ?? {}) as Record<string, string[]>;
  const list = Array.isArray(current[emoji]) ? [...current[emoji]] : [];
  const idx = list.indexOf(uid);
  if (idx >= 0) list.splice(idx, 1);
  else list.push(uid);
  const next = { ...current };
  if (list.length > 0) next[emoji] = list;
  else delete next[emoji];
  await updateDoc(ref, { reactions: next });
}

// ── Reports ──────────────────────────────────────────────────────────────────

export async function reportContent(input: {
  reporterId: string;
  reporterName: string;
  threadId: string;
  postId?: string | null;
  reason: string;
}): Promise<void> {
  await addDoc(collection(db, "forumReports"), {
    reporterId: input.reporterId,
    reporterName: input.reporterName.slice(0, MAX_NAME_LENGTH),
    threadId: input.threadId,
    postId: input.postId ?? null,
    reason: input.reason.trim().slice(0, 1000),
    resolved: false,
    createdAt: serverTimestamp(),
  });
}
