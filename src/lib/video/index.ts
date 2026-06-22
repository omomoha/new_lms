/**
 * Canonical export for VideoService.
 *
 * DEFAULT (flag OFF): SignedUrlVideoService — playback via short-lived V4 signed
 * URLs from the getSignedVideoUrl Cloud Function (Phase 3, unchanged).
 *
 * Phase 4 — Workstream C: when the `muxVideo` feature flag (settings/features) is
 * ON, getVideoService() returns a MuxVideoService instead, so playback resolves
 * via signed Mux/HLS tokens. The flag defaults to false, so a prod deploy with
 * the flag unset behaves EXACTLY as before — no Mux calls, no behavior change.
 *
 * The static `videoService` singleton (SignedUrl) is kept for the upload path and
 * any non-flag-aware call site. Playback in the player goes through
 * getVideoService(courseId), which is async because it reads the flag.
 */
import { SignedUrlVideoService } from "./SignedUrlVideoService";
import { MuxVideoService } from "./MuxVideoService";
import { getFeatureFlag } from "@/lib/featureFlags";
import type { VideoService } from "./VideoService";

// Default, flag-independent instance (unchanged behavior).
export const videoService: VideoService = new SignedUrlVideoService();

/**
 * Resolve the active VideoService for a course, honoring the `muxVideo` flag.
 * Falls back to the default SignedUrlVideoService on any error or when the flag
 * is off. `courseId` is needed because Mux signed-playback tokens are gated
 * per-course (same requireCourseAccess gate as getSignedVideoUrl).
 */
export async function getVideoService(courseId?: string): Promise<VideoService> {
  try {
    const muxOn = await getFeatureFlag("muxVideo");
    if (muxOn) return new MuxVideoService(courseId);
  } catch {
    // fall through to default
  }
  return videoService;
}

export { MuxVideoService } from "./MuxVideoService";
export type { VideoService, UploadProgress } from "./VideoService";
