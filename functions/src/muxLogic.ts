/**
 * muxLogic — pure, dependency-free helpers for the Mux/HLS adaptive video
 * pipeline (Phase 4 — Workstream C).
 *
 * Nothing here imports firebase-functions, firebase-admin, the Mux SDK, or jose,
 * so these functions are unit-testable from the root vitest setup (same pattern
 * as officeConvert.ts / promptSafety.ts).
 *
 * Responsibilities kept here:
 *  - parsing/encoding the opaque `videoPath` seam so a Mux asset can travel
 *    through the SAME `Lesson.videoPath` string the rest of the app already uses
 *  - signed-playback token TTL math
 *  - mapping Mux webhook event types → a lesson video status
 *  - the courseId path-validation reused by the playback-token gate
 */

// ─── videoPath seam (mux: prefix) ────────────────────────────────────────────
//
// The existing seam stores an opaque string in Lesson.videoPath. Firebase
// Storage videos look like "videos/{courseId}/{moduleId}/{file}.mp4". To keep
// BOTH providers working side-by-side (cutover: new uploads → Mux, old ones
// migrated in the background), a Mux-backed lesson stores:
//
//   mux:{playbackId}
//
// The "mux:" prefix lets getPlaybackUrl/VideoPlayer distinguish a Mux playback
// id from a Storage path with zero schema churn. The explicit
// Lesson.muxPlaybackId / muxAssetId fields carry the same data for clarity and
// for the builder UI; videoPath stays the single source the player reads.

export const MUX_PATH_PREFIX = "mux:";

/** Build the opaque videoPath value for a Mux playback id. */
export function muxVideoPath(playbackId: string): string {
  return `${MUX_PATH_PREFIX}${playbackId}`;
}

/** True when a stored videoPath points at a Mux asset (vs a Storage object). */
export function isMuxPath(videoPath: string | undefined | null): boolean {
  return typeof videoPath === "string" && videoPath.startsWith(MUX_PATH_PREFIX);
}

/**
 * Extract the Mux playback id from a videoPath. Returns null when the string is
 * not a Mux path or the id is empty/contains a path separator (defensive — a
 * playback id is an opaque token, never a path).
 */
export function parseMuxPlaybackId(videoPath: string | undefined | null): string | null {
  if (!isMuxPath(videoPath)) return null;
  const id = (videoPath as string).slice(MUX_PATH_PREFIX.length).trim();
  if (!id || id.includes("/") || id.includes("..")) return null;
  // Mux playback ids are URL-safe base62-ish tokens. Reject anything else so a
  // crafted value can never be interpolated into a URL/JWT subject.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

// ─── Signed-playback token TTL ───────────────────────────────────────────────

/** Default playback-token lifetime — mirrors getSignedVideoUrl's 2h V4 URL. */
export const DEFAULT_PLAYBACK_TTL_SECONDS = 2 * 60 * 60;

/**
 * Clamp a requested TTL (seconds) into a safe range, falling back to the
 * default. Mux signed-playback JWTs must be short-lived; we never mint a token
 * good for more than 12h or less than 1 minute.
 */
export function clampPlaybackTtlSeconds(
  requested: number | undefined,
  fallback: number = DEFAULT_PLAYBACK_TTL_SECONDS
): number {
  const MIN = 60;
  const MAX = 12 * 60 * 60;
  if (typeof requested !== "number" || !Number.isFinite(requested)) return fallback;
  const i = Math.floor(requested);
  if (i < MIN) return MIN;
  if (i > MAX) return MAX;
  return i;
}

/** Absolute `exp` (epoch seconds) for a token minted `now` with `ttlSeconds`. */
export function playbackTokenExpiry(nowMs: number, ttlSeconds: number): number {
  return Math.floor(nowMs / 1000) + ttlSeconds;
}

// ─── Webhook event → lesson video status ─────────────────────────────────────

/**
 * Lesson video processing state surfaced to the builder. "preparing" while Mux
 * ingests/encodes, "ready" once playback is available, "errored" on failure.
 */
export type MuxVideoStatus = "preparing" | "ready" | "errored";

/**
 * Map a Mux webhook event type to a lesson video status, or null when the event
 * is not one we act on. We deliberately handle only the asset lifecycle events:
 *   video.asset.created   → preparing
 *   video.asset.ready     → ready
 *   video.asset.errored   → errored
 *   video.upload.asset_created / video.upload.errored handled by the caller
 *     (they carry the upload id, not the asset).
 */
export function mapWebhookEventToStatus(eventType: string | undefined): MuxVideoStatus | null {
  switch (eventType) {
    case "video.asset.ready":
      return "ready";
    case "video.asset.errored":
      return "errored";
    case "video.asset.created":
      return "preparing";
    default:
      return null;
  }
}

/**
 * Pull the first PUBLIC (signed) playback id from a Mux asset's playback_ids
 * array. Backfill/webhook code persists this so getMuxPlaybackToken can mint a
 * JWT against it. Prefers a "signed" policy id; falls back to the first id.
 */
export function pickPlaybackId(
  playbackIds: Array<{ id?: string; policy?: string }> | undefined
): string | null {
  if (!Array.isArray(playbackIds) || playbackIds.length === 0) return null;
  const signed = playbackIds.find((p) => p.policy === "signed" && p.id);
  const chosen = signed ?? playbackIds.find((p) => !!p.id);
  return chosen?.id ?? null;
}

// ─── courseId validation (shared with the playback-token gate) ───────────────

/** Course IDs are Firestore auto-IDs or admin slugs — this charset only. */
export function isValidCourseId(courseId: string | undefined | null): boolean {
  return typeof courseId === "string" && /^[A-Za-z0-9_-]+$/.test(courseId);
}
