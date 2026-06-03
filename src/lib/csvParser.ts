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
export function parseOnboardingCsv(input: string | File): Promise<ParseResult> {
  return new Promise((resolve) => {
    Papa.parse<Record<string, string>>(input as string, {
      header: true,
      skipEmptyLines: true,
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
