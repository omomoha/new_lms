/**
 * CSV parsing and validation for bulk onboarding.
 * Pure functions — no side effects — so they're easy to unit-test.
 */

import Papa from "papaparse";
import type { OnboardingRow } from "@/types";

export interface ParseResult {
  valid: OnboardingRow[];
  errors: Array<{ row: number; message: string }>;
}

const REQUIRED_COLUMNS = ["name", "email", "role", "cohort_tag"] as const;
const VALID_ROLES = new Set(["admin", "learner"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Parse a CSV File/string into validated OnboardingRow[].
 * Returns both valid rows and per-row errors.
 */
/** CSV template offered for download on the onboarding page. */
export const TEMPLATE_CSV =
  "name,email,role,cohort_tag\n" +
  "Ada Lovelace,ada@example.com,learner,q3-2026\n" +
  "Grace Hopper,grace@example.com,learner,q3-2026\n";

/**
 * Normalize a header cell: strip BOM, trim, lowercase, and convert
 * spaces/dashes to underscores so "Cohort Tag" or "cohort-tag" → "cohort_tag".
 * Makes Excel/Sheets exports work without hand-editing headers.
 */
function normalizeHeader(h: string): string {
  return h
    .replace(/^﻿/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Parse an uploaded file — .csv, .xlsx or .xls — into validated rows.
 * Excel files are converted to CSV via SheetJS (first sheet), then run
 * through the same validation path.
 */
export async function parseOnboardingFile(file: File): Promise<ParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "xlsx" || ext === "xls") {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – xlsx is in package.json but types aren't installed in sandbox
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    if (!firstSheet) {
      return { valid: [], errors: [{ row: 0, message: "Workbook has no sheets" }] };
    }
    const csv = XLSX.utils.sheet_to_csv(firstSheet);
    return parseOnboardingCsv(csv);
  }
  return parseOnboardingCsv(file);
}

export function parseOnboardingCsv(input: string | File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(input as string, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete: (results) => {
        const valid: OnboardingRow[] = [];
        const errors: Array<{ row: number; message: string }> = [];

        // Check required headers exist
        const headers = results.meta.fields ?? [];
        const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
        if (missing.length > 0) {
          errors.push({
            row: 0,
            message: `Missing required columns: ${missing.join(", ")}`,
          });
          return resolve({ valid, errors });
        }

        results.data.forEach((raw, idx) => {
          const rowNum = idx + 2; // 1-indexed + header row
          const rowErrors: string[] = [];

          const name = raw.name?.trim();
          const email = raw.email?.trim().toLowerCase();
          const role = raw.role?.trim().toLowerCase();
          const cohort_tag = raw.cohort_tag?.trim();

          if (!name) rowErrors.push("name is required");
          if (!email || !EMAIL_RE.test(email)) rowErrors.push("invalid email");
          if (!role || !VALID_ROLES.has(role))
            rowErrors.push(`role must be 'admin' or 'learner', got '${role}'`);
          if (!cohort_tag) rowErrors.push("cohort_tag is required");

          if (rowErrors.length > 0) {
            errors.push({ row: rowNum, message: rowErrors.join("; ") });
          } else {
            valid.push({
              name,
              email,
              role: role as OnboardingRow["role"],
              cohort_tag,
            });
          }
        });

        resolve({ valid, errors });
      },
      error: (err: Error) => {
        resolve({
          valid: [],
          errors: [{ row: 0, message: `Parse error: ${err.message}` }],
        });
      },
    });
  });
}
