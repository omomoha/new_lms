/**
 * quizSchema — strict validation for AI-generated quiz questions.
 *
 * PURE MODULE: no firebase / SDK imports so it is unit-testable in isolation
 * and reusable on both the functions and (potentially) the client side.
 *
 * Model output is UNTRUSTED. Every field is type-checked, length-capped and
 * rebuilt onto fresh objects so nothing unexpected (extra keys, prototype
 * pollution attempts, wrong types) can flow downstream.
 */

export interface GeneratedQuestion {
  /** Question text, trimmed, 1–500 chars. */
  text: string;
  /** Exactly 4 distinct answer options, each trimmed, 1–200 chars. */
  options: string[];
  /** Index of the correct option: integer 0–3. */
  correctIndex: number;
  /** Optional explanation shown after answering, trimmed, ≤500 chars. */
  explanation?: string;
}

export type QuizValidationResult =
  | { ok: true; questions: GeneratedQuestion[] }
  | { ok: false; error: string };

const MAX_TEXT_CHARS = 500;
const MAX_OPTION_CHARS = 200;
const MAX_EXPLANATION_CHARS = 500;
const OPTIONS_PER_QUESTION = 4;
const MIN_QUESTIONS = 2;

/** Only these keys are permitted on a question object. */
const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "text",
  "options",
  "correctIndex",
  "explanation",
]);

/** Keys that indicate prototype-pollution attempts — always rejected. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function fail(error: string): QuizValidationResult {
  return { ok: false, error };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate raw (model-produced) JSON into a clean list of questions.
 *
 * @param raw           Parsed JSON of unknown shape (expected: array).
 * @param maxQuestions  Upper bound on the number of questions (≥2 enforced).
 */
export function validateGeneratedQuiz(
  raw: unknown,
  maxQuestions: number
): QuizValidationResult {
  const max = Math.max(
    MIN_QUESTIONS,
    Number.isFinite(maxQuestions) ? Math.floor(maxQuestions) : MIN_QUESTIONS
  );

  if (!Array.isArray(raw)) {
    return fail("Expected a JSON array of questions.");
  }
  if (raw.length < MIN_QUESTIONS) {
    return fail(`Expected at least ${MIN_QUESTIONS} questions, got ${raw.length}.`);
  }
  if (raw.length > max) {
    return fail(`Expected at most ${max} questions, got ${raw.length}.`);
  }

  const questions: GeneratedQuestion[] = [];

  for (let i = 0; i < raw.length; i++) {
    const label = `Question ${i + 1}`;
    const item = raw[i];

    if (!isPlainObject(item)) {
      return fail(`${label}: not an object.`);
    }

    // Only known keys allowed — also blocks __proto__/constructor tricks.
    // getOwnPropertyNames catches JSON-parsed "__proto__" own-properties
    // that Object.keys would also list, plus non-enumerable oddities.
    for (const key of Object.getOwnPropertyNames(item)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return fail(`${label}: forbidden key "${key}".`);
      }
      if (!ALLOWED_KEYS.has(key)) {
        return fail(`${label}: unexpected key "${key}".`);
      }
    }

    // text
    const rawText = item.text;
    if (typeof rawText !== "string") {
      return fail(`${label}: "text" must be a string.`);
    }
    const text = rawText.trim();
    if (text.length === 0) {
      return fail(`${label}: "text" must not be empty.`);
    }
    if (text.length > MAX_TEXT_CHARS) {
      return fail(`${label}: "text" exceeds ${MAX_TEXT_CHARS} characters.`);
    }

    // options
    const rawOptions = item.options;
    if (!Array.isArray(rawOptions) || rawOptions.length !== OPTIONS_PER_QUESTION) {
      return fail(`${label}: "options" must be an array of exactly ${OPTIONS_PER_QUESTION} strings.`);
    }
    const options: string[] = [];
    const seen = new Set<string>();
    for (let j = 0; j < rawOptions.length; j++) {
      const rawOpt = rawOptions[j];
      if (typeof rawOpt !== "string") {
        return fail(`${label}, option ${j + 1}: must be a string.`);
      }
      const opt = rawOpt.trim();
      if (opt.length === 0) {
        return fail(`${label}, option ${j + 1}: must not be empty.`);
      }
      if (opt.length > MAX_OPTION_CHARS) {
        return fail(`${label}, option ${j + 1}: exceeds ${MAX_OPTION_CHARS} characters.`);
      }
      const dedupeKey = opt.toLowerCase();
      if (seen.has(dedupeKey)) {
        return fail(`${label}: duplicate option "${opt}".`);
      }
      seen.add(dedupeKey);
      options.push(opt);
    }

    // correctIndex
    const correctIndex = item.correctIndex;
    if (
      typeof correctIndex !== "number" ||
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex >= OPTIONS_PER_QUESTION
    ) {
      return fail(`${label}: "correctIndex" must be an integer between 0 and ${OPTIONS_PER_QUESTION - 1}.`);
    }

    // explanation (optional)
    let explanation: string | undefined;
    if (item.explanation !== undefined) {
      if (typeof item.explanation !== "string") {
        return fail(`${label}: "explanation" must be a string when present.`);
      }
      const trimmed = item.explanation.trim();
      if (trimmed.length > MAX_EXPLANATION_CHARS) {
        return fail(`${label}: "explanation" exceeds ${MAX_EXPLANATION_CHARS} characters.`);
      }
      if (trimmed.length > 0) explanation = trimmed;
    }

    // Rebuild onto a fresh object — nothing else carries through.
    questions.push(
      explanation !== undefined
        ? { text, options, correctIndex, explanation }
        : { text, options, correctIndex }
    );
  }

  return { ok: true, questions };
}
