"use client";

/**
 * QuizEditor — Admin component for creating/editing an assessment.
 *
 * Used in:
 *  - Course builder lesson form (kind='quiz', lessonId provided)
 *  - Pre/post assessment slots on the builder page (kind='pre'|'post', no lessonId)
 *
 * On save it:
 *  1. Writes/overwrites assessments/{id} (questions without answers)
 *  2. Writes/overwrites assessmentKeys/{id} (answers only)
 *
 * In edit mode (existing != null), fetches assessmentKeys/{id} to prefill
 * correctIndex for each question. Falls back to 0 and shows an amber warning
 * if the key fetch fails.
 */

import { useState, useEffect } from "react";
import { doc, setDoc, getDoc } from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { Assessment, AssessmentKind, AssessmentQuestion } from "@/types";

interface QuizEditorProps {
  courseId: string;
  kind: AssessmentKind;
  lessonId?: string;
  /** Existing assessment to prefill (edit mode); null = create mode */
  existing?: Assessment | null;
  onSaved: (assessment: Assessment) => void;
  onCancel: () => void;
}

interface QuestionDraft {
  id: string;
  prompt: string;
  type: "mcq" | "tf";
  options: string[];
  correctIndex: number;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultTfOptions(): string[] {
  return ["True", "False"];
}

function blankQuestion(): QuestionDraft {
  return {
    id: makeId(),
    prompt: "",
    type: "mcq",
    options: ["", ""],
    correctIndex: 0,
  };
}

export default function QuizEditor({
  courseId,
  kind,
  lessonId,
  existing,
  onSaved,
  onCancel,
}: QuizEditorProps) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [passMark, setPassMark] = useState<number>(existing?.passMark ?? 70);
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => {
    if (!existing) return [blankQuestion()];
    return existing.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      type: q.type,
      options: q.options.length > 0 ? q.options : ["", ""],
      correctIndex: 0, // will be overwritten by the key fetch below
    }));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set to true when we're in edit mode but the key fetch failed
  const [keyFetchWarning, setKeyFetchWarning] = useState(false);

  // In edit mode, fetch the answer key to prefill correctIndex values
  useEffect(() => {
    if (!existing) return;
    const assessmentId = existing.id;
    (async () => {
      try {
        const keySnap = await getDoc(doc(db, "assessmentKeys", assessmentId));
        if (keySnap.exists()) {
          const { answers } = keySnap.data() as { answers: Record<string, number> };
          setQuestions((prev) =>
            prev.map((q) => ({
              ...q,
              correctIndex: answers[q.id] ?? 0,
            }))
          );
        } else {
          setKeyFetchWarning(true);
        }
      } catch {
        setKeyFetchWarning(true);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  const updateQuestion = (idx: number, patch: Partial<QuestionDraft>) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // If switching to tf, reset options
      if (patch.type === "tf") {
        next[idx].options = defaultTfOptions();
        next[idx].correctIndex = 0;
      }
      return next;
    });
  };

  const addOption = (qIdx: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      const q = { ...next[qIdx] };
      if (q.options.length >= 6) return prev;
      q.options = [...q.options, ""];
      next[qIdx] = q;
      return next;
    });
  };

  const removeOption = (qIdx: number, optIdx: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      const q = { ...next[qIdx] };
      if (q.options.length <= 2) return prev;
      const newOpts = q.options.filter((_, i) => i !== optIdx);
      const newCorrect = q.correctIndex >= newOpts.length ? newOpts.length - 1 : q.correctIndex;
      next[qIdx] = { ...q, options: newOpts, correctIndex: newCorrect };
      return next;
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) { setError("Title is required."); return; }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.prompt.trim()) { setError(`Question ${i + 1}: prompt is required.`); return; }
      for (let j = 0; j < q.options.length; j++) {
        if (!q.options[j].trim()) { setError(`Question ${i + 1}, option ${j + 1}: cannot be blank.`); return; }
      }
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        setError(`Question ${i + 1}: select a valid correct answer.`); return;
      }
    }

    setSaving(true);
    try {
      const assessmentId = existing?.id ?? makeId();

      const assessmentQuestions: AssessmentQuestion[] = questions.map((q) => ({
        id: q.id,
        prompt: q.prompt.trim(),
        type: q.type,
        options: q.options.map((o) => o.trim()),
      }));

      const assessmentData: Assessment = {
        id: assessmentId,
        courseId,
        kind,
        title: title.trim(),
        passMark,
        questions: assessmentQuestions,
        ...(lessonId ? { lessonId } : {}),
      };

      // Write assessment doc (no answers)
      await setDoc(doc(db, "assessments", assessmentId), assessmentData);

      // Write answer key — rules allow isAdmin() read+write on assessmentKeys.
      const answers: Record<string, number> = {};
      for (const q of questions) {
        answers[q.id] = q.correctIndex;
      }
      await setDoc(doc(db, "assessmentKeys", assessmentId), { answers });

      onSaved(assessmentData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save assessment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="space-y-2">
        <input
          className="input-field"
          placeholder="Assessment title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium" style={{ color: "#5E6E69" }}>
            Pass mark (%):
          </label>
          <input
            type="number"
            min={1}
            max={100}
            className="input-field w-20 text-sm"
            value={passMark}
            onChange={(e) => setPassMark(Number(e.target.value))}
          />
        </div>
      </div>

      {/* Questions */}
      {questions.map((q, qIdx) => (
        <div
          key={q.id}
          className="card !py-3 space-y-2"
          style={{ borderLeft: "3px solid #8FB85C" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase" style={{ color: "#2C7A6B" }}>
              Question {qIdx + 1}
            </span>
            {questions.length > 1 && (
              <button
                type="button"
                onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== qIdx))}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            )}
          </div>

          <textarea
            className="input-field resize-none"
            rows={2}
            placeholder="Question prompt"
            value={q.prompt}
            onChange={(e) => updateQuestion(qIdx, { prompt: e.target.value })}
            required
          />

          <div className="flex items-center gap-2">
            <label className="text-xs" style={{ color: "#5E6E69" }}>Type:</label>
            <select
              className="input-field text-xs py-1"
              value={q.type}
              onChange={(e) => updateQuestion(qIdx, { type: e.target.value as "mcq" | "tf" })}
            >
              <option value="mcq">Multiple choice</option>
              <option value="tf">True / False</option>
            </select>
          </div>

          {/* Options */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium" style={{ color: "#5E6E69" }}>
              Options — select the correct answer:
            </p>
            {q.options.map((opt, optIdx) => (
              <div key={optIdx} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${q.id}`}
                  checked={q.correctIndex === optIdx}
                  onChange={() => updateQuestion(qIdx, { correctIndex: optIdx })}
                  className="accent-[#8FB85C] flex-shrink-0"
                  title="Mark as correct answer"
                />
                {q.type === "tf" ? (
                  <span className="text-sm" style={{ color: "#1E302C" }}>{opt}</span>
                ) : (
                  <>
                    <input
                      className="input-field flex-1 text-sm py-1"
                      placeholder={`Option ${optIdx + 1}`}
                      value={opt}
                      onChange={(e) => {
                        const newOpts = [...q.options];
                        newOpts[optIdx] = e.target.value;
                        updateQuestion(qIdx, { options: newOpts });
                      }}
                      required
                    />
                    {q.options.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeOption(qIdx, optIdx)}
                        className="text-xs text-red-400 hover:text-red-600"
                        title="Remove option"
                      >
                        ✕
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
            {q.type === "mcq" && q.options.length < 6 && (
              <button
                type="button"
                onClick={() => addOption(qIdx)}
                className="text-xs"
                style={{ color: "#2C7A6B" }}
              >
                + Add option
              </button>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setQuestions((prev) => [...prev, blankQuestion()])}
        className="btn-secondary text-xs"
      >
        + Add Question
      </button>

      {keyFetchWarning && (
        <p className="text-xs rounded-md px-3 py-2" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>
          Re-select correct answers before saving — previous answer key could not be loaded.
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary text-xs">
          {saving ? "Saving…" : "Save Assessment"}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
