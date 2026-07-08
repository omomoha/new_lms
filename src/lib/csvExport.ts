/**
 * CSV export utilities — pure functions, browser-safe, NO firebase imports.
 *
 * Security & compatibility guarantees:
 *  - RFC-4180 quoting: fields containing a comma, double quote, CR or LF are
 *    wrapped in double quotes; internal double quotes are doubled.
 *  - CRLF (\r\n) line endings per RFC 4180.
 *  - UTF-8 BOM prefix so Excel detects the encoding correctly.
 *  - CSV-injection guard: any STRING field starting with `=`, `+`, `-`, `@`,
 *    TAB or CR is prefixed with a single quote (') so spreadsheet apps do not
 *    execute formulas sourced from learner-controlled values (names, emails…).
 *    Numeric fields are app-computed (never learner-controlled) and are
 *    serialised verbatim so negative numbers stay machine-readable.
 */

export type CsvField = string | number | null | undefined;

/** UTF-8 byte-order mark — makes Excel open the file as UTF-8. */
export const CSV_BOM = "\uFEFF";

/** Leading characters that can trigger formula execution in spreadsheet apps. */
const FORMULA_LEADING = /^[=+\-@\t\r]/;

/** Characters that force RFC-4180 quoting. */
const NEEDS_QUOTING = /[",\r\n]/;

/**
 * Serialise a single field:
 *  1. null/undefined → empty string.
 *  2. Numbers are stringified verbatim (trusted, app-computed values).
 *  3. Strings beginning with a dangerous character get a `'` prefix
 *     (formula-injection guard).
 *  4. RFC-4180 quoting is applied last so the guard prefix survives intact.
 */
export function sanitizeCsvField(value: CsvField): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);

  let field = value;
  if (FORMULA_LEADING.test(field)) {
    field = `'${field}`;
  }
  if (NEEDS_QUOTING.test(field)) {
    field = `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Build a complete CSV document (BOM + header line + data lines, CRLF-joined,
 * with a trailing CRLF as permitted by RFC 4180).
 */
export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>
): string {
  const lines = [headers as CsvField[], ...rows].map((row) =>
    row.map(sanitizeCsvField).join(",")
  );
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

// ─── Analytics dataset builders (Phase 4 — Workstream D) ──────────────────────
// Pure {headers, rows} builders for the analytics dashboard exports. Browser-
// safe (no firebase). Numbers are app-computed so they serialise verbatim; only
// the string fields (titles, names) go through the formula-injection guard in
// sanitizeCsvField. Unit-tested in tests/csvExport.test.ts.

export interface CsvTable {
  headers: string[];
  rows: CsvField[][];
}

/** Minimal shapes — kept local so this module stays firebase-free. */
interface CourseRow {
  title: string;
  enrolled: number;
  started: number;
  completed: number;
  completionPct: number;
  avgProgress: number;
  quizPassRate: number;
  quizAttempts: number;
}
interface CohortRow {
  name: string;
  enrolled: number;
  completed: number;
  completionPct: number;
  avgProgress: number;
  dau: number;
  wau: number;
  atRiskCount: number;
}
interface AtRiskRow {
  userId: string;
  courseTitle: string;
  cohortName: string | null;
  progressPct: number;
  reasons: string[];
}

/** Per-course completion + quiz table. */
export function buildCourseAnalyticsCsv(courses: CourseRow[]): CsvTable {
  return {
    headers: [
      "Course",
      "Enrolled",
      "Started",
      "Completed",
      "Completion %",
      "Avg progress %",
      "Quiz pass rate %",
      "Quiz attempts",
    ],
    rows: courses.map((c) => [
      c.title,
      c.enrolled,
      c.started,
      c.completed,
      c.completionPct,
      c.avgProgress,
      c.quizPassRate,
      c.quizAttempts,
    ]),
  };
}

/** Per-cohort comparison table. */
export function buildCohortAnalyticsCsv(cohorts: CohortRow[]): CsvTable {
  return {
    headers: [
      "Cohort",
      "Enrolled",
      "Completed",
      "Completion %",
      "Avg progress %",
      "DAU",
      "WAU",
      "At-risk learners",
    ],
    rows: cohorts.map((c) => [
      c.name,
      c.enrolled,
      c.completed,
      c.completionPct,
      c.avgProgress,
      c.dau,
      c.wau,
      c.atRiskCount,
    ]),
  };
}

/** At-risk learners table — reasons joined with a semicolon. */
export function buildAtRiskCsv(learners: AtRiskRow[]): CsvTable {
  return {
    headers: ["Learner UID", "Course", "Cohort", "Progress %", "Reasons"],
    rows: learners.map((l) => [
      l.userId,
      l.courseTitle,
      l.cohortName ?? "—",
      l.progressPct,
      l.reasons.join("; "),
    ]),
  };
}

/**
 * Trigger a client-side download of a CSV string via a Blob + anchor click.
 * No-op outside the browser (SSR-safe).
 */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
