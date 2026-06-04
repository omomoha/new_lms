/**
 * SignedUrlVideoService — Phase 3 hardened video delivery.
 *
 * Upload: unchanged (resumable client upload; Storage rules allow admin write).
 * Playback: calls the getSignedVideoUrl Cloud Function, which authorizes the
 * caller (admin OR enrolled cohort) and returns a short-lived (2 h) V4 signed
 * URL. Storage rules deny direct client reads on videos/**, so this function
 * is the only way to obtain a playable URL — no more long-lived token URLs.
 *
 * URLs are cached in-memory and refreshed 5 minutes before expiry.
 */

import { httpsCallable } from "firebase/functions";
import functions from "@/lib/firebase/functions";
import { FirebaseStorageVideoService } from "./FirebaseStorageVideoService";
import type { VideoService } from "./VideoService";

interface SignedUrlResponse {
  url: string;
  expiresAt: number; // epoch millis
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class SignedUrlVideoService implements VideoService {
  private uploader = new FirebaseStorageVideoService();
  private cache = new Map<string, SignedUrlResponse>();

  uploadVideo: VideoService["uploadVideo"] = (file, path, onProgress) =>
    this.uploader.uploadVideo(file, path, onProgress);

  async getPlaybackUrl(storagePath: string): Promise<string> {
    const cached = this.cache.get(storagePath);
    if (cached && cached.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return cached.url;
    }
    const fn = httpsCallable<{ storagePath: string }, SignedUrlResponse>(
      functions,
      "getSignedVideoUrl"
    );
    const { data } = await fn({ storagePath });
    this.cache.set(storagePath, data);
    return data.url;
  }
}
