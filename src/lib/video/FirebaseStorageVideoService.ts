/**
 * FirebaseStorageVideoService
 * Implements VideoService using Firebase Cloud Storage.
 *
 * Upload: resumable upload via uploadBytesResumable (handles large files).
 * Playback: getDownloadURL returns a long-lived signed URL.
 *
 * To swap this for Mux/Bunny/Cloudflare Stream:
 *   1. Create e.g. MuxVideoService.ts implementing VideoService.
 *   2. Change the export in src/lib/video/index.ts.
 *   3. Done — no component changes needed.
 */

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import storage from "@/lib/firebase/storage";
import type { VideoService, UploadProgress } from "./VideoService";

export class FirebaseStorageVideoService implements VideoService {
  async uploadVideo(
    file: File,
    path: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<string> {
    const storageRef = ref(storage, path);
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type || "video/mp4",
    });

    return new Promise((resolve, reject) => {
      uploadTask.on(
        "state_changed",
        (snapshot) => {
          if (onProgress) {
            const pct = Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            );
            onProgress({
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: snapshot.totalBytes,
              pct,
            });
          }
        },
        (error) => reject(error),
        async () => {
          // Return the storage path (not the URL) so it can be stored in Firestore.
          // URL is resolved lazily via getPlaybackUrl().
          resolve(path);
        }
      );
    });
  }

  async getPlaybackUrl(storagePath: string): Promise<string> {
    const storageRef = ref(storage, storagePath);
    return getDownloadURL(storageRef);
  }
}
