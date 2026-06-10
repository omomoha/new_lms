"use client";

/**
 * LessonFeedback — "Was this lesson helpful?" widget shown at the bottom of
 * every lesson page.
 *
 * Writes lessonFeedback/{uid}_{lessonId}:
 *   { userId, lessonId, courseId, rating (1–5 int), comment (trimmed string,
 *     may be ""), updatedAt: serverTimestamp() }
 *
 * Loads any existing feedback on mount and prefills so the learner can edit.
 * All failures degrade to a small inline message — this widget must never
 * crash the lesson page.
 */

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";

const MAX_COMMENT_LENGTH = 1000;

interface LessonFeedbackProps {
  lessonId: string;
  courseId: string;
}

/** Shape of the lessonFeedback/{uid}_{lessonId} document (read side). */
interface LessonFeedbackDoc {
  userId: string;
  lessonId: string;
  courseId: string;
  rating: number;
  comment: string;
}

export default function LessonFeedback({ lessonId, courseId }: LessonFeedbackProps) {
  const { appUser } = useAuth();

  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing feedback and prefill (also resets state on lesson change)
  useEffect(() => {
    setRating(0);
    setHovered(0);
    setComment("");
    setSaved(false);
    setHasExisting(false);
    setError(null);
    if (!appUser) return;

    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(
          doc(db, "lessonFeedback", `${appUser.uid}_${lessonId}`)
        );
        if (cancelled || !snap.exists()) return;
        const data = snap.data() as Partial<LessonFeedbackDoc>;
        if (typeof data.rating === "number" && data.rating >= 1 && data.rating <= 5) {
          setRating(Math.round(data.rating));
        }
        if (typeof data.comment === "string") {
          setComment(data.comment.slice(0, MAX_COMMENT_LENGTH));
        }
        setHasExisting(true);
        setSaved(true);
      } catch (err: unknown) {
        // Prefill failing is non-fatal — learner can still submit fresh feedback.
        console.warn("LessonFeedback: could not load existing feedback:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [appUser, lessonId]);

  const handleSelectRating = useCallback((value: number) => {
    setRating(value);
    setSaved(false);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!appUser || rating < 1 || rating > 5 || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(db, "lessonFeedback", `${appUser.uid}_${lessonId}`), {
        userId: appUser.uid,
        lessonId,
        courseId,
        rating: Math.round(rating),
        comment: comment.trim().slice(0, MAX_COMMENT_LENGTH),
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
      setHasExisting(true);
    } catch (err: unknown) {
      console.error("LessonFeedback: save failed:", err);
      setError("Could not save your feedback. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [appUser, rating, comment, lessonId, courseId, saving]);

  // No signed-in learner → render nothing (never block the lesson page)
  if (!appUser) return null;

  return (
    <section aria-label="Lesson feedback" className="card max-w-2xl">
      <h2 className="text-sm font-semibold text-brand-primary">
        Was this lesson helpful?
      </h2>

      {/* Star rating */}
      <div
        role="group"
        aria-label="Rate this lesson from 1 to 5 stars"
        className="mt-2 flex items-center gap-1"
        onMouseLeave={() => setHovered(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= (hovered || rating);
          return (
            <button
              key={n}
              type="button"
              onClick={() => handleSelectRating(n)}
              onMouseEnter={() => setHovered(n)}
              onFocus={() => setHovered(n)}
              onBlur={() => setHovered(0)}
              aria-pressed={n === rating}
              aria-label={`Rate ${n} out of 5`}
              className={`text-2xl leading-none px-0.5 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal ${
                filled ? "text-brand-accent" : "text-brand-line hover:text-brand-mist"
              }`}
            >
              <span aria-hidden="true">{filled ? "★" : "☆"}</span>
            </button>
          );
        })}
        {rating > 0 && (
          <span className="ml-2 text-xs text-brand-muted">{rating}/5</span>
        )}
      </div>

      {/* Optional comment */}
      <div className="mt-3">
        <label
          htmlFor={`lesson-feedback-comment-${lessonId}`}
          className="block text-xs font-medium mb-1 text-brand-muted"
        >
          Add a comment (optional)
        </label>
        <textarea
          id={`lesson-feedback-comment-${lessonId}`}
          value={comment}
          onChange={(e) => {
            setComment(e.target.value.slice(0, MAX_COMMENT_LENGTH));
            setSaved(false);
          }}
          maxLength={MAX_COMMENT_LENGTH}
          rows={3}
          placeholder="What worked well? What could be better?"
          className="input-field w-full resize-y text-sm"
        />
        <p className="mt-1 text-right text-xs text-brand-muted">
          {comment.length}/{MAX_COMMENT_LENGTH}
        </p>
      </div>

      {/* Submit + status */}
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={rating < 1 || saving}
          className="btn-primary text-sm disabled:opacity-60"
        >
          {saving
            ? "Saving…"
            : hasExisting
            ? "Update feedback"
            : "Submit feedback"}
        </button>
        <span aria-live="polite" className="text-sm">
          {saved && !saving && (
            <span className="font-medium text-brand-teal">
              Thanks for your feedback ✓
            </span>
          )}
          {error && <span className="text-red-600 text-xs">{error}</span>}
        </span>
      </div>
    </section>
  );
}
