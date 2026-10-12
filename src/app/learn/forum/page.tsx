"use client";

/**
 * /learn/forum — community forum landing: the list of categories the signed-in
 * user may view (visibility "all", or "cohort" categories that intersect the
 * user's cohortIds). Gated behind the `communityForum` feature flag.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import { getFeatureFlag } from "@/lib/featureFlags";
import { fetchCategories } from "@/lib/forumClient";
import { visibleCategories, type ForumCategoryDoc } from "@/lib/forum";

export default function ForumHome() {
  const { appUser } = useAuth();
  const router = useRouter();
  const [flagState, setFlagState] = useState<"loading" | "on" | "off">("loading");
  const [categories, setCategories] = useState<ForumCategoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const on = await getFeatureFlag("communityForum");
      if (!active) return;
      setFlagState(on ? "on" : "off");
      if (!on) return;
      try {
        const cats = await fetchCategories();
        if (active) setCategories(cats);
      } catch (err) {
        console.error("ForumHome: load failed:", err);
        if (active) setError("Could not load the forum. Please try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const visible = appUser
    ? visibleCategories(
        { role: appUser.role, cohortIds: appUser.cohortIds },
        categories
      )
    : [];

  return (
    <LearnerShell>
      <div className="w-4/5 mx-auto px-2.5 py-6">
        <div className="page-hero mb-6">
          <span className="kicker">COMMUNITY</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Forum
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Ask questions, share wins, and connect across cohorts.
          </p>
        </div>

        {flagState === "loading" || (flagState === "on" && loading) ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : flagState === "off" ? (
          <div className="card text-center py-12 text-brand-muted">
            <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-mint" />
            <p>The community forum isn&apos;t available yet. Check back soon.</p>
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : visible.length === 0 ? (
          <div className="card text-center py-12 text-brand-muted">
            <p>No forum categories are open to you yet.</p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label="Forum categories">
            {visible.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/learn/forum/category/${c.id}`)}
                  className="card w-full text-left hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-medium text-brand-ink">{c.name}</h2>
                      {c.description && (
                        <p className="text-sm text-brand-muted line-clamp-2">
                          {c.description}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-brand-muted shrink-0">
                      {c.postCount ?? 0} thread{(c.postCount ?? 0) === 1 ? "" : "s"}
                      {c.visibility === "cohort" && (
                        <span className="ml-2 inline-block rounded-full bg-brand-mint px-2 py-0.5 text-brand-primary">
                          cohort
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 text-xs text-brand-muted">
          <Link href="/learn" className="hover:underline">
            ← Back to my learning
          </Link>
        </p>
      </div>
    </LearnerShell>
  );
}
