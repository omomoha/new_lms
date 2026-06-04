/**
 * getSignedVideoUrl — Callable Cloud Function (Phase 3: hardened video delivery)
 *
 * Replaces long-lived getDownloadURL token URLs with short-lived V4 signed URLs.
 * The client's SignedUrlVideoService calls this for every playback session.
 *
 * Security:
 *  - Requires Firebase Auth.
 *  - Authorization: caller must be admin OR the course must be published and
 *    assigned to one of the caller's cohorts (same gate as Firestore lesson rules).
 *  - Storage rules deny direct client reads on videos/** — this function is the
 *    ONLY way a learner obtains a playable URL, and it expires in 2 hours.
 *
 * DEPLOYMENT PREREQUISITE (one-time, documented in README):
 *  V4 signing uses the IAM signBlob API. The function's runtime service account
 *  must hold roles/iam.serviceAccountTokenCreator on itself:
 *
 *    gcloud iam service-accounts add-iam-policy-binding \
 *      PROJECT_NUMBER-compute@developer.gserviceaccount.com \
 *      --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
 *      --role="roles/iam.serviceAccountTokenCreator" --project=PROJECT_ID
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

const URL_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface GetSignedVideoUrlRequest {
  storagePath: string; // e.g. "videos/{courseId}/{moduleId}/{file}.mp4"
}

interface GetSignedVideoUrlResponse {
  url: string;
  expiresAt: number; // epoch millis
}

const ENFORCE_APPCHECK = process.env.ENFORCE_APPCHECK === "true";

export const getSignedVideoUrl = onCall<GetSignedVideoUrlRequest>(
  { region: "us-central1", enforceAppCheck: ENFORCE_APPCHECK },
  async (request): Promise<GetSignedVideoUrlResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in to watch videos.");
    }

    const uid = request.auth.uid;
    const { storagePath } = request.data;

    // ── Validate path ────────────────────────────────────────────────────
    if (!storagePath || typeof storagePath !== "string") {
      throw new HttpsError("invalid-argument", "storagePath is required.");
    }
    // Must be a video path; no traversal tricks.
    if (!storagePath.startsWith("videos/") || storagePath.includes("..")) {
      throw new HttpsError("invalid-argument", "Invalid video path.");
    }
    const segments = storagePath.split("/");
    if (segments.length < 3) {
      throw new HttpsError("invalid-argument", "Invalid video path.");
    }
    const courseId = segments[1];

    // ── Authorize ────────────────────────────────────────────────────────
    const isAdmin = request.auth.token.role === "admin";
    if (!isAdmin) {
      const [courseSnap, userSnap] = await Promise.all([
        db.doc(`courses/${courseId}`).get(),
        db.doc(`users/${uid}`).get(),
      ]);
      if (!courseSnap.exists) {
        throw new HttpsError("not-found", "Course not found.");
      }
      const course = courseSnap.data() as {
        status?: string;
        assignedCohortIds?: string[];
      };
      const userCohorts: string[] = (userSnap.data()?.cohortIds as string[]) ?? [];
      const assigned = course.assignedCohortIds ?? [];
      const hasAccess =
        course.status === "published" &&
        assigned.some((c) => userCohorts.includes(c));
      if (!hasAccess) {
        throw new HttpsError(
          "permission-denied",
          "You do not have access to this course's videos."
        );
      }
    }

    // ── Sign ─────────────────────────────────────────────────────────────
    const file = admin.storage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError("not-found", "Video file not found.");
    }

    const expiresAt = Date.now() + URL_TTL_MS;
    try {
      const [url] = await file.getSignedUrl({
        version: "v4",
        action: "read",
        expires: expiresAt,
      });
      return { url, expiresAt };
    } catch (err) {
      console.error("getSignedUrl failed (is iam.serviceAccountTokenCreator granted?):", err);
      throw new HttpsError(
        "internal",
        "Could not generate a playback URL. Contact an administrator."
      );
    }
  }
);
