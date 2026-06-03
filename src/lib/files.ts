/**
 * FileService — upload and retrieve document/slide/PDF resources in Firebase Storage.
 *
 * Mirrors the VideoService pattern so the same upload-UX utilities work for
 * non-video lesson types (slides, doc, lab).
 *
 * Accepted MIME types / extensions:
 *   slides → .pptx, .ppt, .pdf
 *   doc    → .docx, .doc, .pdf
 *   lab    → .pdf, .docx, .doc
 *
 * Storage path convention:
 *   resources/{courseId}/{moduleId}/{timestamp}_{filename}
 */

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import storage from "@/lib/firebase/storage";

export interface UploadProgress {
  bytesTransferred: number;
  totalBytes: number;
  pct: number; // 0–100
}

/**
 * Upload a document / slide / PDF resource to Firebase Storage.
 * @param file        The File object from an <input type="file">
 * @param path        Desired storage path, e.g. "resources/courseId/moduleId/file.pdf"
 * @param onProgress  Optional progress callback
 * @returns           The storage path to persist in Firestore (Lesson.filePath)
 */
export async function uploadResource(
  file: File,
  path: string,
  onProgress?: (progress: UploadProgress) => void
): Promise<string> {
  const storageRef = ref(storage, path);
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type || "application/octet-stream",
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
      () => {
        // Return storage path (not URL) — URL is resolved lazily via getResourceUrl()
        resolve(path);
      }
    );
  });
}

/**
 * Convert a storage path (from Firestore Lesson.filePath) into a download URL.
 * Called at render time — result feeds into <iframe src="..."> or an <a> href.
 */
export async function getResourceUrl(storagePath: string): Promise<string> {
  const storageRef = ref(storage, storagePath);
  return getDownloadURL(storageRef);
}

/** Extensions accepted per lesson type, used for <input accept="..."> */
export const ACCEPT_BY_TYPE: Record<string, string> = {
  slides: ".pptx,.ppt,.pdf",
  doc: ".docx,.doc,.pdf",
  lab: ".pdf,.docx,.doc",
};

/** Return true if the path/URL points to a PDF file.
 *  Strips query strings and fragments before checking the extension. */
export function isPdf(filename: string): boolean {
  try {
    // If it looks like a URL, parse it to strip query/fragment
    const pathname = new URL(filename).pathname;
    return pathname.toLowerCase().endsWith(".pdf");
  } catch {
    // Not a valid URL — treat as a plain path/filename
    return filename.split("?")[0].toLowerCase().endsWith(".pdf");
  }
}
