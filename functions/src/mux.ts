/**
 * mux — Cloud Functions for the Mux/HLS adaptive video pipeline (Phase 4 — C).
 *
 * Exports:
 *  - createMuxUpload      (callable, admin)  — request a Mux Direct Upload URL
 *  - getMuxPlaybackToken  (callable, learner)— mint a signed HLS playback token,
 *                                              gated by the SAME requireCourseAccess
 *                                              used by getSignedVideoUrl
 *  - muxWebhook           (onRequest)        — Mux-signature-verified; marks
 *                                              lessons ready/errored on encode
 *  - backfillVideosToMux  (callable, admin)  — idempotent migration of existing
 *                                              Storage videos/** into Mux
 *                                              (pattern: backfillOfficeConversions)
 *
 * Everything here fails gracefully when the MUX_* secrets are unset (the
 * muxClient accessors throw failed-precondition like aiClient()), so the system
 * is safe to deploy with the feature flag OFF and no Mux account.
 */

import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { requireAdmin, requireCourseAccess } from "./aiCommon";
import {
  muxClient,
  mintPlaybackToken,
  verifyMuxSignature,
  muxWebhookSecret,
} from "./muxClient";
import {
  muxVideoPath,
  parseMuxPlaybackId,
  isMuxPath,
  isValidCourseId,
  mapWebhookEventToStatus,
  pickPlaybackId,
  type MuxVideoStatus,
} from "./muxLogic";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

const ENFORCE_APPCHECK = process.env.ENFORCE_APPCHECK === "true";
const REGION = "us-central1";

// Auto-generate English captions for every Mux asset (Workstream C item 4); the
// manual .vtt override path in VideoPlayer stays available regardless.
const AUTO_SUBTITLES: Array<{ language_code: "en"; name: string }> = [
  { language_code: "en", name: "English (auto)" },
];

// ─── createMuxUpload (admin) ─────────────────────────────────────────────────
//
// The client's MuxVideoService calls this, then PUTs the file bytes directly to
// the returned upload URL (Direct Upload — bytes never transit our functions).
// The upload is created with a "signed" playback policy so streaming always
// requires a getMuxPlaybackToken JWT (no public playback ids ever exist).

interface CreateMuxUploadRequest {
  /** Optional CORS origin the browser will PUT from (Mux validates it). */
  corsOrigin?: string;
}

interface CreateMuxUploadResponse {
  /** Direct Upload PUT URL the browser uploads the file to. */
  uploadUrl: string;
  /** Mux upload id — correlated back to the asset via the webhook. */
  uploadId: string;
}

export const createMuxUpload = onCall<CreateMuxUploadRequest>(
  { region: REGION, enforceAppCheck: ENFORCE_APPCHECK },
  async (request): Promise<CreateMuxUploadResponse> => {
    requireAdmin(request.auth);
    const corsOrigin = request.data?.corsOrigin || "*";

    const upload = await muxClient().video.uploads.create({
      cors_origin: corsOrigin,
      new_asset_settings: {
        playback_policies: ["signed"],
        // For Direct Uploads, the captioned input omits `url` (the file is the
        // upload itself) — this enables Mux auto-captions on the main track.
        inputs: [{ generated_subtitles: AUTO_SUBTITLES }],
      },
    });

    if (!upload.url) {
      throw new HttpsError("internal", "Mux did not return an upload URL.");
    }
    return { uploadUrl: upload.url, uploadId: upload.id };
  }
);

// ─── getMuxPlaybackToken (learner) ───────────────────────────────────────────
//
// Returns a signed HLS playback URL for a Mux-backed lesson. Reuses the EXACT
// requireCourseAccess gate from getSignedVideoUrl: admin passes; otherwise the
// course must be published AND assigned to one of the caller's cohorts.

interface GetMuxPlaybackTokenRequest {
  /** The lesson's stored videoPath ("mux:{playbackId}") or a bare playback id. */
  videoPath: string;
  /** The course the lesson belongs to — gated against the caller. */
  courseId: string;
}

interface GetMuxPlaybackTokenResponse {
  /** Signed HLS manifest URL: https://stream.mux.com/{id}.m3u8?token=… */
  url: string;
  /** Raw token (for mux-player's playback-token prop). */
  token: string;
  playbackId: string;
  expiresAt: number; // epoch millis
}

