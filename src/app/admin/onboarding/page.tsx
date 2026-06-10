"use client";

/**
 * Bulk Onboarding page.
 * Upload a CSV with columns: name, email, role, cohort_tag
 * Calls the bulkOnboard Cloud Function and shows per-row results.
 */

import { useState, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import { parseOnboardingFile, TEMPLATE_CSV } from "@/lib/csvParser";
import { logAdminAction } from "@/lib/audit";
import { useAuth } from "@/contexts/AuthContext";
import type { OnboardingResult } from "@/types";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";

// The Cloud Function returns a per-row `status`; the legacy client type only
// declares `success`. Accept both shapes when summarizing for the audit log.
type RowOutcome = OnboardingResult & { status?: "created" | "skipped" | "error" };

export default function OnboardingPage() {
  const { user } = useAuth();
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
    const { errors } = await parseOnboardingFile(f);
    setParseErrors(errors);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setCalling(true); setCallError(null); setResults(null);

    try {
      const { valid, errors } = await parseOnboardingFile(file);
      setParseErrors(errors);
      if (valid.length === 0) { setCalling(false); return; }

      const fn = httpsCallable<{ rows: typeof valid }, { results: OnboardingResult[] }>(
        functions,
        "bulkOnboard"
      );
      const res = await fn({ rows: valid });
      setResults(res.data.results);

      // Best-effort audit trail — never blocks or fails the UI
      if (user) {
        const outcomes = res.data.results as RowOutcome[];
        const created = outcomes.filter(
          (r) => r.status === "created" || (r.status === undefined && r.success)
        ).length;
        const skipped = outcomes.filter((r) => r.status === "skipped").length;
        const errored = outcomes.filter(
          (r) => r.status === "error" || (r.status === undefined && !r.success)
        ).length;
        void logAdminAction(
          { uid: user.uid, email: user.email },
          {
            // "upload" (client, includes the filename) complements the
            // server-written "onboarding.run" entry from bulkOnboard.
            action: "onboarding.upload",
            targetType: "onboarding",
            targetId: "",
            details: `Onboarded ${valid.length} row(s) from "${file.name}" (${created} created, ${skipped} skipped, ${errored} error(s))`,
          }
        );
      }
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
        {/* Page hero band */}
        <div className="page-hero mb-6">
          <span className="kicker">ADMIN · ONBOARDING</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Bulk Onboard Users
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Upload a CSV with <code className="font-mono">name, email, role, cohort_tag</code> to create accounts and assign cohorts.
          </p>
        </div>

        <div className="card mb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1 text-brand-ink">
                CSV / XLSX File
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="btn-secondary text-sm"
                >
                  Choose file (CSV / XLSX / XLS)
                </button>
                {file && (
                  <span className="text-sm text-gray-600 truncate max-w-xs">{file.name}</span>
                )}
              </div>
            </div>

            {/* Template download */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs text-brand-muted">
                Required columns: <strong>name</strong>, <strong>email</strong>,{" "}
                <strong>role</strong> (admin|learner), <strong>cohort_tag</strong>.
                Header capitalization and spaces are tolerated.
              </p>
              <button
                type="button"
                className="text-xs font-semibold hover:underline text-brand-accent"
                onClick={() => {
                  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "onboarding-template.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                ⬇ Download template
              </button>
            </div>

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
