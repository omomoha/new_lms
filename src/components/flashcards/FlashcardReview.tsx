"use client";

/**
 * FlashcardReview — spaced-repetition review session.
 *
 * Receives the due cards (already filtered/sorted by the page), shows one at
 * a time with a flip interaction (click or Space reveals the back), then four
 * grade buttons (Again/Hard/Good/Easy — keyboard 1–4). Each grade applies
 * spacedRepetition.review() and persists the new scheduling state with
 * updateDoc on the card's flashcards/{id} doc.
 */

import { useCallback, useEffect, useState } from "react";
import { doc, updateDoc, Timestamp } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { review, type ReviewGrade } from "@/lib/spacedRepetition";

/** flashcards/{id} — created by the generateFlashcards Cloud Function. */
export interface FlashcardDoc {
  id: string;
  userId: string;
  courseId: string;
  moduleId: string | null;
  front: string;
  back: string;
  interval: number;
  ease: number;
  reps: number;
  due: Timestamp;
  createdAt: Timestamp;
}

interface FlashcardReviewProps {
  /** Due cards, in the order they should be reviewed. */
  cards: FlashcardDoc[];
  /** Called once after the final card has been graded. */
  onFinished?: () => void;
}

const GRADES: Array<{
  grade: ReviewGrade;
  label: string;
  key: string;
  classes: string;
}> = [
  { grade: "again", label: "Again", key: "1", classes: "bg-red-700 text-white hover:opacity-90" },
  { grade: "hard", label: "Hard", key: "2", classes: "bg-amber-500 text-white hover:opacity-90" },
  { grade: "good", label: "Good", key: "3", classes: "bg-brand-teal text-white hover:opacity-90" },
  { grade: "easy", label: "Easy", key: "4", classes: "bg-brand-accent text-brand-primary hover:opacity-90" },
];

export default function FlashcardReview({ cards, onFinished }: FlashcardReviewProps) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const total = cards.length;
  const card = !done && index < total ? cards[index] : null;

  const advance = useCallback(() => {
    setRevealed(false);
    setError(null);
    if (index + 1 >= total) {
      setDone(true);
      onFinished?.();
    } else {
      setIndex((i) => i + 1);
    }
  }, [index, total, onFinished]);

  const handleGrade = useCallback(
    async (grade: ReviewGrade) => {
      if (!card || saving) return;
      setSaving(true);
      setError(null);
      try {
        const next = review(
          { interval: card.interval ?? 0, ease: card.ease ?? 2.5, reps: card.reps ?? 0 },
          grade,
          new Date()
        );
        await updateDoc(doc(db, "flashcards", card.id), {
          interval: next.interval,
          ease: next.ease,
          reps: next.reps,
          due: Timestamp.fromDate(next.due),
        });
        advance();
      } catch (err: unknown) {
        console.error("FlashcardReview: failed to save review:", err);
        setError("Couldn't save that review — check your connection and try again.");
      } finally {
        setSaving(false);
      }
    },
    [card, saving, advance]
  );

  // Keyboard shortcuts: Space flips, 1–4 grade once revealed
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!card) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        setRevealed((r) => !r);
        return;
      }
      if (revealed && !saving) {
        const match = GRADES.find((g) => g.key === e.key);
        if (match) {
          e.preventDefault();
          void handleGrade(match.grade);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [card, revealed, saving, handleGrade]);

  if (total === 0) return null;

  if (done || !card) {
    return (
      <div className="card text-center py-10">
        <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-accent" />
        <p className="font-semibold text-brand-primary mb-1">Session complete</p>
        <p className="text-sm text-brand-muted">
          You reviewed {total} card{total === 1 ? "" : "s"}. Nice work — come back when the
          next ones are due.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-brand-muted">
        <span className="font-medium tabular-nums">
          {index} / {total} reviewed
        </span>
        <span>Space to flip · 1–4 to grade</span>
      </div>

      {/* Card */}
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="card w-full text-left min-h-[14rem] flex flex-col cursor-pointer hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-accent"
        aria-label={revealed ? "Hide answer" : "Show answer"}
      >
        <span className="kicker">{revealed ? "ANSWER" : "QUESTION"}</span>
        <p className="text-lg text-brand-ink whitespace-pre-wrap flex-1">
          {revealed ? card.back : card.front}
        </p>
        <span className="mt-4 text-xs text-brand-muted">
          {revealed ? "Click to see the question again" : "Click or press Space to reveal"}
        </span>
      </button>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Grade buttons */}
      {revealed ? (
        <div className="grid grid-cols-4 gap-2">
          {GRADES.map((g) => (
            <button
              key={g.grade}
              type="button"
              disabled={saving}
              onClick={() => void handleGrade(g.grade)}
              className={`px-3 py-2.5 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50 ${g.classes}`}
            >
              {g.label}
              <span className="block text-[10px] font-normal opacity-80">{g.key}</span>
            </button>
          ))}
        </div>
      ) : (
        <button type="button" className="btn-secondary w-full" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      )}
    </div>
  );
}
