/**
 * Admin audit log — client-side writer.
 *
 * Writes append-only entries to the `auditLogs` collection after successful
 * admin mutations. Firestore rules allow admins to CREATE entries only when
 * `actorUid` equals their own auth uid; updates and deletes are denied for
 * everyone, so the log is tamper-evident.
 *
 * Doc shape (mirrored by firestore.rules and the Cloud Functions writer):
 *   {
 *     actorUid:   string,            // current admin uid — MUST equal auth uid
 *     actorEmail: string,            // "" if unknown
 *     action:     string,            // dot namespaced, e.g. "course.create"
 *     targetType: string,            // "course" | "user" | "cohort" | "onboarding" | ...
 *     targetId:   string,            // affected doc id ("" for bulk actions)
 *     details:    string,            // human-readable summary, <= 1000 chars
 *     at:         serverTimestamp()
 *   }
 *
 * IMPORTANT: logAdminAction NEVER throws — an audit failure must not break
 * the admin action it describes. Call it fire-and-forget:
 *   void logAdminAction({ uid: user.uid, email: user.email }, { ... });
 */

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import db from "@/lib/firebase/firestore";

const MAX_DETAILS_LENGTH = 1000;

export interface AuditActor {
  uid: string;
  email?: string | null;
}

export interface AuditEntryInput {
  /** Dot-namespaced action, e.g. "course.create", "cohort.member.add" */
  action: string;
  /** "course" | "user" | "cohort" | "onboarding" | ... */
  targetType: string;
  /** Affected doc id; omit (or "") for bulk actions */
  targetId?: string;
  /** Human-readable summary; trimmed and capped at 1000 chars */
  details?: string;
}

/** Shape of an auditLogs/{id} document as read back from Firestore. */
export interface AuditLogDoc {
  actorUid: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  at: Timestamp | null;
}

/**
 * Best-effort append of one audit entry. Resolves even on failure
 * (failures are logged with console.warn and swallowed).
 */
export async function logAdminAction(
  actor: AuditActor,
  entry: AuditEntryInput
): Promise<void> {
  try {
    await addDoc(collection(db, "auditLogs"), {
      actorUid: actor.uid,
      actorEmail: actor.email ?? "",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? "",
      details: (entry.details ?? "").trim().slice(0, MAX_DETAILS_LENGTH),
      at: serverTimestamp(),
    });
  } catch (err: unknown) {
    // Never throw — audit logging must not break the admin action.
    console.warn("audit: failed to write auditLogs entry:", err);
  }
}
