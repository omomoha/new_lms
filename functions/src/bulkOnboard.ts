/**
 * bulkOnboard — Callable Cloud Function
 *
 * Called from the admin Bulk Onboarding page with an array of validated rows.
 *
 * For each row this function:
 *  1. Creates a Firebase Auth user with a CSPRNG-generated temp password
 *  2. Sets the `role` custom claim (used by Firestore rules + middleware)
 *  3. Writes a `users/{uid}` Firestore doc
 *  4. Finds or creates the cohort by tag and links the user
 *  5. Generates a password-reset link (secure-by-default delivery):
 *     - The plaintext password is NEVER stored in Firestore.
 *     - Instead, generatePasswordResetLink() is called and that link
 *       is placed in the mail doc so the user sets their own password.
 *     - `mustChangePassword: true` is set on the users/{uid} doc.
 *
 * Returns: { results: OnboardingResult[] }
 *
 * NOTE ON CUSTOM CLAIMS:
 *   admin.auth().setCustomUserClaims(uid, { role: "learner" })
 *   The claim is checked in Firestore rules as:
 *     request.auth.token.role == "admin"
 *   And can be read client-side after token refresh:
 *     await user.getIdTokenResult(true) → result.claims.role
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as crypto from "crypto"; // Fix #10: Node CSPRNG

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const authAdmin = admin.auth();

// Fix #9: allowlist of valid roles
const VALID_ROLES = ["admin", "learner"] as const;
type UserRole = (typeof VALID_ROLES)[number];

interface OnboardingRow {
  name: string;
  email: string;
  role: UserRole;
  cohort_tag: string;
}

interface OnboardingResult {
  email: string;
  status: "created" | "skipped" | "error"; // Fix #13: status field
  uid?: string;
  error?: string;
  note?: string;
}

// Fix #10: replace Math.random() with CSPRNG crypto.randomInt()
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 12 }, () =>
    chars[crypto.randomInt(0, chars.length)]
  ).join("");
}

// Fix #12: cohort_tag field guard regex
const COHORT_TAG_RE = /^[\w-]{1,64}$/;

// Server-side email format guard (client CSV validation is not trusted)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escape a string for safe interpolation into email HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const bulkOnboard = onCall(
  { region: "us-central1", enforceAppCheck: process.env.ENFORCE_APPCHECK === "true" },
  async (request) => {
    // Require caller to be an admin
    if (request.auth?.token?.role !== "admin") {
      throw new HttpsError("permission-denied", "Only admins can run bulk onboarding.");
    }

    const rows: OnboardingRow[] = request.data?.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new HttpsError("invalid-argument", "rows must be a non-empty array.");
    }
    if (rows.length > 500) {
      throw new HttpsError("invalid-argument", "Maximum 500 rows per call.");
    }

    const results: OnboardingResult[] = [];

    for (const row of rows) {
      const { name, email, role, cohort_tag } = row;

      // Fix #9: server-side validate role
      if (!VALID_ROLES.includes(role as UserRole)) {
        results.push({
          email,
          status: "error",
          error: `Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}.`,
        });
        continue;
      }

      // Server-side email validation
      if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
        results.push({
          email: String(email ?? ""),
          status: "error",
          error: "invalid email address",
        });
        continue;
      }

      // Fix #12: validate name length
      if (!name || name.length > 200) {
        results.push({
          email,
          status: "error",
          error: `name is required and must be <= 200 characters.`,
        });
        continue;
      }

      // Fix #12: validate cohort_tag format
      if (!cohort_tag || !COHORT_TAG_RE.test(cohort_tag)) {
        results.push({
          email,
          status: "error",
          error: `cohort_tag "${cohort_tag}" is invalid. Must match /^[\\w-]{1,64}$/.`,
        });
        continue;
      }

      try {
        const tempPassword = generateTempPassword();

        // 1. Create Auth user
        let uid: string;
        let isNewUser = true;
        try {
          const userRecord = await authAdmin.createUser({
            email,
            displayName: name,
            password: tempPassword,
            emailVerified: false,
          });
          uid = userRecord.uid;
        } catch (err: unknown) {
          if ((err as { code?: string }).code === "auth/email-already-exists") {
            // Fix #13: existing user — skip role/claim overwrite, just note it
            const existing = await authAdmin.getUserByEmail(email);
            uid = existing.uid;
            isNewUser = false;
          } else {
            throw err;
          }
        }

        if (!isNewUser) {
          // Fix #13: for existing email, do NOT overwrite role/claims.
          // Only additively merge cohort assignment below.
          const cohortQuery = await db
            .collection("cohorts")
            .where("tag", "==", cohort_tag)
            .limit(1)
            .get();

          let cohortId: string;
          if (cohortQuery.empty) {
            const cohortRef = db.collection("cohorts").doc();
            cohortId = cohortRef.id;
            await cohortRef.set({
              id: cohortId,
              name: cohort_tag,
              tag: cohort_tag,
              color: "#8FB85C",
              courseIds: [],
              createdAt: FieldValue.serverTimestamp(),
            });
          } else {
            cohortId = cohortQuery.docs[0].id;
          }

          // Additive merge only — do not touch role or claims
          await db.doc(`users/${uid}`).set(
            { cohortIds: FieldValue.arrayUnion(cohortId) },
            { merge: true }
          );

          results.push({
            email,
            status: "skipped",
            uid,
            note: "Email already exists; role/claims left unchanged. Cohort additive merge applied.",
          });
          continue;
        }

        // 2. Set custom claim for role (new users only)
        //    IMPORTANT: client must call user.getIdToken(true) to see updated claim.
        await authAdmin.setCustomUserClaims(uid, { role });

        // 3. Find or create cohort by tag
        const cohortQuery = await db
          .collection("cohorts")
          .where("tag", "==", cohort_tag)
          .limit(1)
          .get();

        let cohortId: string;
        if (cohortQuery.empty) {
          const cohortRef = db.collection("cohorts").doc();
          cohortId = cohortRef.id;
          await cohortRef.set({
            id: cohortId,
            name: cohort_tag,
            tag: cohort_tag,
            color: "#8FB85C",
            courseIds: [],
            createdAt: FieldValue.serverTimestamp(),
          });
        } else {
          cohortId = cohortQuery.docs[0].id;
        }

        // 4. Write users/{uid} doc (merge so existing data is preserved)
        //    Fix #11: set mustChangePassword: true (secure-by-default)
        await db.doc(`users/${uid}`).set(
          {
            uid,
            email,
            name,
            role,
            cohortIds: FieldValue.arrayUnion(cohortId),
            status: "active",
            mustChangePassword: true, // Fix #11: user must set their own password
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // Fix #11: generate a password-reset link so the user sets their own
        // password. The plaintext temp password is NEVER written to Firestore.
        // This is the secure-by-default delivery mechanism.
        const resetLink = await authAdmin.generatePasswordResetLink(email);

        // 5. Write mail doc for Firebase Trigger Email extension.
        //    Fix #11: mail body contains the reset link, NOT the plaintext password.
        //    See: https://extensions.dev/extensions/firebase/firestore-send-email
        // Sanitise the CSV-supplied name before email interpolation
        const safeName = name.replace(/[\r\n]+/g, " ").trim();
        await db.collection("mail").add({
          to: email,
          message: {
            subject: "Welcome to Andela Learn — set your password",
            text: `Hi ${safeName},\n\nYour Andela Learn account is ready.\n\nEmail: ${email}\n\nPlease set your password using the link below (valid for 1 hour):\n${resetLink}\n\nAndela Team`,
            html: `<p>Hi ${escapeHtml(safeName)},</p>
<p>Your <strong>Andela Learn</strong> account is ready.</p>
<p>Email: <strong>${escapeHtml(email)}</strong></p>
<p><a href="${resetLink}">Set your password</a> (link valid for 1 hour)</p>
<p>— Andela Team</p>`,
          },
        });

        results.push({ email, status: "created", uid });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ email, status: "error", error: message });
      }
    }

    // Audit log: ONE summary entry per run, written with the admin SDK
    // (bypasses rules — auditLogs is append-only for clients).
    // Best-effort: a logging failure must never fail the onboarding run.
    try {
      const created = results.filter((r) => r.status === "created").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      const errored = results.filter((r) => r.status === "error").length;
      await db.collection("auditLogs").add({
        actorUid: request.auth?.uid ?? "",
        actorEmail:
          typeof request.auth?.token?.email === "string"
            ? request.auth.token.email
            : "",
        action: "onboarding.run",
        targetType: "onboarding",
        targetId: "",
        details: `Bulk onboarding processed ${rows.length} row(s): ${created} created, ${skipped} skipped, ${errored} error(s)`.slice(
          0,
          1000
        ),
        at: FieldValue.serverTimestamp(),
      });
    } catch (auditErr: unknown) {
      console.warn("bulkOnboard: failed to write auditLogs entry:", auditErr);
    }

    return { results };
  }
);
