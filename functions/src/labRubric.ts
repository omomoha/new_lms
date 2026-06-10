/**
 * labRubric — pure validation of AI-produced lab grades.
 *
 * The model returns JSON; we NEVER trust its shape. validateLabGrade() is the
 * single gate between model output and anything stored in Firestore or
 * returned to a client. It is intentionally pure (no firebase imports) so it
 * can be unit-tested in isolation and reused anywhere.
 *
 * Accepted shape (only these keys, nothing else):
 *   {
 *     score:        integer 0–100
 *     summary:      non-empty string ≤ 800 chars
 *     strengths:    1–5 non-empty strings, each ≤ 300 chars
 *     improvements: 1–5 non-empty strings, each ≤ 300 chars
 *   }
 */

export interface LabGrade {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
}

export type LabGradeValidation =
  | { ok: true; grade: LabGrade }
  | { ok: false; error: string };

const KNOWN_KEYS = ["score", "summary", "strengths", "improvements"] as const;

const MAX_SUMMARY_CHARS = 800;
const MAX_ITEM_CHARS = 300;
const MIN_ITEMS = 1;
const MAX_ITEMS = 5;

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function validateStringList(
  value: unknown,
  field: string
): { ok: true; items: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return fail(`${field} must be an array of strings.`);
  }
  if (value.length < MIN_ITEMS || value.length > MAX_ITEMS) {
    return fail(`${field} must contain between ${MIN_ITEMS} and ${MAX_ITEMS} items.`);
  }
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return fail(`${field} items must be non-empty strings.`);
    }
    if (entry.length > MAX_ITEM_CHARS) {
      return fail(`${field} items must be at most ${MAX_ITEM_CHARS} characters.`);
    }
    items.push(entry.trim());
  }
  return { ok: true, items };
}

/** Validate raw (model-produced) JSON into a LabGrade, or explain why not. */
export function validateLabGrade(raw: unknown): LabGradeValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Grade must be a JSON object.");
  }

  const obj = raw as Record<string, unknown>;

  // Reject unknown keys — the model must not smuggle extra fields into storage.
  for (const key of Object.keys(obj)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      return fail(`Unknown key "${key}" in grade object.`);
    }
  }

  const { score, summary } = obj;

  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100
  ) {
    return fail("score must be an integer between 0 and 100.");
  }

  if (typeof summary !== "string" || summary.trim().length === 0) {
    return fail("summary must be a non-empty string.");
  }
  if (summary.length > MAX_SUMMARY_CHARS) {
    return fail(`summary must be at most ${MAX_SUMMARY_CHARS} characters.`);
  }

  const strengths = validateStringList(obj.strengths, "strengths");
  if (!strengths.ok) return strengths;

  const improvements = validateStringList(obj.improvements, "improvements");
  if (!improvements.ok) return improvements;

  return {
    ok: true,
    grade: {
      score,
      summary: summary.trim(),
      strengths: strengths.items,
      improvements: improvements.items,
    },
  };
}
