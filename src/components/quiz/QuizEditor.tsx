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
 *
 * "Import from DOCX" button: reads a .docx file → base64 → calls the
 * parseAssessmentDoc callable → replaces current question state with returned
 * questions. Admin reviews and saves normally.
 *
 * "✨ Generate questions" button: opens an inline panel that calls the
 * generateAssessment callable (admin-only, drafts MCQs from the course/module
 * lesson content) and prefills the question list. If the editor already has
 * question content, an inline Replace/Append choice is shown first. Admin
 * reviews and saves through the normal flow — nothing is auto-saved.
 */

import { useState, useEffect, useRef } from "react";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import db from "@/lib/firebase/firestore";
import functions from "@/lib/firebase/functions";
import { extractTextFromFile, ExtractError } from "@/lib/extractClientText";
import type { Assessment, AssessmentKind, AssessmentQuestion } from "@/types";

interface QuizEditorProps {
  courseId: string;
  kind: AssessmentKind;
  /** Scopes AI generation to this module's lesson content when provided */
  moduleId?: string;
  lessonId?: string;
  /** Existing assessment to prefill (edit mode); null = create mode */
  existing?: Assessment | null;
  onSaved: (assessment: Assessment) => void;
  onCancel: () => void;
}

interface ParsedQuestion {
  prompt: string;
  type: "mcq" | "tf";
  options: string[];
  correctIndex: number;
}

interface ParseAssessmentDocResponse {
  questions: ParsedQuestion[];
  warnings: string[];
}

interface QuestionDraft {
  id: string;
  prompt: string;
  type: "mcq" | "tf";
  options: string[];
  correctIndex: number;
}

interface GeneratedQuestion {
  text: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

interface GenerateAssessmentRequest {
  courseId: string;
  moduleId?: string;
  kind: AssessmentKind;
  numQuestions: number;
  /** Optional pasted learning material — overrides stored lesson content. */
  sourceText?: string;
}

interface GenerateAssessmentResponse {
  questions: GeneratedQuestion[];
}

const GEN_MIN_QUESTIONS = 2;
const GEN_MAX_QUESTIONS = 20;

/** Extract the gRPC-style code from a callable error without using `any`. */
function callableErrorMessage(err: unknown): string {
  const code =
    typeof err === "object" && err !== null && "code" in err && typeof (err as { code: unknown }).code === "string"
      ? (err as { code: string }).code
      : "";
  if (code.endsWith("resource-exhausted")) {
    return "Hourly AI generation limit reached — please try again later.";
  }
  if (code.endsWith("failed-precondition")) {
    return "AI is not configured or there is not enough lesson content to generate from.";
  }
  return "Failed to generate questions. Please try again.";
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
  moduleId,
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

  // Import from DOCX
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  // Generate with AI
  const [showGenPanel, setShowGenPanel] = useState(false);
  const [genNumQuestions, setGenNumQuestions] = useState(5);
  const [genSourceText, setGenSourceText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractedFrom, setExtractedFrom] = useState<string | null>(null);
  const sourceFileRef = useRef<HTMLInputElement>(null);

  const handleSourceFile = async (file: File | null) => {
    if (!file) return;
    setGenError(null);
    setExtracting(true);
    try {
      let text = await extractTextFromFile(file);
      const truncated = text.length > 30000;
      if (truncated) text = text.slice(0, 30000);
      setGenSourceText(text);
      setExtractedFrom(
        `${file.name}${truncated ? " (truncated to 30,000 characters)" : ""}`
      );
    } catch (err: unknown) {
      setExtractedFrom(null);
      setGenError(
        err instanceof ExtractError ? err.message : "Could not read that file."
      );
    } finally {
      setExtracting(false);
      if (sourceFileRef.current) sourceFileRef.current.value = "";
    }
  };
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  // Generated questions waiting on a Replace/Append decision
  const [pendingGenerated, setPendingGenerated] = useState<QuestionDraft[] | null>(null);

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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!e.target) return;
    // Reset input so the same file can be re-selected after fixing
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    setError(null);
    setImportWarnings([]);

    try {
      // Read file as base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // result is "data:<mime>;base64,<data>" — strip the prefix
          const idx = result.indexOf(",");
          resolve(idx !== -1 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(new Error("Failed to read file."));
        reader.readAsDataURL(file);
      });

      const parseDoc = httpsCallable<
        { fileBase64: string; fileName: string },
        ParseAssessmentDocResponse
      >(functions, "parseAssessmentDoc");