export const getMuxPlaybackToken = onCall<GetMuxPlaybackTokenRequest>(
  { region: REGION, enforceAppCheck: ENFORCE_APPCHECK },
  async (request): Promise<GetMuxPlaybackTokenResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in to watch videos.");
    }
    const { videoPath, courseId } = request.data ?? {};
    if (!videoPath || typeof videoPath !== "string") {
      throw new HttpsError("invalid-argument", "videoPath is required.");
    }
    if (!isValidCourseId(courseId)) {
      throw new HttpsError("invalid-argument", "Invalid courseId.");
    }

    // Accept "mux:{id}" or a bare id; reject Storage paths outright.
    const playbackId = isMuxPath(videoPath)
      ? parseMuxPlaybackId(videoPath)
      : /^[A-Za-z0-9_-]+$/.test(videoPath)
        ? videoPath
        : null;
    if (!playbackId) {
      throw new HttpsError("invalid-argument", "Invalid Mux video reference.");
    }

    // SAME gate as getSignedVideoUrl (admin OR published+assigned-cohort).
    await requireCourseAccess(
      { uid: request.auth.uid, token: request.auth.token as Record<string, unknown> },
      courseId
    );

    const { token, expiresAt } = await mintPlaybackToken(playbackId);
    const url = `https://stream.mux.com/${playbackId}.m3u8?token=${token}`;
    return { url, token, playbackId, expiresAt };
  }
);

// ─── muxWebhook (signature-verified) ─────────────────────────────────────────
//
// Mux POSTs asset-lifecycle events here. We verify the Mux-Signature header
// against MUX_WEBHOOK_SECRET, then mark the matching lesson(s) ready/errored and
// persist the playback id once the asset is created. Lesson lookup uses the
// upload id (correlated via the lesson's muxUploadId) or the asset id.

