"use client";

/**
 * /learn/forum/thread/[threadId] — full thread view.
 *
 * Shows the original post + chronological replies (real-time onSnapshot),
 * a reply composer (disabled when the thread is locked), time-boxed author
 * edit, emoji reactions, report action, and admin pin/lock/delete controls.
 *
 * ALL user content is rendered as plain text (whitespace-pre-wrap), never HTML.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import { getFeatureFlag } from "@/lib/featureFlags";
import {
  createReply,
  deletePost,
  deleteThread,
  editPost,
  editThread,
  fetchThread,
  reportContent,
  setThreadFlags,
  subscribePosts,
  toggleReaction,
} from "@/lib/forumClient";
import {
  canAdminister,
  canEdit,
  canModerate,
  sortPostsChronological,
  REACTION_EMOJI,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  type ForumPostDoc,
  type ForumThreadDoc,
} from "@/lib/forum";
import { formatRelativeTime } from "@/components/forum/relativeTime";

export default function ForumThreadPage() {
  const { appUser } = useAuth();
  const router = useRouter();
  const params = useParams<{ threadId: string }>();
  const threadId = params.threadId;

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [thread, setThread] = useState<ForumThreadDoc | null>(null);
  const [posts, setPosts] = useState<ForumPostDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [reply, setReply] = useState("");
  const [replyPosting, setReplyPosting] = useState(false);

  // OP edit
  const [editingThread, setEditingThread] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  // Per-post edit
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostBody, setEditPostBody] = useState("");

  // Report
  const [reportFor, setReportFor] = useState<{ postId: string | null } | null>(null);
  const [reportReason, setReportReason] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const on = await getFeatureFlag("communityForum");
      if (active) setEnabled(on);
    })();
    return () => {
      active = false;
    };
  }, []);

  const reloadThread = useCallback(async () => {
    const t = await fetchThread(threadId);
    setThread(t);
    return t;
  }, [threadId]);

  useEffect(() => {
    if (enabled !== true) return;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const t = await fetchThread(threadId);
        if (!t) {
          setError("This thread no longer exists.");
          setLoading(false);
          return;
        }
        setThread(t);
        unsub = subscribePosts(
          threadId,
          (p) => {
            setPosts(p);
            setLoading(false);
          },
          (err) => {
            console.error("ForumThread: posts subscribe failed:", err);
            setError("Could not load replies.");
            setLoading(false);
          }
        );
      } catch (err) {
        console.error("ForumThread: load failed:", err);
        setError("Could not load this thread.");
        setLoading(false);
      }
    })();
    return () => unsub?.();
  }, [enabled, threadId]);

  const displayName = useMemo(() => {
    if (!appUser) return "";
    const name = appUser.name?.trim();
    const prefix = appUser.email.split("@")[0] ?? "";
    return (name || prefix || "Member").slice(0, 100);
  }, [appUser]);

  const viewer = appUser
    ? { uid: appUser.uid, role: appUser.role }
    : { uid: "", role: undefined };
  const isAdmin = canAdminister({ role: appUser?.role });
  const now = Date.now();
  const ordered = useMemo(() => sortPostsChronological(posts), [posts]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleReply = useCallback(async () => {
    if (!appUser || replyPosting || reply.trim().length === 0) return;
    if (thread?.locked) return;
    setReplyPosting(true);
    setActionError(null);
    try {
      await createReply(threadId, {
        authorId: appUser.uid,
        authorName: displayName,
        body: reply,
        parentId: null,
      });
      setReply("");
    } catch (err) {
      console.error("ForumThread: reply failed:", err);
      setActionError("Could not post your reply. Please try again.");
    } finally {
      setReplyPosting(false);
    }
  }, [appUser, replyPosting, reply, thread?.locked, threadId, displayName]);

  const startEditThread = () => {
    if (!thread) return;
    setEditTitle(thread.title);
    setEditBody(thread.body);
    setEditingThread(true);
  };

  const saveEditThread = useCallback(async () => {
    if (!thread) return;
    setActionError(null);
    try {
      await editThread(threadId, { title: editTitle, body: editBody });
      setEditingThread(false);
      await reloadThread();
    } catch (err) {
      console.error("ForumThread: edit thread failed:", err);
      setActionError("Could not save your edit (the edit window may have closed).");
    }
  }, [thread, threadId, editTitle, editBody, reloadThread]);

  const saveEditPost = useCallback(
    async (postId: string) => {
      setActionError(null);
      try {
        await editPost(threadId, postId, editPostBody);
        setEditingPostId(null);
      } catch (err) {
        console.error("ForumThread: edit post failed:", err);
        setActionError("Could not save your edit (the edit window may have closed).");
      }
    },
    [threadId, editPostBody]
  );

  const handleDeletePost = useCallback(
    async (postId: string) => {
      setActionError(null);
      try {
        await deletePost(threadId, postId);
      } catch (err) {
        console.error("ForumThread: delete post failed:", err);
        setActionError("Could not delete the reply.");
      }
    },
    [threadId]
  );

  const handleDeleteThread = useCallback(async () => {
    if (!thread) return;
    setActionError(null);
    try {
      await deleteThread(threadId);
      router.push(`/learn/forum/category/${thread.categoryId}`);
    } catch (err) {
      console.error("ForumThread: delete thread failed:", err);
      setActionError("Could not delete the thread.");
    }
  }, [thread, threadId, router]);

  const togglePin = useCallback(async () => {
    if (!thread) return;
    try {
      await setThreadFlags(threadId, { pinned: !thread.pinned });
      await reloadThread();
    } catch (err) {
      console.error("ForumThread: pin failed:", err);
      setActionError("Could not update pin.");
    }
  }, [thread, threadId, reloadThread]);

  const toggleLock = useCallback(async () => {
    if (!thread) return;
    try {
      await setThreadFlags(threadId, { locked: !thread.locked });
      await reloadThread();
    } catch (err) {
      console.error("ForumThread: lock failed:", err);
      setActionError("Could not update lock.");
    }
  }, [thread, threadId, reloadThread]);

  const handleReact = useCallback(
    async (postId: string, emoji: string) => {
      if (!appUser) return;
      try {
        await toggleReaction(threadId, postId, emoji, appUser.uid);
      } catch (err) {
        console.error("ForumThread: react failed:", err);
      }
    },
    [appUser, threadId]
  );

  const submitReport = useCallback(async () => {
    if (!appUser || !reportFor || reportReason.trim().length === 0) return;
    try {
      await reportContent({
        reporterId: appUser.uid,
        reporterName: displayName,
        threadId,
        postId: reportFor.postId,
        reason: reportReason,
      });
      setReportFor(null);
      setReportReason("");
      setActionError(null);
    } catch (err) {
      console.error("ForumThread: report failed:", err);
      setActionError("Could not submit your report.");
    }
  }, [appUser, reportFor, reportReason, threadId, displayName]);

  // ── Render helpers ───────────────────────────────────────────────────────────

  const reactionRow = (post: ForumPostDoc) => (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {REACTION_EMOJI.map((emoji) => {
        const uids = post.reactions?.[emoji] ?? [];
        const reacted = appUser ? uids.includes(appUser.uid) : false;
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => void handleReact(post.id, emoji)}
            aria-pressed={reacted}
            aria-label={`React ${emoji}`}
            className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
              reacted
                ? "border-brand-teal bg-brand-mint text-brand-primary"
                : "border-brand-line text-brand-muted hover:bg-brand-mint/40"
            }`}
          >
            {emoji} {uids.length > 0 ? uids.length : ""}
          </button>
        );
      })}
    </div>
  );

  if (enabled === false) {
    return (
      <LearnerShell>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-center text-brand-muted">
          The community forum isn&apos;t available yet.
        </div>
      </LearnerShell>
    );
  }

  return (
    <LearnerShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <p className="mb-3 text-xs text-brand-muted">
          {thread ? (
            <Link
              href={`/learn/forum/category/${thread.categoryId}`}
              className="hover:underline"
            >
              ← Back to category
            </Link>
          ) : (
            <Link href="/learn/forum" className="hover:underline">
              ← Forum
            </Link>
          )}
        </p>

        {actionError && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {actionError}
          </p>
        )}

        {loading || enabled === null ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : error || !thread ? (
          <p role="alert" className="text-sm text-red-600">
            {error ?? "Thread not found."}
          </p>
        ) : (
          <>
            {/* Original post */}
            <article className="card mb-4">
              {editingThread ? (
                <div className="space-y-2">
                  <input
                    value={editTitle}
                    onChange={(e) =>
                      setEditTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))
                    }
                    maxLength={MAX_TITLE_LENGTH}
                    className="input-field w-full text-sm"
                    aria-label="Edit title"
                  />
                  <textarea
                    value={editBody}
                    onChange={(e) =>
                      setEditBody(e.target.value.slice(0, MAX_BODY_LENGTH))
                    }
                    maxLength={MAX_BODY_LENGTH}
                    rows={5}
                    className="input-field w-full resize-y text-sm"
                    aria-label="Edit body"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveEditThread()}
                      className="btn-primary text-sm"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingThread(false)}
                      className="btn-secondary text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <h1 className="font-serif-brand text-xl text-brand-ink">
                      {thread.pinned && <span className="mr-1">📌</span>}
                      {thread.locked && <span className="mr-1">🔒</span>}
                      {thread.title}
                    </h1>
                  </div>
                  <p className="mt-1 text-xs text-brand-muted">
                    {thread.authorName} ·{" "}
                    {formatRelativeTime(thread.createdAtMillis, now)}
                    {thread.editedAtMillis ? " · edited" : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-brand-ink">
                    {thread.body}
                  </p>

                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {canEdit(
                      viewer,
                      { authorId: thread.authorId, createdAtMillis: thread.createdAtMillis },
                      now
                    ) && (
                      <button
                        type="button"
                        onClick={startEditThread}
                        className="text-brand-teal hover:underline"
                      >
                        Edit
                      </button>
                    )}
                    {canModerate(viewer, { authorId: thread.authorId }) && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteThread()}
                        className="text-red-700 hover:underline"
                      >
                        Delete thread
                      </button>
                    )}
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => void togglePin()}
                          className="text-brand-teal hover:underline"
                        >
                          {thread.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleLock()}
                          className="text-brand-teal hover:underline"
                        >
                          {thread.locked ? "Unlock" : "Lock"}
                        </button>
                      </>
                    )}
                    {appUser && (
                      <button
                        type="button"
                        onClick={() => setReportFor({ postId: null })}
                        className="text-brand-muted hover:underline"
                      >
                        Report
                      </button>
                    )}
                  </div>
                </>
              )}
            </article>

            {/* Replies */}
            <h2 className="mb-2 text-sm font-semibold text-brand-ink">
              {thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}
            </h2>
            <ul className="space-y-3" aria-label="Replies">
              {ordered.map((post) => (
                <li key={post.id} className="rounded-lg border border-brand-line p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold text-brand-ink">
                      {post.authorName}
                    </span>
                    <span className="text-xs text-brand-muted">
                      {formatRelativeTime(post.createdAtMillis, now)}
                      {post.editedAtMillis ? " · edited" : ""}
                    </span>
                  </div>

                  {editingPostId === post.id ? (
                    <div className="mt-1 space-y-2">
                      <textarea
                        value={editPostBody}
                        onChange={(e) =>
                          setEditPostBody(e.target.value.slice(0, MAX_BODY_LENGTH))
                        }
                        maxLength={MAX_BODY_LENGTH}
                        rows={3}
                        className="input-field w-full resize-y text-sm"
                        aria-label="Edit reply"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void saveEditPost(post.id)}
                          className="btn-primary text-xs"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingPostId(null)}
                          className="btn-secondary text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-brand-ink">
                      {post.body}
                    </p>
                  )}

                  {reactionRow(post)}

                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {canEdit(
                      viewer,
                      { authorId: post.authorId, createdAtMillis: post.createdAtMillis },
                      now
                    ) &&
                      editingPostId !== post.id && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingPostId(post.id);
                            setEditPostBody(post.body);
                          }}
                          className="text-brand-teal hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    {canModerate(viewer, { authorId: post.authorId }) && (
                      <button
                        type="button"
                        onClick={() => void handleDeletePost(post.id)}
                        className="text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    )}
                    {appUser && (
                      <button
                        type="button"
                        onClick={() => setReportFor({ postId: post.id })}
                        className="text-brand-muted hover:underline"
                      >
                        Report
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {/* Report form */}
            {reportFor && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitReport();
                }}
                className="card mt-4 space-y-2"
              >
                <label className="block text-xs font-medium text-brand-muted">
                  Why are you reporting this {reportFor.postId ? "reply" : "thread"}?
                </label>
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value.slice(0, 1000))}
                  rows={2}
                  className="input-field w-full resize-y text-sm"
                  aria-label="Report reason"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={reportReason.trim().length === 0}
                    className="btn-primary text-xs disabled:opacity-60"
                  >
                    Submit report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReportFor(null);
                      setReportReason("");
                    }}
                    className="btn-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {/* Reply composer */}
            {appUser &&
              (thread.locked ? (
                <p className="card mt-4 text-center text-sm text-brand-muted">
                  🔒 This thread is locked. New replies are disabled.
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleReply();
                  }}
                  className="card mt-4"
                >
                  <label
                    htmlFor="forum-reply"
                    className="mb-1 block text-xs font-medium text-brand-muted"
                  >
                    Add a reply
                  </label>
                  <textarea
                    id="forum-reply"
                    value={reply}
                    onChange={(e) => setReply(e.target.value.slice(0, MAX_BODY_LENGTH))}
                    maxLength={MAX_BODY_LENGTH}
                    rows={3}
                    placeholder="Write a reply… Use @name to mention someone."
                    className="input-field w-full resize-y text-sm"
                  />
                  <div className="mt-1 flex items-center justify-between">
                    <button
                      type="submit"
                      disabled={replyPosting || reply.trim().length === 0}
                      className="btn-primary text-sm disabled:opacity-60"
                    >
                      {replyPosting ? "Posting…" : "Post reply"}
                    </button>
                    <span className="text-xs text-brand-muted">
                      {reply.length}/{MAX_BODY_LENGTH}
                    </span>
                  </div>
                </form>
              ))}
          </>
        )}
      </div>
    </LearnerShell>
  );
}
