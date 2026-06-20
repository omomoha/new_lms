/**
 * featureFlags — read optional boolean flags from the single settings/features
 * Firestore doc so unfinished work can ship safely behind a default-off switch.
 *
 * The doc is admin-managed (settings/{id} rules already restrict writes to
 * admins). A missing doc or missing key resolves to `false` — half-built
 * features never reach learners on a prod deploy unless explicitly enabled.
 */

import { doc, getDoc } from "firebase/firestore";
import db from "@/lib/firebase/firestore";

export type FeatureFlag =
  /** Tutor conversation persistence + answer feedback UI (Phase 4 Workstream A). */
  | "tutorEnhancements";

/** Read a single feature flag; defaults to false on any error / missing key. */
export async function getFeatureFlag(flag: FeatureFlag): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, "settings", "features"));
    return snap.exists() && snap.data()?.[flag] === true;
  } catch {
    return false;
  }
}