/** Persist status (and playbackId when known) onto lessons matching a filter. */
async function updateLessonsByField(
  field: "muxUploadId" | "muxAssetId",
  value: string,
  patch: Record<string, unknown>
): Promise<number> {
  const snap = await db
    .collectionGroup("lessons")
    .where(field, "==", value)
    .get();
  if (snap.empty) return 0;
  await Promise.all(
    snap.docs.map((d) =>
      d.ref.set(
        { ...patch, muxUpdatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      )
    )
  );
  return snap.size;
}

export const muxWebhook = onRequest({ region: REGION }, async (req, res) => {
  if (!muxWebhookSecret()) {
    // Not configured — refuse rather than accept unverified events.
    console.warn("muxWebhook: MUX_WEBHOOK_SECRET unset; rejecting.");
    res.status(503).send("Webhook not configured.");
    return;
  }

  // Verify the signature against the RAW body (firebase-functions exposes it on
  // req.rawBody). A mismatch (or missing creds) throws → 403.
  try {
    const signature = req.header("Mux-Signature") || "";
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    const body = raw ? raw.toString("utf8") : JSON.stringify(req.body);
    await verifyMuxSignature(body, signature);
  } catch (err) {
    console.error("muxWebhook: signature verification failed:", err);
    res.status(403).send("Invalid signature.");
    return;
  }

  const event = req.body as {
    type?: string;
    data?: {
      id?: string;
      upload_id?: string;
      playback_ids?: Array<{ id?: string; policy?: string }>;
    };
  };

  const status: MuxVideoStatus | null = mapWebhookEventToStatus(event.type);
  if (!status) {
    // Not an event we act on — acknowledge so Mux stops retrying.
    res.status(200).send("ignored");
    return;
  }

  const assetId = event.data?.id;
  const uploadId = event.data?.upload_id;
  const playbackId = pickPlaybackId(event.data?.playback_ids);

  const patch: Record<string, unknown> = { muxStatus: status };
  if (assetId) patch.muxAssetId = assetId;
  if (playbackId) {
    patch.muxPlaybackId = playbackId;
    // Only flip the player over to Mux once the asset is actually ready, so
    // playback off Storage is never interrupted mid-encode.
    if (status === "ready") patch.videoPath = muxVideoPath(playbackId);
  }

  try {
    let updated = 0;
    // Prefer correlating by upload id (set at lesson-save time); fall back to
    // asset id (set on a previous webhook or by the backfill).
    if (uploadId) {
      updated = await updateLessonsByField("muxUploadId", uploadId, patch);
    }
    if (updated === 0 && assetId) {
      updated = await updateLessonsByField("muxAssetId", assetId, patch);
    }
    console.log(
      `muxWebhook: ${event.type} → status=${status}, updated ${updated} lesson(s) ` +
        `(upload=${uploadId ?? "-"}, asset=${assetId ?? "-"}).`
    );
  } catch (err) {
    // Acknowledge anyway — Mux retries on non-2xx, and a Firestore blip
    // shouldn't storm. The backfill/poll path can reconcile later.
    console.error("muxWebhook: lesson update failed:", err);
  }
  res.status(200).send("ok");
});

// ─── backfillVideosToMux (admin) ─────────────────────────────────────────────
//
// Idempotent migration: push existing Storage videos/** into Mux and rewrite the
// matching lesson docs. Pattern mirrors backfillOfficeConversions — one batch
// per invocation; the client re-invokes for the next batch.
//
// Idempotency: a lesson already carrying muxAssetId/muxUploadId is skipped.
// Originals are NEVER deleted (Workstream C item 5) — videoPath is only rewritten
// to "mux:{playbackId}" by the webhook once the asset is READY, so playback keeps
// working off Storage until Mux is ready.

const BACKFILL_BATCH_SIZE = 10;
const ERROR_SNIPPET_CHARS = 200;
const SIGNED_SOURCE_TTL_MS = 60 * 60 * 1000; // 1h — long enough for Mux to pull

interface BackfillVideosResponse {
  totalCandidates: number;
  migrated: Array<{ lessonPath: string; assetId: string }>;
  failed: Array<{ lessonPath: string; error: string }>;
  remaining: number;
}

export const backfillVideosToMux = onCall(
  { region: REGION, timeoutSeconds: 300, enforceAppCheck: ENFORCE_APPCHECK },
  async (request): Promise<BackfillVideosResponse> => {
    requireAdmin(request.auth);

    // Find lessons with a Storage videoPath not yet migrated to Mux.
    const snap = await db.collectionGroup("lessons").get();
    const candidates = snap.docs.filter((d) => {
      const data = d.data() as {
        videoPath?: string;
        muxAssetId?: string;
        muxUploadId?: string;
      };
      return (
        typeof data.videoPath === "string" &&
        data.videoPath.startsWith("videos/") &&
        !isMuxPath(data.videoPath) &&
        !data.muxAssetId &&
        !data.muxUploadId
      );
    });

    const batch = candidates.slice(0, BACKFILL_BATCH_SIZE);
    const migrated: Array<{ lessonPath: string; assetId: string }> = [];
    const failed: Array<{ lessonPath: string; error: string }> = [];

    const bucket = admin.storage().bucket();
    const client = muxClient();

    for (const lessonDoc of batch) {
      const lessonPath = lessonDoc.ref.path;
      const videoPath = (lessonDoc.data() as { videoPath: string }).videoPath;
      try {
        // Mux pulls the source over HTTPS — give it a short-lived signed URL so
        // we never expose videos/** publicly (Storage rules deny direct reads).
        const [sourceUrl] = await bucket.file(videoPath).getSignedUrl({
          version: "v4",
          action: "read",
          expires: Date.now() + SIGNED_SOURCE_TTL_MS,
        });

        const asset = await client.video.assets.create({
          inputs: [{ url: sourceUrl, generated_subtitles: AUTO_SUBTITLES }],
          playback_policies: ["signed"],
        });

        // Mark the lesson as migrating; the webhook flips status→ready and
        // rewrites videoPath once encoding completes. Original Storage object is
        // left intact, and videoPath stays "videos/…" until ready, so playback
        // is uninterrupted.
        await lessonDoc.ref.set(
          {
            muxAssetId: asset.id,
            muxStatus: "preparing",
            muxUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        migrated.push({ lessonPath, assetId: asset.id });
      } catch (err) {
        console.error(`backfillVideosToMux failed for ${lessonPath}:`, err);
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ lessonPath, error: message.slice(0, ERROR_SNIPPET_CHARS) });
      }
    }

    const result: BackfillVideosResponse = {
      totalCandidates: candidates.length,
      migrated,
      failed,
      remaining: candidates.length - batch.length,
    };
    console.log(
      `backfillVideosToMux: ${migrated.length} migrated, ${failed.length} failed, ` +
        `${result.remaining} remaining (of ${result.totalCandidates}).`
    );
    return result;
  }
);
