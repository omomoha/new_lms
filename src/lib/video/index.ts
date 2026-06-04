/**
 * Canonical export for VideoService.
 * Swap the implementation class here to change video provider globally.
 */
import { SignedUrlVideoService } from "./SignedUrlVideoService";
import type { VideoService } from "./VideoService";

// Phase 3: playback now uses short-lived signed URLs from the
// getSignedVideoUrl Cloud Function (see SignedUrlVideoService).
export const videoService: VideoService = new SignedUrlVideoService();
export type { VideoService, UploadProgress } from "./VideoService";
