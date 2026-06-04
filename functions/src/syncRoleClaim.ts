/**
 * syncRoleClaim — keeps the Auth custom claim in lockstep with users/{uid}.role.
 *
 * WHY: Firestore rules trust ONLY the JWT custom claim (request.auth.token.role),
 * never the client-readable doc field — otherwise role would be spoofable.
 * That makes role changes awkward (Admin SDK required). This trigger closes the
 * loop: whenever an ADMIN (or the console) updates a user's `role` field, the
 * claim is updated automatically.
 *
 * SECURITY: this is safe because firestore.rules only allow:
 *   - self-signup CREATE with role forced to "learner"
 *   - UPDATE by admins only
 * So the doc's role field can only be changed by an admin or the console.
 *
 * NOTE: the affected user must sign out/in (or refresh their ID token) before
 * the new claim takes effect in their session.
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const VALID_ROLES = new Set(["admin", "learner"]);

export const syncRoleClaim = onDocumentWritten(
  { document: "users/{uid}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!after) return; // doc deleted — leave claims untouched

    const role = after.role as string | undefined;
    if (!role || !VALID_ROLES.has(role)) return; // malformed/missing role

    const before = event.data?.before?.exists ? event.data.before.data() : null;
    if (before && before.role === role) return; // role unchanged — no-op

    const uid = event.params.uid;
    try {
      await admin.auth().setCustomUserClaims(uid, { role });
      console.info(`syncRoleClaim: role=${role} synced to claims for uid=${uid}`);
    } catch (err) {
      // e.g. Firestore doc exists but no matching Auth user
      console.error(`syncRoleClaim: failed for uid=${uid}:`, err);
    }
  }
);
