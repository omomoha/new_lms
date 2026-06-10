/**
 * manageUserAccount — admin-only account lifecycle actions.
 *
 * Actions:
 *  - "pause":    Firebase Auth disabled=true (sign-in refused) + refresh
 *                tokens revoked (live sessions die within the hour) +
 *                users/{uid}.status = "inactive" (AuthContext force-signs-out
 *                paused users on their next page load)
 *  - "activate": reverses pause
 *  - "delete":   deletes the Auth user + users/{uid} doc. Learning records
 *                (progress, attempts, certificates) are intentionally kept —
 *                certificates remain publicly verifiable artifacts.
 *
 * Guards: admins cannot act on themselves, and admin accounts cannot be
 * paused/deleted at all (demote them first — prevents lockout/coup
 * scenarios). Every action is written to the append-only audit log.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { ENFORCE_APPCHECK, requireAdmin } from "./aiCommon";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const authAdmin = admin.auth();

const UID_RE = /^[A-Za-z0-9]{8,128}$/;
const ACTIONS = new Set(["pause", "activate", "delete"] as const);
type Action = "pause" | "activate" | "delete";

interface ManageUserRequest {
  uid: string;
  action: Action;
}

export const manageUserAccount = onCall<ManageUserRequest>(
  { region: "us-central1", enforceAppCheck: ENFORCE_APPCHECK },
  async (request): Promise<{ ok: true }> => {
    const auth = requireAdmin(request.auth);
    const { uid, action } = request.data ?? ({} as ManageUserRequest);

    if (typeof uid !== "string" || !UID_RE.test(uid)) {
      throw new HttpsError("invalid-argument", "Invalid user id.");
    }
    if (typeof action !== "string" || !ACTIONS.has(action as Action)) {
      throw new HttpsError("invalid-argument", "Invalid action.");
    }
    if (uid === auth.uid) {
      throw new HttpsError("failed-precondition", "You cannot pause or delete your own account.");
    }

    // Target lookup + admin immunity
    let target: admin.auth.UserRecord;
    try {
      target = await authAdmin.getUser(uid);
    } catch {
      throw new HttpsError("not-found", "User not found.");
    }
    if (target.customClaims?.role === "admin" && action !== "activate") {
      throw new HttpsError(
        "failed-precondition",
        "Admin accounts cannot be paused or deleted. Change their role first."
      );
    }

    const email = target.email ?? uid;

    if (action === "pause") {
      await authAdmin.updateUser(uid, { disabled: true });
      await authAdmin.revokeRefreshTokens(uid);
      await db.doc(`users/${uid}`).set({ status: "inactive" }, { merge: true });
    } else if (action === "activate") {
      await authAdmin.updateUser(uid, { disabled: false });
      await db.doc(`users/${uid}`).set({ status: "active" }, { merge: true });
    } else {
      await authAdmin.deleteUser(uid);
      await db.doc(`users/${uid}`).delete();
    }

    // Append-only audit trail (best effort — must not fail the action)
    try {
      const details =
        action === "pause"
          ? `Paused account ${email} (sign-in disabled, sessions revoked)`
          : action === "activate"
          ? `Re-activated account ${email}`
          : `Deleted account ${email} (learning records retained)`;
      await db.collection("auditLogs").add({
        actorUid: auth.uid,
        actorEmail: typeof auth.token.email === "string" ? auth.token.email : "",
        action: `user.${action}`,
        targetType: "user",
        targetId: uid,
        details: details.slice(0, 1000),
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("manageUserAccount: audit write failed:", err);
    }

    return { ok: true };
  }
);
