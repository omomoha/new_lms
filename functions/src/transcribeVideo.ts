/**
 * transcribeVideo — Storage-triggered automatic video transcription.
 *
 * When an admin uploads a lesson video under videos/**, transcribe it with
 * Google Cloud Speech-to-Text v2 (batchRecognize, REST) and store the plain
 * text on the matching lesson document's `transcript` field.
 *
 * FEATURE FLAG: the function is a no-op unless TRANSCRIBE_VIDEOS === "true".
 * The Speech API costs money — the project owner must opt in explicitly
 * (enable speech.googleapis.com AND set the env var).
 *
 * Guards:
 *  - Only objects under videos/ with a known video extension
 *    (.mp4 / .m4v / .mov / .webm).
 *  - Never process transcode output variants ("*_720p.mp4" — see
 *    transcodeVideo.ts VARIANT_SUFFIX) so each source is transcribed once.
 *  - Source must be <= 200 MB.
 *  - Idempotency: skip if the matching lesson already has a non-empty
 *    transcript (finalize events can re-fire on overwrites/retries).
 *
 * Lesson lookup: collectionGroup("lessons").where("videoPath", "==", name).
 * Requires a collection-group equality index on lessons.videoPath. If no
 * lesson references the object yet (docs may be written after upload), we
 * log and exit — an acceptable miss; we do not retry-loop.
 *
 * Failure policy: NOTHING throws out of the handler. Uploads and transcodes
 * must never be affected by a transcription failure.
 */

import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as admin from "firebase-admin";
import * as path from "node:path";
import { GoogleAuth } from "google-auth-library";

if (!admin.apps.length) admin.initializeApp();

/** Must stay in sync with VARIANT_SUFFIX in transcodeVideo.ts. */
const TRANSCODE_VARIANT_SUFFIX = "_720p.mp4";
const VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".mov", ".webm"]);
const MAX_SOURCE_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_TRANSCRIPT_CHARS = 100_000;
const POLL_INTERVAL_MS = 10_000; // poll the LRO every 10 s …
const POLL_DEADLINE_MS = 7 * 60 * 1000; // … for up to ~7 min

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

/** Log the disabled-flag message only once per instance, not per event. */
let loggedDisabled = false;

// ── Minimal typings for the Speech v2 REST surfaces we read ──────────────

interface SpeechStatus {
  code?: number;
  message?: string;
}

interface SpeechRecognitionAlternative {
  transcript?: string;
}

interface SpeechRecognitionResult {
  alternatives?: SpeechRecognitionAlternative[];
}

interface BatchRecognizeResults {
  results?: SpeechRecognitionResult[];
}

interface BatchRecognizeFileResult {
  error?: SpeechStatus;
  /** Current inline shape. */
  transcript?: BatchRecognizeResults;
  /** Older inline shape, kept for compatibility. */
  inlineResult?: { transcript?: BatchRecognizeResults };
}

interface BatchRecognizeResponse {
  results?: Record<string, BatchRecognizeFileResult>;
}

interface SpeechOperation {
  name?: string;
  done?: boolean;
  error?: SpeechStatus;
  response?: BatchRecognizeResponse;
}

