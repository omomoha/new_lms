"use client";

import { Suspense, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { sendPasswordResetEmail } from "firebase/auth";
import getClientAuth from "@/lib/firebase/auth";
import { useAuth } from "@/contexts/AuthContext";

/** Extract a Firebase error code (e.g. "auth/invalid-email") from an unknown error. */
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

// Anti-enumeration: shown whether or not the account exists.
const RESET_SENT_MESSAGE =
  "If an account exists for that address, a reset link is on its way.";

function LoginForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot-password inline form
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const toggleReset = () => {
    setShowReset((open) => {
      if (!open) {
        // Prefill from the login email field on open
        setResetEmail(email);
        setResetStatus(null);
        setResetError(null);
      }
      return !open;
    });
  };

  const handleReset = async (e: FormEvent) => {
    e.preventDefault();
    setResetStatus(null);
    setResetError(null);
    setResetLoading(true);
    try {
      await sendPasswordResetEmail(getClientAuth(), resetEmail);
      setResetStatus(RESET_SENT_MESSAGE);
    } catch (err: unknown) {
      const code = errorCode(err);
      if (code === "auth/invalid-email" || code === "auth/missing-email") {
        setResetError("Enter a valid email address.");
      } else if (code === "auth/network-request-failed") {
        setResetError("Network error — check your connection and try again.");
      } else {
        // Includes auth/user-not-found: show the same success message so the
        // form never reveals whether an account exists.
        setResetStatus(RESET_SENT_MESSAGE);
      }
    } finally {
      setResetLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace(next || "/");
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      if (raw === "EMAIL_NOT_VERIFIED") {
        setError(
          "Please verify your email first — we just sent you a fresh verification link. Click it, then sign in."
        );
        return;
      }
      const msg = err instanceof Error ? err.message : "Login failed";
      setError(
        msg.includes("wrong-password") || msg.includes("user-not-found")
          ? "Invalid email or password."
          : msg
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-6 sm:p-8">
      <h1 className="font-serif-brand text-xl font-normal mb-6 text-brand-primary">Welcome back</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1 text-brand-ink">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1 text-brand-ink">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
            placeholder="••••••••"
          />
        </div>

        <div className="text-right">
          <button
            type="button"
            onClick={toggleReset}
            aria-expanded={showReset}
            aria-controls="reset-form"
            className="text-sm font-medium hover:underline text-brand-teal"
          >
            Forgot password?
          </button>
        </div>

        <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {showReset && (
        <form
          id="reset-form"
          onSubmit={handleReset}
          className="mt-4 p-4 rounded-lg border border-brand-line bg-brand-cream space-y-3"
        >
          <div>
            <label htmlFor="reset-email" className="block text-sm font-medium mb-1 text-brand-ink">
              Email for reset link
            </label>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              className="input-field"
              placeholder="you@example.com"
            />
          </div>
          <div aria-live="polite">
            {resetStatus && (
              <p className="p-3 rounded-lg text-sm bg-brand-mint text-brand-primary">
                {resetStatus}
              </p>
            )}
            {resetError && (
              <p className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {resetError}
              </p>
            )}
          </div>
          <button type="submit" disabled={resetLoading} className="btn-secondary w-full">
            {resetLoading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-brand-muted">
        New here?{" "}
        <a href="/auth/register" className="font-semibold hover:underline text-brand-accent">Create an account</a>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-brand-primary">
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-2 mb-2">
          <span className="font-serif-brand font-bold text-3xl tracking-tight text-brand-accent">Andela</span>
          <span className="text-white font-light text-3xl">LMS</span>
        </div>
        <p className="text-sm" style={{ color: "rgba(255,255,255,0.5)" }}>Sign in to continue</p>
      </div>
      <Suspense fallback={<div className="text-white/70 text-sm">Loading…</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
