"use client";

/**
 * /learn/review — spaced-repetition flashcard review page.
 *
 * Loads ALL of the learner's cards (single where("userId","==",uid) filter so
 * no composite index is needed), filters due ones client-side, and runs a
 * FlashcardReview session. Also hosts the "Generate flashcards" entry: pick
 * an accessible published course → generateFlashcards Cloud Function.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs, query, where, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import db from "@/lib/firebase/firestore";
import functions from "@/lib/firebase/functions";
import { useAuth } from "@/contexts/AuthContext";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import FlashcardReview, { type FlashcardDoc } from "@/components/flashcards/FlashcardReview";
import type { Course } from "@/types";

interface GenerateFlashcardsRequest {
  courseId: string;
}

interface GenerateFlashcardsResponse {
  count: number;
}

function friendlyError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code.includes("resource-exhausted")) {
    return "You've hit the hourly limit for flashcard generation — try again later.";
  }
  if (code.includes("failed-precondition") && err instanceof Error && err.message) {
    return err.message; // e.g. "not enough content" / "not configured"
  }
  if (code.includes("permission-denied")) {
    return "You don't have access to that course.";
  }
  return "Something went wrong. Please try again.";
}

export default function ReviewPage() {
  const { appUser } = useAuth();

  const [cards, setCards] = useState<FlashcardDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Generate section state
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genSuccess, setGenSuccess] = useState<string | null>(null);

  // Session key forces a fresh FlashcardReview after regeneration/reload
  const [sessionKey, setSessionKey] = useState(0);

  const loadCards = useCallback(async () => {
    if (!appUser) return;
    setLoading(true);
    setLoadError(null);
    try {
      const snap = await getDocs(
        query(collection(db, "flashcards"), where("userId", "==", appUser.uid))
      );
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FlashcardDoc));
      setCards(all);
      setSessionKey((k) => k + 1);
    } catch (err: unknown) {
      console.error("ReviewPage: failed to load flashcards:", err);
      setLoadError("Couldn't load your flashcards. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }, [appUser]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  // Accessible published courses for the generate select
  useEffect(() => {
    if (!appUser) return;
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "courses"), where("status", "==", "published"))
        );
        const myCohorts = Array.isArray(appUser.cohortIds) ? appUser.cohortIds : [];
        const accessible = snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Course))
          .filter(
            (c) =>
              appUser.role === "admin" ||
              c.availability === "all" ||
              (c.assignedCohortIds ?? []).some((id) => myCohorts.includes(id))
          );
        setCourses(accessible);
        if (accessible.length > 0) {
          setSelectedCourseId((prev) => prev || accessible[0].id);
        }
      } catch (err: unknown) {
        console.warn("ReviewPage: failed to load courses for generation:", err);
      }
    })();
  }, [appUser]);

  const handleGenerate = useCallback(async () => {
    if (!selectedCourseId) return;
    setGenerating(true);
    setGenError(null);
    setGenSuccess(null);
    try {
      const fn = httpsCallable<GenerateFlashcardsRequest, GenerateFlashcardsResponse>(
        functions,
        "generateFlashcards"
      , {
        // Firebase callable clients default to 70s — AI/conversion calls need longer
        timeout: 180000,
      });
      const res = await fn({ courseId: selectedCourseId });
      const title = courses.find((c) => c.id === selectedCourseId)?.title ?? "this course";
      setGenSuccess(`Created ${res.data.count} cards for ${title}. They're due now — start reviewing!`);
      await loadCards();
    } catch (err: unknown) {
      setGenError(friendlyError(err));
    } finally {
      setGenerating(false);
    }
  }, [selectedCourseId, courses, loadCards]);

  // Due cards: filter + sort client-side (single-field query keeps rules/indexes simple)
  const { dueCards, nextDue } = useMemo(() => {
    const now = Date.now();
    const withDue = cards.map((c) => ({
      card: c,
      dueMs: c.due instanceof Timestamp ? c.due.toMillis() : 0,
    }));
    const due = withDue
      .filter((c) => c.dueMs <= now)
      .sort((a, b) => a.dueMs - b.dueMs)
      .map((c) => c.card);
    const future = withDue
      .filter((c) => c.dueMs > now)
      .sort((a, b) => a.dueMs - b.dueMs);
    return {
      dueCards: due,
      nextDue: future.length > 0 ? new Date(future[0].dueMs) : null,
    };
  }, [cards]);

  return (
    <LearnerShell>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
        {/* Hero */}
        <div className="page-hero mb-6">
          <span className="kicker">MY LEARNING · FLASHCARDS</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Review
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Short, spaced reviews beat cramming — grade yourself honestly.
          </p>
        </div>

        {loadError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {loadError}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        ) : cards.length === 0 ? (
          /* No cards at all */
          <div className="card text-center py-10 mb-6">
            <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-accent" />
            <p className="font-semibold text-brand-primary mb-1">No flashcards yet</p>
            <p className="text-sm text-brand-muted">
              Generate a deck from one of your courses below, or visit a{" "}
              <Link href="/learn" className="text-brand-teal font-medium underline">
                course page
              </Link>{" "}
              to study first.
            </p>
          </div>
        ) : dueCards.length === 0 ? (
          /* Cards exist, none due */
          <div className="card text-center py-10 mb-6">
            <p className="text-2xl mb-2" aria-hidden="true">
              🎉
            </p>
            <p className="font-semibold text-brand-primary mb-1">All caught up</p>
            <p className="text-sm text-brand-muted">
              {nextDue
                ? `Your next review is due ${nextDue.toLocaleString("en-GB", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}.`
                : "Nothing scheduled — generate more cards below."}
            </p>
          </div>
        ) : (
          <div className="mb-6">
            <FlashcardReview key={sessionKey} cards={dueCards} onFinished={() => undefined} />
          </div>
        )}

        {/* Generate flashcards */}
        {!loading && (
          <div className="card">
            <h2 className="text-sm font-semibold mb-1 text-brand-ink">Generate flashcards</h2>
            <p className="text-xs text-brand-muted mb-4">
              AI builds a fresh deck from a course&apos;s lessons. Regenerating a course
              replaces its previous deck.
            </p>

            {courses.length === 0 ? (
              <p className="text-sm text-brand-muted">
                No published courses available to you yet — ask your admin.
              </p>
            ) : (
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  className="input-field sm:flex-1"
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  disabled={generating}
                  aria-label="Course to generate flashcards from"
                >
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleGenerate}
                  disabled={generating || !selectedCourseId}
                >
                  {generating ? "Generating…" : "Generate flashcards"}
                </button>
              </div>
            )}

            {genError && (
              <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                {genError}
              </div>
            )}
            {genSuccess && (
              <div className="mt-3 p-3 rounded-lg bg-brand-mint border border-brand-line text-sm text-brand-teal">
                {genSuccess}
              </div>
            )}
          </div>
        )}
      </div>
    </LearnerShell>
  );
}
