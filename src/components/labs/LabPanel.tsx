"use client";

/**
 * LabPanel — learner-facing AI lab grading panel for lab lessons.
 *
 * Collapsible "Submit your solution" card: language select + monospace code
 * textarea → calls the gradeLab Cloud Function → renders the rubric grade
 * (score badge, summary, strengths, improvements).
 *
 * On mount it loads any existing grade from labGrades/{uid}_{lessonId}
 * (written ONLY server-side) and offers a "Resubmit" affordance.
 */

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import db from "@/lib/firebase/firestore";
import functions from "@/lib/firebase/functions";
import { useAuth } from "@/contexts/AuthContext";

const LANGUAGES = [
  { value: "js", label: "JavaScript" },
  { value: "ts", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "other", label: "Other" },
] as const;

const MAX_CODE_CHARS = 20000;
const MIN_CODE_CHARS = 20;

interface LabPanelProps {
  courseId: string;
  moduleId: string;
  lessonId: string;
}

interface GradeLabRequest {
  courseId: string;
  moduleId: string;
  lessonId: string;
  code: string;
  language?: string;
}

interface LabGradeResult {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
}

interface StoredLabGrade extends LabGradeResult {
  language?: string;
  gradedAt?: Timestamp;
}

/** Map callable failures to friendly copy — never raw API errors. */
function friendlyError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code.includes("resource-exhausted")) {
    return "You've hit the hourly limit for lab grading — take a break and try again soon.";
  }
  if (code.includes("failed-precondition")) {
    return "AI grading isn't configured on this deployment yet. Ask your admin.";
  }
  if (code.includes("permission-denied")) {
    return "You don't have access to this course.";
  }
  if (code.includes("unauthenticated")) {
    return "Please sign in again to submit your solution.";
  }
  if (code.includes("invalid-argument") && err instanceof Error && err.message) {
    return err.message;
  }
  return "Grading failed. Please try again in a moment.";
}

/** Score badge classes by band: ≥80 accent, ≥50 amber, else red. */
function scoreBadgeClasses(score: number): string {
  if (score >= 80) return "bg-brand-accent text-brand-primary";
  if (score >= 50) return "bg-amber-500 text-white";
  return "bg-red-700 text-white";
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${scoreBadgeClasses(score)}`}
    >
      {score}/100
    </span>
  );
}

function GradeDetails({ grade }: { grade: LabGradeResult }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-ink whitespace-pre-wrap">{grade.summary}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest mb-2 text-brand-teal">
            Strengths
          </h4>
          <ul className="space-y-1.5">
            {grade.strengths.map((s, i) => (
              <li key={i} className="text-sm text-brand-ink flex gap-2">
                <span aria-hidden="true" className="text-brand-accent font-bold">
                  ✓
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-widest mb-2 text-brand-muted">
            Improvements
          </h4>
          <ul className="space-y-1.5">
            {grade.improvements.map((s, i) => (
              <li key={i} className="text-sm text-brand-ink flex gap-2">
                <span aria-hidden="true" className="text-brand-teal font-bold">
                  →
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function LabPanel({ courseId, moduleId, lessonId }: LabPanelProps) {
  const { appUser } = useAuth();

  const [expanded, setExpanded] = useState(false);
  const [language, setLanguage] = useState<string>("js");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabGradeResult | null>(null);
  const [previous, setPrevious] = useState<StoredLabGrade | null>(null);
  const [loadingPrevious, setLoadingPrevious] = useState(true);

  // Load existing grade (labGrades/{uid}_{lessonId}) on mount
  useEffect(() => {
    if (!appUser) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "labGrades", `${appUser.uid}_${lessonId}`));
        if (!cancelled && snap.exists()) {
          setPrevious(snap.data() as StoredLabGrade);
        }
      } catch (err: unknown) {
        // Non-fatal: panel still works for fresh submissions
        console.warn("LabPanel: failed to load previous grade:", err);
      } finally {
        if (!cancelled) setLoadingPrevious(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appUser, lessonId]);

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim();
    if (trimmed.length < MIN_CODE_CHARS) {
      setError(`Please paste your solution (at least ${MIN_CODE_CHARS} characters).`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const fn = httpsCallable<GradeLabRequest, LabGradeResult>(functions, "gradeLab");
      const res = await fn({ courseId, moduleId, lessonId, code: trimmed, language });
      setResult(res.data);
      setPrevious((prev) => ({ ...prev, ...res.data, language }));
    } catch (err: unknown) {
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }, [code, language, courseId, moduleId, lessonId]);

  const showForm = expanded;
  const displayGrade: LabGradeResult | null = result ?? previous;

  return (
    <div className="card !p-0 overflow-hidden">
      {/* Header / toggle */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-3 px-4 sm:px-6 py-4 text-left hover:bg-brand-mint transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span aria-hidden="true" className="w-2.5 h-2.5 rounded-sm rotate-45 bg-brand-accent flex-shrink-0" />
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-brand-primary">
              Submit your solution
            </span>
            <span className="block text-xs text-brand-muted">
              Get instant AI feedback against this lab&apos;s brief
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {!loadingPrevious && displayGrade && <ScoreBadge score={displayGrade.score} />}
          <span aria-hidden="true" className="text-brand-muted text-sm">
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 sm:px-6 pb-5 pt-1 border-t border-brand-line space-y-4">
          {/* Previous / fresh grade */}
          {displayGrade && !submitting && (
            <div className="rounded-lg bg-brand-cream border border-brand-line p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-widest text-brand-muted">
                  {result ? "Your grade" : "Previous grade"}
                </span>
                <ScoreBadge score={displayGrade.score} />
              </div>
              <GradeDetails grade={displayGrade} />
              {!result && (
                <p className="text-xs text-brand-muted">
                  Improve your solution below and resubmit any time.
                </p>
              )}
            </div>
          )}

          {/* Submission form */}
          {showForm && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label htmlFor={`lab-lang-${lessonId}`} className="text-sm font-medium text-brand-ink">
                  Language
                </label>
                <select
                  id={`lab-lang-${lessonId}`}
                  className="input-field !w-auto"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  disabled={submitting}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <textarea
                  className="input-field font-mono text-xs leading-relaxed"
                  rows={14}
                  maxLength={MAX_CODE_CHARS}
                  placeholder="Paste your solution code here…"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={submitting}
                  spellCheck={false}
                  aria-label="Your solution code"
                />
                <div className="mt-1 text-right text-xs text-brand-muted tabular-nums">
                  {code.length.toLocaleString()} / {MAX_CODE_CHARS.toLocaleString()} characters
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSubmit}
                  disabled={submitting || code.trim().length < MIN_CODE_CHARS}
                >
                  {submitting
                    ? "Grading…"
                    : displayGrade
                      ? "Resubmit for grading"
                      : "Submit for grading"}
                </button>
                {submitting && (
                  <span className="text-xs text-brand-muted">
                    A senior-engineer review usually takes a few seconds.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