      const result = await parseDoc({ fileBase64: base64, fileName: file.name });
      const { questions: parsed, warnings } = result.data;

      if (parsed.length > 0) {
        setQuestions(
          parsed.map((pq) => ({
            id: makeId(),
            prompt: pq.prompt,
            type: pq.type,
            options: pq.options,
            correctIndex: pq.correctIndex,
          }))
        );
      }

      if (warnings.length > 0) {
        setImportWarnings(warnings);
      }

      if (parsed.length === 0 && warnings.length === 0) {
        setError("No questions were found in the document.");
      }
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to import document. Check the file format and try again."
      );
    } finally {
      setImporting(false);
    }
  };

  const generatedToDrafts = (generated: GeneratedQuestion[]): QuestionDraft[] =>
    generated.map((g) => ({
      id: makeId(),
      prompt: g.text,
      type: "mcq" as const,
      options: g.options,
      correctIndex: g.correctIndex,
    }));

  // True when the editor holds anything beyond the initial blank question
  const hasQuestionContent = questions.some(
    (q) => q.prompt.trim().length > 0 || q.options.some((o) => o.trim().length > 0)
  );

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    setPendingGenerated(null);

    try {
      const num = Number.isFinite(genNumQuestions)
        ? Math.min(GEN_MAX_QUESTIONS, Math.max(GEN_MIN_QUESTIONS, Math.round(genNumQuestions)))
        : 5;
      const generateFn = httpsCallable<GenerateAssessmentRequest, GenerateAssessmentResponse>(
        functions,
        "generateAssessment",
        // Callable client default is 70s — generation can exceed it
        { timeout: 240000 }
      );
      const result = await generateFn({
        courseId,
        ...(moduleId ? { moduleId } : {}),
        kind,
        numQuestions: num,
        ...(genSourceText.trim() ? { sourceText: genSourceText.trim() } : {}),
      });
      const drafts = generatedToDrafts(result.data.questions);
      if (drafts.length === 0) {
        setGenError("No questions were generated. Please try again.");
        return;
      }
      if (hasQuestionContent) {
        // Ask Replace / Append before touching existing work
        setPendingGenerated(drafts);
      } else {
        setQuestions(drafts);
        setShowGenPanel(false);
      }
    } catch (err: unknown) {
      setGenError(callableErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  };

  const applyGenerated = (mode: "replace" | "append") => {
    if (!pendingGenerated) return;
    setQuestions((prev) =>
      mode === "replace" ? pendingGenerated : [...prev, ...pendingGenerated]
    );
    setPendingGenerated(null);
    setShowGenPanel(false);
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
          <label className="text-xs font-medium text-brand-muted">
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

      {/* Import from DOCX */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={importFileRef}
          type="file"
          accept=".docx"
          className="hidden"
          onChange={handleImport}
        />
        <button
          type="button"
          disabled={importing}
          onClick={() => importFileRef.current?.click()}
          className="btn-secondary text-xs flex items-center gap-1.5"
        >
          {importing ? "Importing…" : "Import from DOCX"}
        </button>
        <button
          type="button"
          onClick={() => setShowFormatGuide((v) => !v)}
          className="text-xs underline text-brand-teal"
        >
          {showFormatGuide ? "Hide format guide" : "Format guide"}
        </button>
        <button
          type="button"
          onClick={() => {
            setShowGenPanel((v) => !v);
            setGenError(null);
            setPendingGenerated(null);
          }}
          aria-expanded={showGenPanel}
          className="btn-secondary text-xs flex items-center gap-1.5"
        >
          ✨ Generate questions
        </button>
      </div>

      {/* Generate with AI panel */}
      {showGenPanel && (
        <div className="rounded-lg p-3 text-xs space-y-2 border bg-brand-mint border-brand-line text-brand-ink">
          <p className="font-semibold text-brand-primary">Generate questions with AI</p>
          <p className="text-brand-muted">
            Paste the learning material below, or leave it empty to use the{" "}
            {moduleId ? "module's" : "course's"} stored lesson content. Review
            and edit the drafted questions before saving.
          </p>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor="gen-source-text"
                className="block font-medium text-brand-muted"
              >
                Learning content (optional)
              </label>
              <button
                type="button"
                className="btn-secondary text-xs !py-1"
                disabled={generating || extracting}
                onClick={() => sourceFileRef.current?.click()}
              >
                {extracting ? "Reading file…" : "⬆ Upload document (PDF / DOCX / TXT)"}
              </button>
              <input
                ref={sourceFileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown"
                className="hidden"
                aria-label="Upload learning content document"
                onChange={(e) => void handleSourceFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {extractedFrom && (
              <p className="text-brand-teal mb-1">Loaded from {extractedFrom} — review below, then generate.</p>
            )}
            <textarea
              id="gen-source-text"
              className="input-field text-xs resize-y font-mono"
              rows={6}
              maxLength={30000}
              placeholder={
                "Paste the source material for the questions — lesson notes, a syllabus section, " +
                "transcript, or the text of a slide deck…\n\nLeave empty to generate from the " +
                "lessons already saved on this " + (moduleId ? "module." : "course.")
              }
              value={genSourceText}
              onChange={(e) => setGenSourceText(e.target.value)}
              disabled={generating}
            />
            <p className="text-right text-brand-muted mt-0.5">
              {genSourceText.length.toLocaleString()} / 30,000
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="gen-num-questions" className="font-medium text-brand-muted">
              Number of questions:
            </label>
            <input
              id="gen-num-questions"
              type="number"
              min={GEN_MIN_QUESTIONS}
              max={GEN_MAX_QUESTIONS}
              className="input-field w-20 text-xs py-1"
              value={genNumQuestions}
              onChange={(e) => setGenNumQuestions(Number(e.target.value))}
              disabled={generating}
            />
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="btn-primary text-xs"
            >
              {generating ? "Generating…" : "Generate"}
            </button>
          </div>
          {pendingGenerated && (
            <div className="rounded-lg p-2 space-y-1.5 border border-brand-line bg-white">
              <p className="font-medium text-brand-ink">
                {pendingGenerated.length} question{pendingGenerated.length !== 1 ? "s" : ""} generated.
                The editor already has questions — what should happen to them?
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => applyGenerated("replace")}
                  className="btn-primary text-xs"
                >
                  Replace existing
                </button>
                <button
                  type="button"
                  onClick={() => applyGenerated("append")}
                  className="btn-secondary text-xs"
                >
                  Append
                </button>
                <button
                  type="button"
                  onClick={() => setPendingGenerated(null)}
                  className="text-xs underline text-brand-muted"
                >
                  Discard generated
                </button>
              </div>
            </div>
          )}
          {genError && (
            <p role="alert" className="text-red-600">{genError}</p>
          )}
        </div>
      )}

      {showFormatGuide && (
        <div
          className="rounded-lg p-3 text-xs space-y-1.5 border bg-brand-mint border-brand-accent text-brand-ink"
        >
          <p className="font-semibold text-brand-primary">Expected DOCX layout</p>
          <p>Separate each question block with a blank line. Supported formats:</p>
          <pre
            className="rounded p-2 mt-1 text-xs overflow-x-auto bg-brand-cream text-brand-ink"
          >{`Q1. What is the capital of France?
A) Paris / B) London / C) Berlin / D) Madrid
Answer: A

Q2. JavaScript is a compiled language.
A) True / B) False
Answer: B

Q3. Which of these is a JS framework?
A) Django
B) React
C) Laravel
D) Flask
Ans: B`}</pre>
          <ul className="list-disc list-inside space-y-0.5 mt-1 text-brand-muted">
            <li>Question line must start with <code>Q1.</code>, <code>Q2.</code>, etc.</li>
            <li>Options: 2–6 choices prefixed A), B), … (slash-separated or one per line)</li>
            <li>Answer line: <code>Answer: B</code> or <code>Ans: B</code> (case-insensitive)</li>
            <li>True/False: use exactly <code>True</code> / <code>False</code> as options</li>
            <li>Legacy .doc files must be saved as .docx first</li>
          </ul>
        </div>
      )}

      {/* Import warnings */}
      {importWarnings.length > 0 && (
        <div
          className="rounded-lg p-3 text-xs space-y-1 border bg-amber-100 border-amber-500 text-amber-800"
        >
          <p className="font-semibold">Import warnings ({importWarnings.length})</p>
          <ul className="list-disc list-inside space-y-0.5">
            {importWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Questions */}
      {questions.map((q, qIdx) => (
        <div
          key={q.id}
          className="card !py-3 space-y-2"
          style={{ borderLeft: "3px solid #8FB85C" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-brand-teal">
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
            <label className="text-xs text-brand-muted">Type:</label>
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
            <p className="text-xs font-medium text-brand-muted">
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
                  <span className="text-sm text-brand-ink">{opt}</span>
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
                className="text-xs text-brand-teal"
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
        <p className="text-xs rounded-md px-3 py-2 bg-amber-100 text-amber-800">
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
