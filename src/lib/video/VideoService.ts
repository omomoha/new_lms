/**
 * VideoService — abstraction layer for video upload and playback.
 *
 * ARCHITECTURE NOTE (read before modifying):
 * ------------------------------------------
 * This interface is deliberately thin so that the underlying transport can be
 * swapped without touching any UI component.
 *
 * Current implementation: FirebaseStorageVideoService
 *   - Stores videos as raw MP4/WebM in Firebase Storage.
 *   - Playback is a direct signed/public download URL served via HTML5 <video>.
 *   - Simple but not adaptive — no HLS/DASH, no CDN transcoding.
 *
 * Future implementation (Phase 2+): e.g. MuxVideoService / BunnyVideoService
 *   - Implement the same VideoService interface below.
 *   - Replace the export in src/lib/video/index.ts.
 *   - All components that import from `@/lib/video` get the new behaviour
 *     with zero changes to call sites.
 *
 * The key seam is:
 *   uploadVideo  → returns a storagePath (opaque string, provider-specific)
 *   getPlaybackUrl → converts storagePath → a URL the <video> src can consume
 *
 * This means the storagePath stored in Firestore Lesson.videoPath never needs
 * to change format — only the resolver changes.
 */

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  pct: number; // 0–100
}

export interface VideoService {
  /**
   * Upload a video file to remote storage.
   * @param file       The File object from an <input type="file">
   * @param path       Desired storage path, e.g. "videos/courseId/lessonId.mp4"
   * @param onProgress Optional progress callback
   * @returns          The storagePath to persist in Firestore (Lesson.videoPath)
   */
  uploadVideo(
    file: File,
    path: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<string>;

  /**
   * Convert a storagePath (from Firestore) into a playable URL.
   * Called at render time — result feeds directly into <video src="...">.
   */
  getPlaybackUrl(storagePath: string): Promise<string>;
}