/** Shape of gaxios/google-auth-library HTTP errors we inspect. */
interface HttpErrorLike {
  response?: {
    status?: number;
    data?: unknown;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True if the error is a 403 from a disabled speech.googleapis.com API. */
function isSpeechApiDisabled(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as HttpErrorLike;
  if (e.response?.status !== 403) return false;
  try {
    const body = JSON.stringify(e.response?.data ?? "");
    return (
      body.includes("SERVICE_DISABLED") ||
      body.includes("has not been used") ||
      body.includes("is disabled")
    );
  } catch {
    return true; // 403 from the speech endpoint — treat as disabled-ish
  }
}

/** Flatten the inline batchRecognize results into capped plain text. */
function assembleTranscript(response: BatchRecognizeResponse): string {
  const parts: string[] = [];
  for (const fileResult of Object.values(response.results ?? {})) {
    if (fileResult.error?.message) {
      console.warn(
        `transcribeVideo: per-file Speech error: ${fileResult.error.message}`
      );
    }
    const results =
      fileResult.transcript?.results ??
      fileResult.inlineResult?.transcript?.results ??
      [];
    for (const result of results) {
      const text = result.alternatives?.[0]?.transcript?.trim();
      if (text) parts.push(text);
    }
  }
  return parts.join("\n").slice(0, MAX_TRANSCRIPT_CHARS);
}

export const transcribeVideo = onObjectFinalized(
  {
    // Storage triggers MUST run in the bucket's region (us-east1 — see
    // transcodeVideo). batchRecognize does the heavy lifting server-side,
    // so 1 GiB is plenty; 540 s covers the ~7 min LRO poll budget.
    region: "us-east1",
    memory: "1GiB",
    timeoutSeconds: 540,
    concurrency: 1,
  },
  async (event) => {
    try {
      // ── Feature flag — default OFF, the Speech API costs money ────────
      if (process.env.TRANSCRIBE_VIDEOS !== "true") {
        if (!loggedDisabled) {
          loggedDisabled = true;
          console.log(
            "transcribeVideo: disabled (TRANSCRIBE_VIDEOS !== \"true\") — " +
              "enable speech.googleapis.com and set TRANSCRIBE_VIDEOS=true to turn on."
          );
        }
        return;
      }

      const objectName = event.data.name ?? "";
      const bucketName = event.data.bucket;
      const size = Number(event.data.size ?? 0);

      // ── Guards ─────────────────────────────────────────────────────────
      if (!objectName.startsWith("videos/")) return;

      const ext = path.extname(objectName).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) {
        console.log(
          `transcribeVideo: skipping ${objectName} — "${ext}" is not a video extension.`
        );
        return;
      }
      // Never transcribe transcodeVideo's own 720p output — the source
      // object already covers that content.
      if (objectName.endsWith(TRANSCODE_VARIANT_SUFFIX)) {
        console.log(
          `transcribeVideo: skipping ${objectName} — ${TRANSCODE_VARIANT_SUFFIX} transcode variant.`
        );
        return;
      }
      if (size > MAX_SOURCE_BYTES) {
        console.log(
          `transcribeVideo: skipping ${objectName} — ${size} B exceeds the ${MAX_SOURCE_BYTES} B limit.`
        );
        return;
      }

      // ── Find the lesson that references this video ─────────────────────
      // Needs a collection-group index: lessons.videoPath (equality).
      const db = admin.firestore();
      const snap = await db
        .collectionGroup("lessons")
        .where("videoPath", "==", objectName)
        .limit(1)
        .get();
      if (snap.empty) {
        // Lesson docs may be written after the upload — acceptable miss.
        console.log(
          `transcribeVideo: no lesson with videoPath ${objectName} yet — skipping (no retry).`
        );
        return;
      }
      const lessonRef = snap.docs[0].ref;

      // ── Idempotency: never overwrite an existing transcript ───────────
      const existing = snap.docs[0].get("transcript") as unknown;
      if (typeof existing === "string" && existing.trim().length > 0) {
        console.log(
          `transcribeVideo: ${lessonRef.path} already has a transcript — skipping.`
        );
        return;
      }

      const projectId = process.env.GCLOUD_PROJECT;
      if (!projectId) {
        console.error("transcribeVideo: GCLOUD_PROJECT is not set — skipping.");
        return;
      }

      // ── Kick off Speech-to-Text v2 batchRecognize ──────────────────────
      const client = await auth.getClient();
      const recognizerParent = `projects/${projectId}/locations/global/recognizers/_`;
      console.log(
        `transcribeVideo: starting batchRecognize for gs://${bucketName}/${objectName}.`
      );

      let operation: SpeechOperation;
      try {
        const start = await client.request<SpeechOperation>({
          url: `https://speech.googleapis.com/v2/${recognizerParent}:batchRecognize`,
          method: "POST",
          data: {
            files: [{ uri: `gs://${bucketName}/${objectName}` }],
            config: {
              autoDecodingConfig: {},
              languageCodes: ["en-US"],
              model: "latest_long",
              features: { enableAutomaticPunctuation: true },
            },
            recognitionOutputConfig: { inlineResponseConfig: {} },
          },
        });
        operation = start.data;
      } catch (err) {
        if (isSpeechApiDisabled(err)) {
          console.error(
            "transcribeVideo: Speech API disabled — enable speech.googleapis.com and set TRANSCRIBE_VIDEOS=true."
          );
        } else {
          console.error(
            `transcribeVideo: batchRecognize request failed for ${objectName}:`,
            err
          );
        }
        return;
      }

      const operationName = operation.name;
      if (!operationName) {
        console.error(
          `transcribeVideo: batchRecognize returned no operation name for ${objectName} — skipping.`
        );
        return;
      }

      // ── Poll the long-running operation (10 s interval, ~7 min cap) ───
      const deadline = Date.now() + POLL_DEADLINE_MS;
      while (!operation.done) {
        if (Date.now() >= deadline) {
          console.warn(
            `transcribeVideo: operation ${operationName} did not finish within ` +
              `${POLL_DEADLINE_MS / 1000} s for ${objectName} — giving up (no retry).`
          );
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        const poll = await client.request<SpeechOperation>({
          url: `https://speech.googleapis.com/v2/${operationName}`,
          method: "GET",
        });
        operation = poll.data;
      }

      if (operation.error) {
        console.error(
          `transcribeVideo: Speech operation failed for ${objectName}: ` +
            `${operation.error.code ?? "?"} ${operation.error.message ?? ""}`
        );
        return;
      }

      // ── Assemble + persist ─────────────────────────────────────────────
      const transcript = assembleTranscript(operation.response ?? {});
      if (!transcript) {
        console.warn(
          `transcribeVideo: empty transcript for ${objectName} (no speech detected?) — nothing written.`
        );
        return;
      }

      // Re-check inside a transaction so a concurrent writer's transcript
      // is never clobbered — write only if still empty/absent.
      const written = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(lessonRef);
        const current = fresh.get("transcript") as unknown;
        if (typeof current === "string" && current.trim().length > 0) {
          return false;
        }
        tx.update(lessonRef, { transcript });
        return true;
      });

      if (written) {
        console.log(
          `transcribeVideo: wrote ${transcript.length}-char transcript to ${lessonRef.path} for ${objectName}.`
        );
      } else {
        console.log(
          `transcribeVideo: ${lessonRef.path} gained a transcript mid-flight — left untouched.`
        );
      }
    } catch (err) {
      // Catch-all: a transcription failure must never affect uploads or
      // transcodes, and must never retry-storm.
      if (isSpeechApiDisabled(err)) {
        console.error(
          "transcribeVideo: Speech API disabled — enable speech.googleapis.com and set TRANSCRIBE_VIDEOS=true."
        );
      } else {
        console.error(`transcribeVideo: unexpected failure:`, err);
      }
    }
  }
);
