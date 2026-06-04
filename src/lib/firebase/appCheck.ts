/**
 * Firebase App Check — Phase 3 hardening (opt-in via env).
 *
 * When NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY is set, every Firestore /
 * Storage / Functions request carries an App Check token proving it came from
 * this web app (reCAPTCHA v3 attestation) — blocking scripted abuse even with
 * stolen user credentials.
 *
 * Rollout (see README):
 *  1. Firebase console → App Check → register the web app with reCAPTCHA v3
 *     → copy the site key into NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY.
 *  2. Deploy and run in MONITORING mode (unenforced) until metrics look clean.
 *  3. Enforce: console toggles for Firestore/Storage, and set
 *     ENFORCE_APPCHECK=true in functions/.env for the callable functions.
 *
 * Local dev: set NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG=true to use a debug
 * token (printed in the browser console on first load; allow-list it in the
 * console under App Check → Apps → Manage debug tokens).
 */

import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  type AppCheck,
} from "firebase/app-check";
import app from "./config";

let instance: AppCheck | null = null;

export function initAppCheck(): AppCheck | null {
  if (typeof window === "undefined") return null; // client only
  if (instance) return instance;

  const siteKey = process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY;
  if (!siteKey) return null; // not configured — no-op

  if (process.env.NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG === "true") {
    (window as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }

  instance = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
  return instance;
}
