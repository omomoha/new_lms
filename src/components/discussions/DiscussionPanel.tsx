"use client";

/**
 * DiscussionPanel — collapsible per-lesson Q&A panel ("Discussion (N)"),
 * styled after TutorPanel. Collapsed by default; the count loads eagerly.
 *
 * Firestore operations (security rules are written against EXACTLY these):
 *
 *   READ    getDocs(query(collection(db, "discussions"),
 *                         where("lessonId", "==", lessonId)))
 *           — single equality filter only; courseId is filtered client-side.
 *
 *   CREATE  addDoc(collection(db, "discussions"), {
 *             courseId: string,
 *             lessonId: string,
 *             userId: appUser.uid,
 *             userName: string,          // appUser.name fallback email prefix, ≤100
 *             body: string,              // trimmed, 1–2000 chars
 *             parentId: string | null,   // null = question, else top-level doc id
 *             createdAt: serverTimestamp(),
 *           })
 *
 *   DELETE  deleteDoc(doc(db, "discussions", id))
 *           — only offered when canDelete() passes (author or admin).
 *
 * Clients NEVER update discussion docs. User content is always rendered as
 * plain text (whitespace-pre-wrap) — never as HTML.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  type Timestamp,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import {
  buildThreads,
  canDelete,
  type DiscussionDoc,
} from "@/lib/discussions";

const MAX_BODY_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;

interface DiscussionPanelProps {
  courseId: string;
  lessonId: string;
}

/** Raw Firestore document shape (read side) for "discussions". */
interface DiscussionFireDoc {
  courseId: string;
  lessonId: string;
  userId: string;
  userName: string;
  body: string;
  parentId: string | null;
  createdAt: Timestamp | null;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" / locale date for older posts. */
function formatRelativeTime(millis: number | null, nowMillis: number): string {
  if (millis === null) return "just now";
  const diff = nowMillis - millis;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(millis).toLocaleDateString();
}

export default function DiscussionPanel({ courseId, lessonId }: DiscussionPanelProps) {
  const { appUser } = useAuth();

  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<DiscussionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Composer (new question)
  const [newBody, setNewBody] = useState("");
  const [posting, setPosting] = useState(false);

  // Per-thread reply composer
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyPosting, setReplyPosting] = useState(false);

