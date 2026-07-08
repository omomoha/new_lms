"use client";

/**
 * /learn/forum/category/[categoryId] — thread list for one category, with
 * real-time updates (onSnapshot), a "new thread" composer, and a title/body
 * search box. Threads sort pinned-first then by last activity.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import { getFeatureFlag } from "@/lib/featureFlags";
import {
  createThread,
  fetchCategory,
  subscribeThreads,
} from "@/lib/forumClient";
import {
  canViewCategory,
  searchThreads,
  sortThreads,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  type ForumCategoryDoc,
  type ForumThreadDoc,
} from "@/lib/forum";
import { formatRelativeTime } from "@/components/forum/relativeTime";

export default function ForumCategoryPage() {
  const { appUser } = useAuth();
  const router = useRouter();
  const params = useParams<{ categoryId: string }>();
  const categoryId = params.categoryId;

  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [category, setCategory] = useState<ForumCategoryDoc | null>(null);
  const [threads, setThreads] = useState<ForumThreadDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const [search, setSearch] = useState("");
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

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

  useEffect(() => {
    if (enabled !== true || !appUser) return;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const cat = await fetchCategory(categoryId);
        if (!cat) {
          setError("This category no longer exists.");
          setLoading(false);
          return;
        }
        if (
          !canViewCategory(
            { role: appUser.role, cohortIds: appUser.cohortIds },
            cat
          )
        ) {
          setDenied(true);
          setLoading(false);
          return;
        }
        setCategory(cat);
        unsub = subscribeThreads(
          categoryId,
          (t) => {
            setThreads(t);
            setLoading(false);
          },
          (err) => {
            console.error("ForumCategory: subscribe failed:", err);
            setError("Could not load threads. Please try again.");
            setLoading(false);
          }
        );
      } catch (err) {
        console.error("ForumCategory: load failed:", err);
        setError("Could not load this category.");
        setLoading(false);
      }
    })();
    return () => unsub?.();
  }, [enabled, appUser, categoryId]);

  const displayName = useMemo(() => {
    if (!appUser) return "";
    const name = appUser.name?.trim();
    const prefix = appUser.email.split("@")[0] ?? "";
    return (name || prefix || "Member").slice(0, 100);
  }, [appUser]);

  const handleCreate = useCallback(async () => {
    if (!appUser || posting) return;
    if (title.trim().length === 0 || body.trim().length === 0) return;
    setPosting(true);
    setPostError(null);
    try {
      const id = await createThread({
        categoryId,
        authorId: appUser.uid,
        authorName: displayName,
        title,
        body,
      });
      setTitle("");
      setBody("");
      setShowComposer(false);
      router.push(`/learn/forum/thread/${id}`);
    } catch (err) {
      console.error("ForumCategory: create thread failed:", err);
      setPostError("Could not post your thread. Please try again.");
    } finally {
      setPosting(false);
    }
  }, [appUser, posting, title, body, categoryId, displayName, router]);

  const visibleThreads = useMemo(
    () => sortThreads(searchThreads(threads, search)),
    [threads, search]
  );
  const now = Date.now();

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
          <Link href="/learn/forum" className="hover:underline">
            ← All categories
          </Link>
        </p>

        {denied ? (
          <div className="card text-center py-12 text-brand-muted">
            You don&apos;t have access to this category.
          </div>
        ) : loading || enabled === null ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-serif-brand text-2xl text-brand-ink">
                  {category?.name}
                </h1>
                {category?.description && (
                  <p className="text-sm text-brand-muted">{category.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowComposer((v) => !v)}
                className="btn-primary text-sm shrink-0"
              >
                {showComposer ? "Cancel" : "New thread"}
              </button>
            </div>

            {showComposer && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreate();
                }}
                className="card mb-4 space-y-2"
              >
                {postError && (
                  <p role="alert" className="text-xs text-red-600">
                    {postError}
                  </p>
                )}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                  maxLength={MAX_TITLE_LENGTH}
                  placeholder="Thread title"
                  className="input-field w-full text-sm"
                  aria-label="Thread title"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
                  maxLength={MAX_BODY_LENGTH}
                  rows={4}
                  placeholder="What's on your mind? Use @name to mention someone."
                  className="input-field w-full resize-y text-sm"
                  aria-label="Thread body"
                />
                <div className="flex items-center justify-between">
                  <button
                    type="submit"
                    disabled={posting || !title.trim() || !body.trim()}
                    className="btn-primary text-sm disabled:opacity-60"
                  >
                    {posting ? "Posting…" : "Post thread"}
                  </button>
                  <span className="text-xs text-brand-muted">
                    {body.length}/{MAX_BODY_LENGTH}
                  </span>
                </div>
              </form>
            )}

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search threads…"
              className="input-field mb-4 w-full text-sm"
              aria-label="Search threads"
            />

            {visibleThreads.length === 0 ? (
              <p className="py-8 text-center text-sm text-brand-muted">
                {search.trim()
                  ? "No threads match your search."
                  : "No threads yet — start the first one."}
              </p>
            ) : (
              <ul className="space-y-2" aria-label="Threads">
                {visibleThreads.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/learn/forum/thread/${t.id}`}
                      className="card block hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="font-medium text-brand-ink truncate">
                          {t.pinned && (
                            <span aria-label="Pinned" title="Pinned" className="mr-1">
                              📌
                            </span>
                          )}
                          {t.locked && (
                            <span aria-label="Locked" title="Locked" className="mr-1">
                              🔒
                            </span>
                          )}
                          {t.title}
                        </h2>
                        <span className="text-xs text-brand-muted shrink-0">
                          {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-brand-muted">
                        {t.authorName} ·{" "}
                        {formatRelativeTime(
                          t.lastReplyAtMillis ?? t.createdAtMillis,
                          now
                        )}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </LearnerShell>
  );
}
