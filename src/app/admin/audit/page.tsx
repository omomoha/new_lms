"use client";

/**
 * Audit Log — Admin
 *
 * Read-only viewer for the append-only `auditLogs` collection. Entries are
 * written client-side via logAdminAction() after successful admin mutations,
 * and server-side by Cloud Functions (e.g. bulkOnboard). Firestore rules
 * deny all updates/deletes, so what you see here is tamper-evident history.
 *
 * Pagination: orderBy("at","desc") limit 100 with a startAfter cursor
 * ("Load more" button) — single-field index only, no composite needed.
 */

import { useEffect, useState, useCallback } from "react";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import type { AuditLogDoc } from "@/lib/audit";
import AdminShell from "@/components/layout/AdminShell";
import { Spinner } from "@/components/ui/Spinner";

const PAGE_SIZE = 100;

interface AuditRow extends AuditLogDoc {
  id: string;
}

function formatAt(at: AuditLogDoc["at"]): string {
  if (!at || typeof at.toDate !== "function") return "—";
  return at.toDate().toLocaleString();
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] =
    useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (after: QueryDocumentSnapshot<DocumentData> | null) => {
      const q = after
        ? query(
            collection(db, "auditLogs"),
            orderBy("at", "desc"),
            startAfter(after),
            limit(PAGE_SIZE)
          )
        : query(
            collection(db, "auditLogs"),
            orderBy("at", "desc"),
            limit(PAGE_SIZE)
          );
      const snap = await getDocs(q);
      const pageRows: AuditRow[] = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as AuditLogDoc),
      }));
      setCursor(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : after);
      setHasMore(snap.docs.length === PAGE_SIZE);
      return pageRows;
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const first = await fetchPage(null);
        if (!cancelled) setRows(first);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load audit log"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const next = await fetchPage(cursor);
      setRows((prev) => [...prev, ...next]);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load more entries"
      );
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <AdminShell>
      {/* Page hero band */}
      <div className="page-hero mb-6">
        <span className="kicker">ADMIN · AUDIT LOG</span>
        <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
          Audit log
        </h1>
        <p className="mt-1 text-sm text-brand-mist">
          Records administrative actions. Entries cannot be edited or deleted.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-brand-muted">
          <div className="mx-auto w-8 h-8 rounded-sm rotate-45 mb-4 bg-brand-accent" />
          <p>No audit entries yet. Admin actions will appear here.</p>
        </div>
      ) : (
        <>
          <div className="card !p-0 overflow-hidden">
            <ul className="divide-y divide-brand-line">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="px-4 sm:px-5 py-3 flex flex-col gap-1"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-xs tabular-nums text-brand-muted whitespace-nowrap">
                      {formatAt(row.at)}
                    </span>
                    <span className="text-xs font-medium text-brand-ink truncate max-w-[220px]">
                      {row.actorEmail || row.actorUid || "unknown actor"}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-xs font-mono font-semibold bg-brand-mint text-brand-primary">
                      {row.action}
                    </span>
                  </div>
                  <p className="text-sm text-brand-ink break-words">
                    {row.details || "—"}
                  </p>
                  {row.targetId && (
                    <p className="text-xs text-brand-muted font-mono truncate">
                      {row.targetType}: {row.targetId}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="btn-secondary text-sm"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}