  // Two-tap delete confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // Single equality filter (no composite index needed); courseId filtered below.
      const snap = await getDocs(
        query(
          collection(db, "discussions"),
          // BOTH equality filters are required: the security rule resolves the
          // course doc from resource.data.courseId, which is only provable for
          // list queries when courseId is pinned by the query itself. A
          // lessonId-only query is denied for learners ("Could not load the
          // discussion").
          where("courseId", "==", courseId),
          where("lessonId", "==", lessonId)
        )
      );
      const next: DiscussionDoc[] = [];
      snap.forEach((d) => {
        const data = d.data() as Partial<DiscussionFireDoc>;
        if (data.courseId !== courseId) return; // client-side course filter
        next.push({
          id: d.id,
          courseId,
          lessonId,
          userId: typeof data.userId === "string" ? data.userId : "",
          userName: typeof data.userName === "string" ? data.userName : "Learner",
          body: typeof data.body === "string" ? data.body : "",
          parentId: typeof data.parentId === "string" ? data.parentId : null,
          createdAtMillis: data.createdAt?.toMillis() ?? null,
        });
      });
      setDocs(next);
    } catch (err: unknown) {
      console.error("DiscussionPanel: load failed:", err);
      setLoadError("Could not load the discussion. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [courseId, lessonId]);

  // Load eagerly (the collapsed header shows the count); reset on lesson change.
  useEffect(() => {
    setOpen(false);
    setNewBody("");
    setReplyFor(null);
    setReplyBody("");
    setConfirmDeleteId(null);
    setActionError(null);
    void load();
  }, [load]);

  const threads = useMemo(() => buildThreads(docs), [docs]);
  const nowMillis = Date.now();

  /** ≤100 chars: appUser.name, falling back to the email prefix. */
  const displayName = useMemo(() => {
    if (!appUser) return "";
    const name = appUser.name.trim();
    const emailPrefix = appUser.email.split("@")[0] ?? "";
    return (name || emailPrefix || "Learner").slice(0, MAX_NAME_LENGTH);
  }, [appUser]);

  const createPost = useCallback(
    async (rawBody: string, parentId: string | null): Promise<boolean> => {
      if (!appUser) return false;
      const body = rawBody.trim().slice(0, MAX_BODY_LENGTH);
      if (body.length === 0) return false;
      await addDoc(collection(db, "discussions"), {
        courseId,
        lessonId,
        userId: appUser.uid,
        userName: displayName,
        body,
        parentId,
        createdAt: serverTimestamp(),
      });
      return true;
    },
    [appUser, courseId, lessonId, displayName]
  );

  const handlePostQuestion = useCallback(async () => {
    if (posting || newBody.trim().length === 0) return;
    setPosting(true);
    setActionError(null);
    try {
      if (await createPost(newBody, null)) {
        setNewBody("");
        await load();
      }
    } catch (err: unknown) {
      console.error("DiscussionPanel: post failed:", err);
      setActionError("Could not post your question. Please try again.");
    } finally {
      setPosting(false);
    }
  }, [posting, newBody, createPost, load]);

  const handlePostReply = useCallback(
    async (parentId: string) => {
      if (replyPosting || replyBody.trim().length === 0) return;
      setReplyPosting(true);
      setActionError(null);
      try {
        if (await createPost(replyBody, parentId)) {
          setReplyBody("");
          setReplyFor(null);
          await load();
        }
      } catch (err: unknown) {
        console.error("DiscussionPanel: reply failed:", err);
        setActionError("Could not post your reply. Please try again.");
      } finally {
        setReplyPosting(false);
      }
    },
    [replyPosting, replyBody, createPost, load]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (deletingId) return;
      setDeletingId(id);
      setActionError(null);
      try {
        await deleteDoc(doc(db, "discussions", id));
        setConfirmDeleteId(null);
        await load();
      } catch (err: unknown) {
        console.error("DiscussionPanel: delete failed:", err);
        setActionError("Could not delete the post. Please try again.");
      } finally {
        setDeletingId(null);
      }
    },
    [deletingId, load]
  );

  const toggleReply = useCallback((threadId: string) => {
    setReplyFor((prev) => (prev === threadId ? null : threadId));
    setReplyBody("");
  }, []);

  /** Author line + delete control shared by questions and replies. */
  const renderMeta = (post: DiscussionDoc) => (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-xs font-semibold text-brand-ink">{post.userName}</span>
      <span className="text-xs text-brand-muted">
        {formatRelativeTime(post.createdAtMillis, nowMillis)}
      </span>
      {appUser &&
        canDelete(
          { uid: appUser.uid, role: appUser.role },
          { userId: post.userId }
        ) &&
        (confirmDeleteId === post.id ? (
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDelete(post.id)}
              disabled={deletingId === post.id}
              aria-label="Confirm deleting this post"
              className="text-xs font-semibold text-red-700 underline disabled:opacity-60"
            >
              {deletingId === post.id ? "Deleting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(null)}
              aria-label="Cancel deleting this post"
              className="text-xs text-brand-muted underline"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDeleteId(post.id)}
            aria-label={`Delete post by ${post.userName}`}
            className="text-xs text-red-700 hover:underline"
          >
            Delete?
          </button>
        ))}
    </div>
  );

  return (
    <section aria-label="Lesson discussion" className="card !p-0 overflow-hidden">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`discussion-panel-body-${lessonId}`}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-brand-primary">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-brand-accent"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 4h16a1 1 0 011 1v11a1 1 0 01-1 1H8.4L4.7 20.7A1 1 0 013 20V5a1 1 0 011-1z" />
          </svg>
          Discussion{loading ? "" : ` (${docs.length})`}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 text-brand-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          id={`discussion-panel-body-${lessonId}`}
          className="border-t border-brand-line px-4 py-3"
        >
          {actionError && (
            <p role="alert" className="mb-2 text-xs text-red-600">
              {actionError}
            </p>
          )}

          {/* New question composer */}
          {appUser && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handlePostQuestion();
              }}
              className="mb-4"
            >
              <label
                htmlFor={`discussion-new-${lessonId}`}
                className="mb-1 block text-xs font-medium text-brand-muted"
              >
                Ask a question about this lesson
              </label>
              <textarea
                id={`discussion-new-${lessonId}`}
                value={newBody}
                onChange={(e) => setNewBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
                maxLength={MAX_BODY_LENGTH}
                rows={3}
                placeholder="What would you like to ask?"
                className="input-field w-full resize-y text-sm"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <button
                  type="submit"
                  disabled={posting || newBody.trim().length === 0}
                  className="btn-primary text-sm disabled:opacity-60"
                >
                  {posting ? "Posting…" : "Post question"}
                </button>
                <span className="text-xs text-brand-muted">
                  {newBody.length}/{MAX_BODY_LENGTH}
                </span>
              </div>
            </form>
          )}

          {/* Loading / error / empty / threads */}
          {loading ? (
            <p aria-live="polite" className="py-2 text-sm text-brand-muted">
              Loading discussion…
            </p>
          ) : loadError ? (
            <div className="py-2">
              <p role="alert" className="text-sm text-red-600">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                className="btn-secondary mt-2 text-xs"
              >
                Try again
              </button>
            </div>
          ) : threads.length === 0 ? (
            <p className="py-2 text-sm text-brand-muted">
              No questions yet — ask the first one
            </p>
          ) : (
            <ul aria-label="Questions" className="space-y-4">
              {threads.map(({ post, replies }) => (
                <li
                  key={post.id}
                  className="rounded-lg border border-brand-line p-3"
                >
                  {renderMeta(post)}
                  {/* Plain text on purpose — never render user content as HTML */}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-brand-ink">
                    {post.body}
                  </p>

                  {appUser && (
                    <button
                      type="button"
                      onClick={() => toggleReply(post.id)}
                      aria-expanded={replyFor === post.id}
                      aria-controls={`discussion-reply-${post.id}`}
                      className="mt-1 text-xs font-medium text-brand-teal hover:underline"
                    >
                      {replyFor === post.id ? "Cancel reply" : "Reply"}
                    </button>
                  )}

                  {/* Reply composer */}
                  {appUser && replyFor === post.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handlePostReply(post.id);
                      }}
                      className="mt-2"
                    >
                      <label
                        htmlFor={`discussion-reply-${post.id}`}
                        className="mb-1 block text-xs font-medium text-brand-muted"
                      >
                        Reply to {post.userName}
                      </label>
                      <textarea
                        id={`discussion-reply-${post.id}`}
                        value={replyBody}
                        onChange={(e) =>
                          setReplyBody(e.target.value.slice(0, MAX_BODY_LENGTH))
                        }
                        maxLength={MAX_BODY_LENGTH}
                        rows={2}
                        placeholder="Write a reply…"
                        className="input-field w-full resize-y text-sm"
                      />
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <button
                          type="submit"
                          disabled={replyPosting || replyBody.trim().length === 0}
                          className="btn-primary text-xs disabled:opacity-60"
                        >
                          {replyPosting ? "Posting…" : "Post reply"}
                        </button>
                        <span className="text-xs text-brand-muted">
                          {replyBody.length}/{MAX_BODY_LENGTH}
                        </span>
                      </div>
                    </form>
                  )}

                  {/* Replies (single level) */}
                  {replies.length > 0 && (
                    <ul
                      aria-label={`Replies to ${post.userName}`}
                      className="mt-3 space-y-3 border-l-2 border-brand-line pl-3"
                    >
                      {replies.map((reply) => (
                        <li key={reply.id}>
                          {renderMeta(reply)}
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-brand-ink">
                            {reply.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
