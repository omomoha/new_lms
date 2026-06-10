"use client";

/**
 * Learner profile & settings — /learn/profile
 *
 * Cards:
 *  1. Account     — email (read-only), role badge, joined date
 *  2. Display name — updateProfile(displayName) + Firestore users/{uid} { name }
 *                    (rules carve-out: a user may update ONLY the name field of
 *                    their own doc — so we write exactly that single field)
 *  3. Password    — reauthenticate with current password, then updatePassword
 *  4. My cohorts  — cohort docs fetched by appUser.cohortIds (member read allowed)
 */

import { useEffect, useState, FormEvent } from "react";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import getClientAuth from "@/lib/firebase/auth";
import db from "@/lib/firebase/firestore";
import { useAuth } from "@/contexts/AuthContext";
import LearnerShell from "@/components/layout/LearnerShell";
import type { Cohort } from "@/types";

/** Extract a Firebase error code (e.g. "auth/wrong-password") from an unknown error. */
function errorCode(err: unknown): string {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return "";
}

type CohortSummary = Pick<Cohort, "id" | "name">;

export default function ProfilePage() {
  const { appUser } = useAuth();

  // ── Display name card state ────────────────────────────────────────────
  const [name, setName] = useState("");
  const [nameInitialized, setNameInitialized] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // ── Change password card state ─────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  // ── My cohorts card state ──────────────────────────────────────────────
  const [cohorts, setCohorts] = useState<CohortSummary[]>([]);
  const [cohortsLoading, setCohortsLoading] = useState(true);

  // Prefill the name input once appUser resolves (it can be null on first render)
  useEffect(() => {
    if (appUser && !nameInitialized) {
      setName(appUser.name ?? "");
      setNameInitialized(true);
    }
  }, [appUser, nameInitialized]);

  // Fetch cohort docs the learner belongs to (single-doc reads allowed for members)
  useEffect(() => {
    if (!appUser) return;
    const ids = Array.isArray(appUser.cohortIds) ? appUser.cohortIds : [];
    if (ids.length === 0) {
      setCohorts([]);
      setCohortsLoading(false);
      return;
    }
    (async () => {
      setCohortsLoading(true);
      try {
        const snaps = await Promise.all(
          ids.map((id) => getDoc(doc(db, "cohorts", id)))
        );
        const found: CohortSummary[] = [];
        snaps.forEach((snap) => {
          if (snap.exists()) {
            const data = snap.data() as { name?: unknown };
            found.push({
              id: snap.id,
              name: typeof data.name === "string" ? data.name : snap.id,
            });
          }
        });
        setCohorts(found);
      } catch (err: unknown) {
        console.warn("ProfilePage: cohort fetch failed:", err);
        setCohorts([]);
      } finally {
        setCohortsLoading(false);
      }
    })();
  }, [appUser]);

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);

    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
      setNameError("Name must be between 2 and 100 characters.");
      return;
    }
    const current = getClientAuth().currentUser;
    if (!current || !appUser) {
      setNameError("You must be signed in to update your name.");
      return;
    }

    setNameSaving(true);
    try {
      await updateProfile(current, { displayName: trimmed });
      // Rules allow a user to update ONLY the name field of their own doc —
      // write exactly that single field, nothing else.
      await updateDoc(doc(db, "users", appUser.uid), { name: trimmed });
      setName(trimmed);
      setNameSaved(true);
    } catch (err: unknown) {
      setNameError(
        err instanceof Error ? err.message : "Failed to save your name. Try again."
      );
    } finally {
      setNameSaving(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);

    if (newPassword.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("New password and confirmation do not match.");
      return;
    }
    const current = getClientAuth().currentUser;
    if (!current || !current.email) {
      setPwError("You must be signed in to change your password.");
      return;
    }

    setPwSaving(true);
    try {
      const credential = EmailAuthProvider.credential(current.email, currentPassword);
      await reauthenticateWithCredential(current, credential);
      await updatePassword(current, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwSaved(true);
    } catch (err: unknown) {
      const code = errorCode(err);
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setPwError("Current password is incorrect.");
      } else if (code === "auth/weak-password") {
        setPwError("New password is too weak — use at least 8 characters.");
      } else {
        setPwError(
          err instanceof Error ? err.message : "Failed to update password. Try again."
        );
      }
    } finally {
      setPwSaving(false);
    }
  };

  const joinedDate = appUser?.createdAt?.toDate
    ? appUser.createdAt.toDate().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <LearnerShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {/* Hero band */}
        <div className="page-hero mb-6">
          <span className="kicker">MY LEARNING · PROFILE</span>
          <h1 className="font-serif-brand text-2xl sm:text-3xl font-normal text-white leading-tight">
            Your profile
          </h1>
          <p className="mt-1 text-sm text-brand-mist">
            Manage your account details and password
          </p>
        </div>

        <div className="space-y-5">
          {/* ── Account card ─────────────────────────────────────────── */}
          <section className="card" aria-labelledby="account-heading">
            <h2 id="account-heading" className="font-medium mb-4 text-brand-ink">
              Account
            </h2>
            <dl className="space-y-3 text-sm">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <dt className="w-28 shrink-0 text-brand-muted">Email</dt>
                <dd className="text-brand-ink break-all">{appUser?.email ?? "—"}</dd>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                <dt className="w-28 shrink-0 text-brand-muted">Role</dt>
                <dd>
                  <span className="badge bg-brand-mint text-brand-primary capitalize">
                    {appUser?.role ?? "learner"}
                  </span>
                </dd>
              </div>
              {joinedDate && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                  <dt className="w-28 shrink-0 text-brand-muted">Joined</dt>
                  <dd className="text-brand-ink">{joinedDate}</dd>
                </div>
              )}
            </dl>
          </section>

          {/* ── Display name card ────────────────────────────────────── */}
          <section className="card" aria-labelledby="name-heading">
            <h2 id="name-heading" className="font-medium mb-4 text-brand-ink">
              Display name
            </h2>
            <form onSubmit={handleSaveName} className="space-y-3">
              <div>
                <label
                  htmlFor="display-name"
                  className="block text-sm font-medium mb-1 text-brand-ink"
                >
                  Name
                </label>
                <input
                  id="display-name"
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameSaved(false);
                  }}
                  className="input-field"
                  placeholder="Your full name"
                />
              </div>
              {nameError && (
                <p className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {nameError}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={nameSaving} className="btn-primary">
                  {nameSaving ? "Saving…" : "Save"}
                </button>
                <span aria-live="polite" className="text-sm font-medium text-brand-teal">
                  {nameSaved ? "Saved ✓" : ""}
                </span>
              </div>
            </form>
          </section>

          {/* ── Change password card ─────────────────────────────────── */}
          <section className="card" aria-labelledby="password-heading">
            <h2 id="password-heading" className="font-medium mb-4 text-brand-ink">
              Change password
            </h2>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label
                  htmlFor="current-password"
                  className="block text-sm font-medium mb-1 text-brand-ink"
                >
                  Current password
                </label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="input-field"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label
                  htmlFor="new-password"
                  className="block text-sm font-medium mb-1 text-brand-ink"
                >
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-sm font-medium mb-1 text-brand-ink"
                >
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field"
                  placeholder="Repeat new password"
                />
              </div>
              {pwError && (
                <p className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {pwError}
                </p>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={pwSaving} className="btn-primary">
                  {pwSaving ? "Updating…" : "Update password"}
                </button>
                <span aria-live="polite" className="text-sm font-medium text-brand-teal">
                  {pwSaved ? "Password updated ✓" : ""}
                </span>
              </div>
            </form>
          </section>

          {/* ── My cohorts card ──────────────────────────────────────── */}
          <section className="card" aria-labelledby="cohorts-heading">
            <h2 id="cohorts-heading" className="font-medium mb-4 text-brand-ink">
              My cohorts
            </h2>
            {cohortsLoading ? (
              <p className="text-sm text-brand-muted">Loading cohorts…</p>
            ) : cohorts.length === 0 ? (
              <p className="text-sm text-brand-muted">
                You are not in any cohorts yet — your admin will assign you to one.
              </p>
            ) : (
              <ul className="space-y-2">
                {cohorts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-2 text-sm text-brand-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="w-2 h-2 rounded-sm rotate-45 bg-brand-accent shrink-0"
                    />
                    {c.name}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </LearnerShell>
  );
}
