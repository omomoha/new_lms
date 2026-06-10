"use client";

/**
 * DownloadCsvButton — shared admin "Export CSV" button.
 *
 * Builds the CSV lazily on click via the pure csvExport helpers (RFC-4180
 * quoting, formula-injection guard, BOM, CRLF) and triggers a client-side
 * download. Disabled while data is loading or when there are no rows, with a
 * title explaining why.
 */

import { useCallback } from "react";
import { toCsv, downloadCsv, type CsvField } from "@/lib/csvExport";

interface DownloadCsvButtonProps {
  /** Target filename, e.g. `roster-2026-06-10.csv`. */
  filename: string;
  /** Column headers, in order. */
  headers: string[];
  /** Data rows matching the header order. */
  rows: CsvField[][];
  /** Disable + explain while the page is still fetching. */
  loading?: boolean;
  /** Title shown when there is nothing to export. */
  emptyReason?: string;
  /** Extra utility classes (size/spacing tweaks). */
  className?: string;
}

export default function DownloadCsvButton({
  filename,
  headers,
  rows,
  loading = false,
  emptyReason = "Nothing to export — no rows match the current view.",
  className = "",
}: DownloadCsvButtonProps) {
  const isEmpty = rows.length === 0;
  const disabled = loading || isEmpty;

  const title = loading
    ? "Export unavailable while data is loading."
    : isEmpty
      ? emptyReason
      : `Download ${filename}`;

  const handleClick = useCallback(() => {
    downloadCsv(filename, toCsv(headers, rows));
  }, [filename, headers, rows]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      aria-label={`Export CSV — ${filename}`}
      className={`btn-secondary text-xs flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <span aria-hidden="true">↓</span>
      Export CSV
    </button>
  );
}
