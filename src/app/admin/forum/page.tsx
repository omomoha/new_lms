"use client";

/**
 * /admin/forum — moderation surface for the community forum.
 *
 *   • Categories: create/edit/delete, set visibility (all | cohort), toggle
 *     opt-in AI pre-moderation (default OFF).
 *   • Reports queue: open reports with a link to the offending thread and a
 *     "resolve" action.
 *
 * Admin-only (AdminShell already redirects non-admins). All writes are
 * additionally enforced admin-only by firestore.rules.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  updateDoc,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import {
  createCategory,
  deleteCategory,
  fetchCategories,
  updateCategory,
} from "@/lib/forumClient";
import type { ForumCategoryDoc } from "@/lib/forum";

interface ReportRow {
  id: string;
  reporterName: string;
  threadId: string;
  postId: string | null;
  reason: string;
}

export default function AdminForumPage() {
  const [categories, setCategories] = useState<ForumCategoryDoc[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-category form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [order, setOrder] = useState(0);
  const [visibility, setVisibility] = useState<"all" | "cohort">("all");
  const [cohortIds, setCohortIds] = useState("");
  const [aiModeration, setAiModeration] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, reportSnap] = await Promise.all([
        fetchCategories(),
        getDocs(query(collection(db, "forumReports"), where("resolved", "==", false))),
      ]);
      setCategories(cats.sort((a, b) => a.order - b.order));
      setReports(
        reportSnap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            reporterName: typeof x.reporterName === "string" ? x.reporterName : "Member",
            threadId: typeof x.threadId === "string" ? x.threadId : "",
            postId: typeof x.postId === "string" ? x.postId : null,
            reason: typeof x.reason === "string" ? x.reason : "",
          };
        })
      );
    } catch (err) {
      console.error("AdminForum: load failed:", err);
      setError("Could not load forum admin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreate = useCallback(async () => {
    if (saving || name.trim().length === 0) return;
    setSaving(true);
    try {
      await createCategory({
        name: name.trim(),
        description: description.trim(),
        order,
        visibility,
        cohortIds:
          visibility === "cohort"
            ? cohortIds.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        aiModeration,
      });
      setName("");
      setDescription("");
      setOrder(0);
      setVisibility("all");
      setCohortIds("");
      setAiModeration(false);
      await loadAll();
    } catch (err) {
      console.error("AdminForum: create category failed:", err);
      setError("Could not create the category.");
    } finally {
      setSaving(false);
    }
  }, [saving, name, description, order, visibility, cohortIds, aiModeration, loadAll]);

  const toggleAi = useCallback(
    async (cat: ForumCategoryDoc) => {
      try {
        await updateCategory(cat.id, { aiModeration: !cat.aiModeration });
        await loadAll();
      } catch (err) {
        console.error("AdminForum: toggle ai failed:", err);
        setError("Could not update AI moderation.");
      }
    },
    [loadAll]
  );

  const removeCategory = useCallback(
    async (id: string) => {
      try {
        await deleteCategory(id);
        await loadAll();
      } catch (err) {
        console.error("AdminForum: delete category failed:", err);
        setError("Could not delete the category.");
      }
    },
    [loadAll]
  );

  const resolveReport = useCallback(
    async (id: string) => {
      try {
        await updateDoc(doc(db, "forumReports", id), { resolved: true });
        setReports((prev) => prev.filter((r) => r.id !== id));
      } catch (err) {
        console.error("AdminForum: resolve report failed:", err);
        setError("Could not resolve the report.");
      }
    },
    []
  );

  return (
    <AdminShell>
      <div className="space-y-8">
        <div>
          <h1 className="font-serif-brand text-2xl text-brand-ink">Forum moderation</h1>
          <p className="text-sm text-brand-muted">
            Manage categories and review reported content.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (
          <>
            {/* Reports queue */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-brand-ink">
                Open reports ({reports.length})
              </h2>
              {reports.length === 0 ? (
                <p className="text-sm text-brand-muted">No open reports. </p>
              ) : (
                <ul className="space-y-2">
                  {reports.map((r) => (
                    <li
                      key={r.id}
                      className="card flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-brand-ink">{r.reason}</p>
                        <p className="text-xs text-brand-muted">
                          Reported by {r.reporterName} ·{" "}
                          {r.postId ? "reply" : "thread"} ·{" "}
                          <Link
                            href={`/learn/forum/thread/${r.threadId}`}
                            className="text-brand-teal hover:underline"
                          >
                            view thread
                          </Link>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void resolveReport(r.id)}
                        className="btn-secondary text-xs shrink-0"
                      >
                        Resolve
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Categories */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-brand-ink">Categories</h2>
              <ul className="mb-4 space-y-2">
                {categories.map((c) => (
                  <li
                    key={c.id}
                    className="card flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-brand-ink">
                        {c.name}{" "}
                        <span className="text-xs text-brand-muted">
                          ({c.visibility})
                        </span>
                      </p>
                      {c.description && (
                        <p className="text-xs text-brand-muted line-clamp-1">
                          {c.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <label className="flex items-center gap-1 text-brand-muted">
                        <input
                          type="checkbox"
                          checked={c.aiModeration === true}
                          onChange={() => void toggleAi(c)}
                        />
                        AI moderation
                      </label>
                      <button
                        type="button"
                        onClick={() => void removeCategory(c.id)}
                        className="text-red-700 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
                {categories.length === 0 && (
                  <li className="text-sm text-brand-muted">No categories yet.</li>
                )}
              </ul>

              {/* New category */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleCreate();
                }}
                className="card space-y-2"
              >
                <h3 className="text-sm font-semibold text-brand-ink">New category</h3>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name"
                  className="input-field w-full text-sm"
                  aria-label="Category name"
                />
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Description"
                  className="input-field w-full text-sm"
                  aria-label="Category description"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs text-brand-muted">
                    Order
                    <input
                      type="number"
                      value={order}
                      onChange={(e) => setOrder(Number(e.target.value) || 0)}
                      className="input-field ml-1 w-16 text-sm"
                      aria-label="Order"
                    />
                  </label>
                  <label className="text-xs text-brand-muted">
                    Visibility
                    <select
                      value={visibility}
                      onChange={(e) =>
                        setVisibility(e.target.value === "cohort" ? "cohort" : "all")
                      }
                      className="input-field ml-1 text-sm"
                      aria-label="Visibility"
                    >
                      <option value="all">all</option>
                      <option value="cohort">cohort</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1 text-xs text-brand-muted">
                    <input
                      type="checkbox"
                      checked={aiModeration}
                      onChange={(e) => setAiModeration(e.target.checked)}
                    />
                    AI pre-moderation
                  </label>
                </div>
                {visibility === "cohort" && (
                  <input
                    value={cohortIds}
                    onChange={(e) => setCohortIds(e.target.value)}
                    placeholder="Cohort IDs (comma-separated)"
                    className="input-field w-full text-sm"
                    aria-label="Cohort IDs"
                  />
                )}
                <button
                  type="submit"
                  disabled={saving || name.trim().length === 0}
                  className="btn-primary text-sm disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Create category"}
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </AdminShell>
  );
}
