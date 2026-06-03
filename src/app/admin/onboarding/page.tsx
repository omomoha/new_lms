"use client";

/**
 * Bulk Onboarding page.
 * Upload a CSV with columns: name, email, role, cohort_tag
 * Calls the bulkOnboard Cloud Function and shows per-row results.
 */

import { useState, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import { parseOnboardingCsv } from "@/lib/csvParser";
import type { OnboardingResult } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";

export default function OnboardingPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parseErrors, setParseErrors] = useState<Array<{ row: number; message: string }>>([]);
  const [results, setResults] = useState<OnboardingResult[] | null>(null);
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResults(null);
    setCallError(null);

    // Pre-validate client-side so user sees errors before hitting the function
    const text = await f.text();
    const { errors } = await parseOnboardingCsv(text);
    setParseErrors(errors);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setCalling(true); setCallError(null); setResults(null);

    try {
      const text = await file.text();
      const { valid, errors } = await parseOnboardingCsv(text);
      setParseErrors(errors);
      if (valid.length === 0) { setCalling(false); return; }

      const fn = httpsCallable<{ rows: typeof valid }, { results: OnboardingResult[] }>(
        functions,
        "bulkOnboard"
      );
      const res = await fn({ rows: valid });
      setResults(res.data.results);
    } catch (err: unknown) {
      setCallError(err instanceof Error ? err.message : "Function call failed");
    } finally {
      setCalling(false);
    }
  };

  const successCount = results?.filter((r) => r.success).length ?? 0;
  const failCount = results?.filter((r) => !r.success).length ?? 0;

  return (
    <AdminShell>
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Bulk Onboard Users</h1>
        <p className="text-sm text-gray-500 mb-6">
          Upload a CSV file with columns: <code className="bg-gray-100 px-1 rounded">name, email, role, cohort_tag</code>.
          The system will create Firebase Auth accounts, set role custom claims, and write
          Firestore user docs. Temporary passwords are emailed via the Trigger Email extension.
        </p>

        <div className="card mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CSV File
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="btn-secondary text-sm"
                >
                  Choose CSV
                </button>
                {file && (
                  <span className="text-sm text-gray-600 truncate max-w-xs">{file.name}</span>
                )}
              </div>
            </div>

            {/* Template download hint */}
            <p className="text-xs text-gray-400">
              Required columns: <strong>name</strong>, <strong>email</strong>,{" "}
              <strong>role</strong> (admin|learner), <strong>cohort_tag</strong>
            </p>

            {/* Parse errors */}
            {parseErrors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                <p className="font-medium text-red-700 mb-1">Validation errors:</p>
                <ul className="space-y-0.5">
                  {parseErrors.map((e, i) => (
                    <li key={i} className="text-red-600">
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {callError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                {callError}
              </div>
            )}

            <button
              type="submit"
              disabled={!file || calling || parseErrors.length > 0}
              className="btn-primary"
            >
              {calling ? (
                <span className="flex items-center gap-2">
                  <Spinner className="w-4 h-4" /> Onboarding…
                </span>
              ) : (
                "Run Onboarding"
              )}
            </button>
          </form>
        </div>

        {/* Results */}
        {results && (
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="font-medium">Results</h2>
              <Badge label={`${successCount} created`} variant="success" />
              {failCount > 0 && <Badge label={`${failCount} failed`} variant="error" />}
            </div>
            <div className="space-y-2">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 p-2.5 rounded-lg text-sm ${
                    r.success ? "bg-green-50" : "bg-red-50"
                  }`}
                >
                  <span className="text-base">{r.success ? "✓" : "✗"}</span>
                  <div>
                    <p className="font-medium text-gray-900">{r.email}</p>
                    {r.success && r.uid && (
                      <p className="text-xs text-gray-500">UID: {r.uid}</p>
                    )}
                    {!r.success && r.error && (
                      <p className="text-xs text-red-600">{r.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
