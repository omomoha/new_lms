"use client";

/**
 * NotificationsBell — header bell with unread badge + dropdown panel.
 *
 * Subscribes (onSnapshot) to the learner's docs in the `notifications`
 * collection. Deliberately queries with a single equality filter and NO
 * orderBy — that avoids needing a composite index; sorting (createdAt desc)
 * and the latest-20 cap happen client-side.
 *
 * Doc shape (server-created via Admin SDK; learner may only set readAt):
 *   { userId, title, body, link, readAt: null | Timestamp, createdAt }
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: Timestamp | null;
  createdAt: Timestamp | null;
}

/** Tiny relative-time helper: "just now", "5m ago", "2h ago", "3d ago". */
function timeAgo(ts: Timestamp | null): string {
  if (!ts) return "just now";
  const seconds = Math.max(0, Math.floor((Date.now() - ts.toMillis()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export default function NotificationsBell({ uid }: { uid: string }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Live subscription — single equality filter, no orderBy (no composite index).
  useEffect(() => {
    const q = query(collection(db, "notifications"), where("userId", "==", uid));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const next: NotificationItem[] = snap.docs.map((d) => {
          const data = d.data() as {
            title?: string;
            body?: string;
            link?: string;
            readAt?: Timestamp | null;
            createdAt?: Timestamp | null;
          };
          return {
            id: d.id,
            title: data.title ?? "",
            body: data.body ?? "",
            link: data.link ?? "",
            readAt: data.readAt instanceof Timestamp ? data.readAt : null,
            createdAt: data.createdAt instanceof Timestamp ? data.createdAt : null,
          };
        });
        // Sort newest first client-side; pending serverTimestamps (null) float top.
        next.sort(
          (a, b) =>
            (b.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER) -
            (a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER)
        );
        setItems(next.slice(0, 20));
      },
      (err) => console.error("NotificationsBell: snapshot failed:", err)
    );
    return unsubscribe;
  }, [uid]);

  // Close on Escape and on outside click.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const unread = useMemo(() => items.filter((n) => !n.readAt), [items]);
  const unreadCount = unread.length;

  const markRead = (id: string) => {
    // Learner-side write limited to readAt (matches security rules).
    updateDoc(doc(db, "notifications", id), { readAt: serverTimestamp() }).catch(
      (err) => console.error("NotificationsBell: mark read failed:", err)
    );
  };

  const markAllRead = () => {
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((n) =>
      batch.update(doc(db, "notifications", n.id), { readAt: serverTimestamp() })
    );
    batch
      .commit()
      .catch((err) => console.error("NotificationsBell: mark all read failed:", err));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Notifications, ${unreadCount} unread`}
        className="relative flex items-center justify-center w-8 h-8 text-white/70 hover:text-white transition-colors"
      >
        {/* Bell icon */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-5 h-5"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-brand-accent text-brand-primary text-[10px] font-bold leading-none"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-white rounded-xl shadow-lg border border-brand-line z-50">
          <div className="flex items-center justify-between px-4 py-2 border-b border-brand-line sticky top-0 bg-white rounded-t-xl">
            <span className="text-sm font-medium text-brand-ink">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs text-brand-teal hover:text-brand-primary transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-brand-muted text-center">
              You&apos;re all caught up
            </p>
          ) : (
            <ul>
              {items.map((n) => {
                const inner = (
                  <span className="flex items-start gap-2">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        n.readAt ? "bg-transparent" : "bg-brand-accent"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-brand-ink">{n.title}</span>
                      <span className="block text-sm text-brand-muted">{n.body}</span>
                      <span className="block text-xs text-brand-muted/80 mt-0.5">
                        {timeAgo(n.createdAt)}
                      </span>
                    </span>
                  </span>
                );
                return (
                  <li key={n.id} className="border-b border-brand-line last:border-b-0">
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => {
                          if (!n.readAt) markRead(n.id);
                          setOpen(false);
                        }}
                        className="block px-4 py-3 hover:bg-brand-mint/50 transition-colors"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (!n.readAt) markRead(n.id);
                        }}
                        className="block w-full text-left px-4 py-3 hover:bg-brand-mint/50 transition-colors"
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
