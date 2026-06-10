"use client";

/**
 * StreakCard — compact learner-dashboard card showing the daily lesson streak
 * and weekly goal progress.
 *
 * Reads ALL of the learner's `progress` docs with a single
 * where("userId","==",uid) filter (index-free), maps completedAt timestamps
 * to Dates, and feeds them through the pure computeStreaks() helper.
 *
 * Loading and error states render nothing — the card appears quietly once
 * data is ready and never breaks the page.
 */

import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { computeStreaks, type StreakStats } from "@/lib/streaks";

interface StreakCardProps {
  uid: string;
}

export default function StreakCard({ uid }: StreakCardProps) {
  const [stats, setStats] = useState<StreakStats | null>(null);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "progress"), where("userId", "==", uid))
        );
        const dates: Date[] = [];
        snap.forEach((d) => {
          const completedAt = (d.data() as { completedAt?: Timestamp | null })
            .completedAt;
          if (completedAt instanceof Timestamp) {
            dates.push(completedAt.toDate());
          }
        });
        if (!cancelled) setStats(computeStreaks(dates, new Date()));
      } catch {
        // Quietly render nothing on error.
        if (!cancelled) setStats(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uid]);

  // Loading or error → render nothing.
  if (!stats) return null;

  const { currentStreak, longestStreak, activeToday, thisWeekCount, weeklyGoal } =
    stats;
  const weekPct = Math.min(100, Math.round((thisWeekCount / weeklyGoal) * 100));

  return (
    <div className="card flex items-center gap-4">
      {/* Flame inside a diamond motif */}
      <div className="relative h-12 w-12 flex-shrink-0" aria-hidden="true">
        <div
          className={`absolute inset-1 rotate-45 rounded-md border ${
            currentStreak > 0
              ? "bg-brand-mint border-brand-accent"
              : "bg-brand-mint border-brand-line"
          }`}
        />
        <svg
          viewBox="0 0 24 24"
          className={`absolute inset-0 m-auto h-6 w-6 ${
            currentStreak > 0 ? "text-brand-accent" : "text-brand-muted"
          }`}
          fill="currentColor"
        >
          <path d="M12 2c.6 2.8-.4 4.6-1.9 6.2C8.6 9.8 7 11.4 7 14a5 5 0 0 0 10 0c0-1.2-.4-2.2-1-3.1-.3 1-.9 1.8-1.8 2.3.3-2.7-.6-5.4-2.2-7.4A10.7 10.7 0 0 0 12 2z" />
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        {currentStreak > 0 ? (
          <p className="text-sm font-semibold text-brand-primary">
            {currentStreak}-day streak
            {!activeToday && (
              <span className="ml-1.5 text-xs font-normal text-brand-muted">
                — finish a lesson today to keep it going
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm font-semibold text-brand-primary">
            Start a streak today
            <span className="ml-1.5 text-xs font-normal text-brand-muted">
              — one lesson is all it takes
            </span>
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-mint"
            role="progressbar"
            aria-valuenow={thisWeekCount}
            aria-valuemin={0}
            aria-valuemax={weeklyGoal}
            aria-label="Lessons completed this week"
          >
            <div
              className="h-full rounded-full bg-brand-accent transition-all"
              style={{ width: `${weekPct}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-xs text-brand-muted">
            {thisWeekCount}/{weeklyGoal} lessons this week
          </span>
        </div>

        {longestStreak > currentStreak && (
          <p className="mt-1 text-xs text-brand-muted">
            Best: {longestStreak} day{longestStreak === 1 ? "" : "s"}
          </p>
        )}
      </div>
    </div>
  );
}
