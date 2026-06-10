"use client";

/**
 * Achievements — the gamification hub: XP + level, badge grid (earned and
 * locked-with-progress), streaks, and the cohort leaderboard.
 *
 * Everything personal is DERIVED client-side from data the learner can
 * already read (progress, passed attempts, certificates). The leaderboard is
 * aggregated server-side (getCohortLeaderboard) because learners cannot read
 * each other's records directly.
 */

import { useCallback, useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import db from "@/lib/firebase/firestore";
import functions from "@/lib/firebase/functions";
import { useAuth } from "@/contexts/AuthContext";
import LearnerShell from "@/components/layout/LearnerShell";
import { Spinner } from "@/components/ui/Spinner";
import { computeStreaks } from "@/lib/streaks";
import {
  BADGES,
  computeXp,
  levelFor,
  type GamificationStats,
} from "@/lib/gamification";

interface LeaderboardRow {
  name: string;
  xp: number;
  lessonsCompleted: number;
  certificates: number;
  isYou: boolean;
}

interface LeaderboardResponse {
  cohortName: string;
  rows: LeaderboardRow[];
  truncated: boolean;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function AchievementsPage() {
  const { appUser } = useAuth();

  const [stats, setStats] = useState<GamificationStats | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [boardCohort, setBoardCohort] = useState<string | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  // ── Personal stats (derived from own data) ──────────────────────────────
  useEffect(() => {
    if (!appUser) return;
    (async () => {
      try {
        const [progressSnap, passedSnap, certsSnap] = await Promise.all([
          getDocs(query(collection(db, "progress"), where("userId", "==", appUser.uid))),
          getDocs(
            query(
              collection(db, "attempts"),
              where("userId", "==", appUser.uid),
              where("passed", "==", true)
            )
          ),
          getDocs(query(collection(db, "certificates"), where("userId", "==", appUser.uid))),
        ]);
        const completionDates = progressSnap.docs
          .map((d) => d.data().completedAt?.toDate?.())
          .filter((d): d is Date => d instanceof Date);
        const streak = computeStreaks(completionDates, new Date());
        setStats({
          lessonsCompleted: completionDates.length,
          quizzesPassed: passedSnap.size,
          certificates: certsSnap.size,
          streakDays: streak.currentStreak,
        });
      } catch (err: unknown) {
        console.error("Achievements load failed:", err);
        setLoadError(err instanceof Error ? err.message : "Failed to load achievements");
      }
    })();
  }, [appUser]);

  // ── Leaderboard (server-aggregated per cohort) ──────────────────────────
  const loadBoard = useCallback(async (cohortId: string) => {
    setBoardLoading(true);
    setBoardError(null);
    try {
      const fn = httpsCallable<{ cohortId: string }, LeaderboardResponse>(
        functions,
        "getCohortLeaderboard",
        { timeout: 120000 }
      );
      const res = await fn({ cohortId });
      setBoard(res.data);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      setBoardError(
        code.includes("resource-exhausted")
          ? "Leaderboard refreshed too often — try again in a little while."
          : "Could not load the leaderboard. Please try again."
      );
    } finally {
      setBoardLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = appUser?.cohortIds?.[0];
    if (first) {
      setBoardCohort(first);
      void loadBoard(first);
    }
  }, [appUser, loadBoard]);

  const xp = stats ? computeXp(stats) : 0;
  const level = levelFor(xp);

  return (
    <LearnerShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="page-hero mb-6">
          <span className="kicker">MY LEARNING · GAMIFICATION</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Achievements
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Earn XP for every lesson, assessment and certificate. Keep the streak alive.
          </p>
        </div>

        {loadError && (
          <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {loadError}
          </div>
        )}

        {!stats ? (
          <div className="flex justify-center py-20"><Spinner /></div>
        ) : (
          <>
            {/* ── Level + XP ───────────────────────────────────────────── */}
            <div className="card mb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-brand-primary text-brand-mint font-serif-brand text-xl">
                    {level.level}
                  </span>
                  <div>
                    <p className="font-semibold text-brand-ink">Level {level.level}</p>
                    <p className="text-xs text-brand-muted">{xp.toLocaleString()} XP total</p>
                  </div>
                </div>
                <div className="flex gap-5 text-center text-xs text-brand-muted">
                  <span><b className="block text-base text-brand-ink">{stats.lessonsCompleted}</b>lessons</span>
                  <span><b className="block text-base text-brand-ink">{stats.quizzesPassed}</b>passed</span>
                  <span><b className="block text-base text-brand-ink">{stats.certificates}</b>certs</span>
                  <span><b className="block text-base text-brand-ink">{stats.streakDays}</b>day streak</span>
                </div>
              </div>
              <div
                className="h-2 rounded-full bg-brand-mint overflow-hidden"
                role="progressbar"
                aria-valuenow={level.pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Level ${level.level} progress`}
              >
                <div className="h-full bg-brand-accent rounded-full transition-all" style={{ width: `${level.pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-brand-muted">
                {level.needed > 0
                  ? `${level.needed.toLocaleString()} XP to level ${level.level + 1}`
                  : "Max level reached — you’ve outgrown the chart 🎉"}
              </p>
            </div>

            {/* ── Badges ──────────────────────────────────────────────── */}
            <h2 className="font-serif-brand text-lg text-brand-primary mb-3">Badges</h2>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 mb-8">
              {BADGES.map((b) => {
                const earned = b.earned(stats);
                return (
                  <div
                    key={b.id}
                    className={`card !p-3 text-center ${earned ? "" : "opacity-60"}`}
                    title={b.description}
                  >
                    <div className={`text-3xl mb-1 ${earned ? "" : "grayscale"}`} aria-hidden="true">
                      {b.emoji}
                    </div>
                    <p className="text-xs font-semibold text-brand-ink">{b.title}</p>
                    <p className="text-[10px] text-brand-muted leading-tight mt-0.5">{b.description}</p>
                    {!earned && (
                      <div className="mt-2 h-1 rounded-full bg-brand-mint overflow-hidden" aria-hidden="true">
                        <div className="h-full bg-brand-accent" style={{ width: `${b.progress(stats)}%` }} />
                      </div>
                    )}
                    <span className="sr-only">{earned ? "Earned" : `Locked — ${b.progress(stats)}% there`}</span>
                  </div>
                );
              })}
            </div>

            {/* ── Leaderboard ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-serif-brand text-lg text-brand-primary">Cohort leaderboard</h2>
              {(appUser?.cohortIds?.length ?? 0) > 1 && (
                <select
                  className="input-field !w-auto text-xs py-1"
                  value={boardCohort ?? ""}
                  aria-label="Choose cohort"
                  onChange={(e) => {
                    setBoardCohort(e.target.value);
                    void loadBoard(e.target.value);
                  }}
                >
                  {appUser?.cohortIds?.map((id) => (
                    <option key={id} value={id}>{board && boardCohort === id ? board.cohortName : id}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="card !p-0 overflow-hidden">
              {boardLoading ? (
                <div className="flex justify-center py-10"><Spinner /></div>
              ) : boardError ? (
                <p className="p-4 text-sm text-brand-muted">{boardError}</p>
              ) : !board || board.rows.length === 0 ? (
                <p className="p-4 text-sm text-brand-muted">
                  {appUser?.cohortIds?.length
                    ? "No activity in this cohort yet — be the first on the board."
                    : "Join a cohort to see its leaderboard."}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">XP standings for {board.cohortName}</caption>
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-brand-muted border-b border-brand-line">
                      <th className="px-4 py-2.5 w-12">#</th>
                      <th className="px-2 py-2.5">Learner</th>
                      <th className="px-2 py-2.5 text-right">Lessons</th>
                      <th className="px-2 py-2.5 text-right">Certs</th>
                      <th className="px-4 py-2.5 text-right">XP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.rows.map((r, i) => (
                      <tr
                        key={`${r.name}-${i}`}
                        className={`border-b border-brand-line last:border-0 ${r.isYou ? "bg-brand-mint" : ""}`}
                      >
                        <td className="px-4 py-2.5">{MEDALS[i] ?? i + 1}</td>
                        <td className="px-2 py-2.5 font-medium text-brand-ink">
                          {r.name} {r.isYou && <span className="text-xs text-brand-teal">(you)</span>}
                        </td>
                        <td className="px-2 py-2.5 text-right text-brand-muted">{r.lessonsCompleted}</td>
                        <td className="px-2 py-2.5 text-right text-brand-muted">{r.certificates}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-brand-teal">
                          {r.xp.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {board?.truncated && (
                <p className="p-3 text-xs text-brand-muted">Showing the first 50 members.</p>
              )}
            </div>
          </>
        )}
      </div>
    </LearnerShell>
  );
}
