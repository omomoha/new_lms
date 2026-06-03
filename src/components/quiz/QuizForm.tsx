"use client";

/**
 * QuizForm — shared learner-facing quiz renderer.
 *
 * Renders an Assessment's questions (radio buttons), calls the gradeAttempt
 * Cloud Function on submit, and shows a results screen with per-question
 * correct/incorrect feedback.
 *
 * Props:
 *  - assessment: the Assessment doc (questions, title, passMark)
 *  - onPassed: optional callback when learner passes (e.g. trigger mark-complete)
 *  - existingAttempt: if provided, render read-only results from a past attempt
 */

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import type { Assessment, Attempt } from "@/types";

interface GradeAttemptRequest {
  assessmentId: string;
  answers: Record<string, number>;
}

interface GradeAttemptResponse {
  score: number;
  total: number;
  passed: boolean;
  perQuestion: Record<string, boolean>;
}

interface QuizFormProps {
  assessment: Assessment;
  onPassed?: () => void;
  /** If provided, show this attempt's results instead of the quiz form */
  existingAttempt?: Attempt | null;
}

export default function QuizForm({ assessment, onPassed, existingAttempt }: QuizFormProps) {
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<GradeAttemptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // retrying=true means the learner clicked Retake — render the form regardless
  // of whether existingAttempt is still set (parent doesn't re-fetch until reload)
  const [retrying, setRetrying] = useState(false);

  const gradeAttemptFn = httpsCallable<GradeAttemptRequest, GradeAttemptResponse>(
    functions,
    "gradeAttempt"
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Validate all questions answered
    for (const q of assessment.questions) {
      if (selected[q.id] === undefined) {
        setError("Please answer all questions before submitting.");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await gradeAttemptFn({
        assessmentId: assessment.id,
        answers: selected,
      });
      setResult(res.data);
      setRetrying(false); // submission complete; reset retrying flag
      if (res.data.passed && onPassed) {
        onPassed();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setSelected({});
    setError(null);
    setRetrying(true);
  };

  // Show read-only past attempt results (only when not actively retrying)
  if (existingAttempt && !result && !retrying) {
    const pct = existingAttempt.total > 0
      ? Math.round((existingAttempt.score / existingAttempt.total) * 100)
      : 0;
    return (
      <div className="card space-y-3">
        <p className="text-sm font-medium" style={{ color: "#13403A" }}>
          Previous result: {existingAttempt.score}/{existingAttempt.total} ({pct}%)
        </p>
        <span
          className="inline-block px-3 py-1 rounded-full text-xs font-semibold"
          style={
            existingAttempt.passed
              ? { backgroundColor: "#E7F1DE", color: "#2C7A6B" }
              : { backgroundColor: "#FDE8E8", color: "#B91C1C" }
          }
        >
          {existingAttempt.passed ? "Passed" : "Not passed"}
        </span>
        <button onClick={handleRetry} className="btn-secondary text-xs">
          Retake Assessment
        </button>
      </div>
    );
  }

  // Show grading results
  if (result) {
    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div className="space-y-4">
        <div className="card">
          <h3 className="font-semibold mb-1" style={{ color: "#13403A" }}>
            {assessment.title} — Results
          </h3>
          <p className="text-sm" style={{ color: "#1E302C" }}>
            Score: {result.score}/{result.total} ({pct}%)
          </p>
          <span
            className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold"
            style={
              result.passed
                ? { backgroundColor: "#E7F1DE", color: "#2C7A6B" }
                : { backgroundColor: "#FDE8E8", color: "#B91C1C" }
            }
          >
            {result.passed
              ? `Passed (pass mark: ${assessment.passMark}%)`
              : `Not passed — need ${assessment.passMark}%`}
          </span>
        </div>

        {/* Per-question breakdown */}
        <div className="space-y-3">
          {assessment.questions.map((q, idx) => {
            const correct = result.perQuestion[q.id];
            return (
              <div
                key={q.id}
                className="card !py-3"
                style={{
                  borderLeft: `3px solid ${correct ? "#8FB85C" : "#EF4444"}`,
                }}
              >
                <p className="text-sm font-medium mb-1" style={{ color: "#1E302C" }}>
                  {idx + 1}. {q.prompt}
                </p>
                <p className="text-xs" style={{ color: "#5E6E69" }}>
                  Your answer:{" "}
                  <strong>
                    {selected[q.id] !== undefined
                      ? q.options[selected[q.id]]
                      : "—"}
                  </strong>
                  {" · "}
                  {correct ? (
                    <span style={{ color: "#2C7A6B" }}>Correct</span>
                  ) : (
                    <span style={{ color: "#B91C1C" }}>Incorrect</span>
                  )}
                </p>
              </div>
            );
          })}
        </div>

        {!result.passed && (
          <button onClick={handleRetry} className="btn-secondary text-sm">
            Try Again
          </button>
        )}
      </div>
    );
  }

  // Show quiz form
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="font-semibold text-base" style={{ color: "#13403A" }}>
        {assessment.title}
      </h3>
      <p className="text-xs" style={{ color: "#5E6E69" }}>
        Pass mark: {assessment.passMark}% — answer all questions, then submit.
      </p>

      {assessment.questions.map((q, idx) => (
        <div key={q.id} className="card !py-3 space-y-2">
          <p className="text-sm font-medium" style={{ color: "#1E302C" }}>
            {idx + 1}. {q.prompt}
          </p>
          <div className="space-y-1.5">
            {q.options.map((opt, optIdx) => (
              <label
                key={optIdx}
                className="flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-lg transition-colors"
                style={
                  selected[q.id] === optIdx
                    ? { backgroundColor: "#E7F1DE" }
                    : { backgroundColor: "transparent" }
                }
              >
                <input
                  type="radio"
                  name={q.id}
                  value={optIdx}
                  checked={selected[q.id] === optIdx}
                  onChange={() => setSelected((prev) => ({ ...prev, [q.id]: optIdx }))}
                  className="accent-[#8FB85C]"
                />
                <span className="text-sm" style={{ color: "#1E302C" }}>{opt}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary"
        style={{ opacity: submitting ? 0.7 : 1 }}
      >
        {submitting ? "Submitting…" : "Submit Answers"}
      </button>
    </form>
  );
}
