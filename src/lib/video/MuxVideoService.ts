/**
 * MuxVideoService — adaptive video delivery via Mux/HLS (Phase 4 — Workstream C).
 *
 * Upload:
 *   1. call createMuxUpload (admin-gated) → { uploadUrl, uploadId }
 *   2. PUT the file bytes directly to uploadUrl (Mux Direct Upload — bytes never
 *      transit our Cloud Functions)
 *   3. return "muxupload:{uploadId}" so the lesson-save flow can persist the
 *      upload id; the muxWebhook later fills in muxAssetId / muxPlaybackId and
 *      flips videoPath to "mux:{playbackId}" when encoding finishes.
 *
 * Playback:
 *   getPlaybackUrl("mux:{playbackId}") → calls getMuxPlaybackToken, which reuses
 *   the SAME requireCourseAccess gate as getSignedVideoUrl and returns a signed
 *   HLS URL. For a not-yet-migrated Storage path it delegates to the existing
 *   SignedUrlVideoService, so during the background backfill BOTH providers work.
 *
 * The opaque-string seam means call sites never change: the player reads
 * Lesson.videoPath and asks videoService.getPlaybackUrl() to resolve it.
 */

import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import { SignedUrlVideoService } from "./SignedUrlVideoService";
import type { VideoService, UploadProgress } from "./VideoService";

const MUX_PATH_PREFIX = "mux:";
/** Marker returned by uploadVideo until the webhook resolves the playback id. */
const MUX_UPLOAD_PREFIX = "muxupload:";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CreateMuxUploadResponse {
  uploadUrl: string;
  uploadId: string;
}
interface MuxPlaybackTokenResponse {
  url: string;
  token: string;
  playbackId: string;
  expiresAt: number; // epoch millis
}

/** True for a stored videoPath that points at a Mux asset (vs a Storage object). */
export function isMuxPath(videoPath: string | undefined | null): boolean {
  return typeof videoPath === "string" && videoPath.startsWith(MUX_PATH_PREFIX);
}

export class MuxVideoService implements VideoService {
  /** Storage-backed fallback for lessons not yet migrated to Mux. */
  private storage = new SignedUrlVideoService();
  private cache = new Map<string, MuxPlaybackTokenResponse>();

  /**
   * @param courseId  Needed to mint a signed playback token (the gate is
   *                  course-scoped). The player passes it through.
   */
  constructor(private courseId?: string) {}

  /** Bind a courseId for playback-token requests (the player sets this). */
  forCourse(courseId: string): MuxVideoService {
    const svc = new MuxVideoService(courseId);
    return svc;
  }

  async uploadVideo(
    file: File,
    _path: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<string> {
    const create = httpsCallable<
      { corsOrigin?: string },
      CreateMuxUploadResponse
    >(functions, "createMuxUpload");
    const { data } = await create({
      corsOrigin:
        typeof window !== "undefined" ? window.location.origin : undefined,
    });

    await putWithProgress(data.uploadUrl, file, onProgress);

    // The asset/playback id is not known until Mux finishes encoding; the
    // webhook fills muxAssetId/muxPlaybackId. Persist the upload id so the
    // webhook can correlate (lesson.muxUploadId).
    return `${MUX_UPLOAD_PREFIX}${data.uploadId}`;
  }

  async getPlaybackUrl(storagePath: string): Promise<string> {
    // Not yet a Mux playback id (still on Storage, or mid-migration) → fall back
    // to the existing signed-URL service so playback is uninterrupted.
    if (!isMuxPath(storagePath)) {
      return this.storage.getPlaybackUrl(storagePath);
    }

    const cached = this.cache.get(storagePath);
    if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return cached.url;
    }

    const fn = httpsCallable<
      { videoPath: string; courseId: string },
      MuxPlaybackTokenResponse
    >(functions, "getMuxPlaybackToken");
    const { data } = await fn({
      videoPath: storagePath,
      courseId: this.courseId ?? "",
    });
    this.cache.set(storagePath, data);
    return data.url;
  }
}

/** Extract a Mux upload id from the marker uploadVideo returns. */
export function parseMuxUploadId(value: string): string | null {
  if (!value.startsWith(MUX_UPLOAD_PREFIX)) return null;
  return value.slice(MUX_UPLOAD_PREFIX.length) || null;
}

/** PUT a file to a Mux Direct Upload URL with progress, via XHR. */
function putWithProgress(
  url: string,
  file: File,
  onProgress?: (p: UploadProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress({
          bytesTransferred: e.loaded,
          totalBytes: e.total,
          pct: Math.round((e.loaded / e.total) * 100),
        });
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Mux upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Mux upload network error"));
    xhr.send(file);
  });
}
