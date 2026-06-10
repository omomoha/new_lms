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
