/**
 * transcodeVideo — Storage-triggered Cloud Function (2nd gen)
 *
 * When an admin uploads a lesson video under videos/**, generate a 720p
 * H.264 MP4 variant alongside the source so the player can offer a quality
 * choice (source ≈1080p vs 720p).
 *
 * Variant naming convention (the client depends on EXACTLY this):
 *   strip the file extension from the source path, append "_720p.mp4".
 *   videos/c1/m1/171234_intro.mov → videos/c1/m1/171234_intro_720p.mp4
 *
 * Guards:
 *  - Only objects under videos/ with a video/* contentType.
 *  - Never re-process our own output (names ending in "_720p.mp4") —
 *    CRITICAL to avoid an infinite trigger loop.
 *  - Skip if the variant already exists.
 *  - Skip if the source is already <= 720p tall (no upscaling).
 *
 * Failures are caught and logged — never thrown unhandled. Temp files are
 * always cleaned up in finally.
 */

import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as admin from "firebase-admin";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { randomUUID } from "crypto";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import ffmpeg from "fluent-ffmpeg";

if (!admin.apps.length) admin.initializeApp();

// Point fluent-ffmpeg at the bundled static binaries.
if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const VARIANT_SUFFIX = "_720p.mp4";
const TARGET_HEIGHT = 720;

/** videos/c1/m1/intro.mov → videos/c1/m1/intro_720p.mp4 */
function variantPathFor(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  const base = ext ? sourcePath.slice(0, -ext.length) : sourcePath;
  return `${base}${VARIANT_SUFFIX}`;
}

/** ffprobe the local file and return the video stream height (or null). */
function probeHeight(localPath: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(localPath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      const videoStream = (data.streams ?? []).find(
        (s) => s.codec_type === "video"
      );
      resolve(videoStream?.height ?? null);
    });
  });
}

/** Run the ffmpeg transcode to 720p H.264 MP4. */
function transcodeTo720p(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .audioBitrate("128k")
      .outputOptions([
        "-vf",
        `scale=-2:${TARGET_HEIGHT}`, // height 720, even width, keep aspect
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-movflags",
        "+faststart",
      ])
      .format("mp4")
      .on("start", (cmd) => console.log(`transcodeVideo: ffmpeg started: ${cmd}`))
      .on("error", (err) => reject(err))
      .on("end", () => resolve())
      .save(outputPath);
  });
}

function safeUnlink(p: string | null): void {
  if (!p) return;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (err) {
    console.error(`transcodeVideo: failed to clean up temp file ${p}:`, err);
  }
}

export const transcodeVideo = onObjectFinalized(
  {
    // Storage triggers MUST run in the bucket's region. This project's default
    // bucket is in us-east1 (callables stay in us-central1 — that's fine).
    region: "us-east1",
    memory: "2GiB",
    cpu: 2,
    timeoutSeconds: 540,
    concurrency: 1,
  },
  async (event) => {
    const objectPath = event.data.name ?? "";
    const contentType = event.data.contentType ?? "";

    // ── Guards ───────────────────────────────────────────────────────────
    if (!objectPath.startsWith("videos/")) {
      console.log(`transcodeVideo: skipping ${objectPath} — not under videos/.`);
      return;
    }
    if (!contentType.startsWith("video/")) {
      console.log(
        `transcodeVideo: skipping ${objectPath} — contentType "${contentType}" is not video/*.`
      );
      return;
    }
    // CRITICAL: never process our own output, or we trigger ourselves forever.
    if (objectPath.endsWith(VARIANT_SUFFIX)) {
      console.log(
        `transcodeVideo: skipping ${objectPath} — already a ${VARIANT_SUFFIX} variant.`
      );
      return;
    }

    const variantPath = variantPathFor(objectPath);
    const bucket = admin.storage().bucket(event.data.bucket);

    let tmpSource: string | null = null;
    let tmpOutput: string | null = null;

    try {
      const [variantExists] = await bucket.file(variantPath).exists();
      if (variantExists) {
        console.log(
          `transcodeVideo: skipping ${objectPath} — variant ${variantPath} already exists.`
        );
        return;
      }

      // ── Download source ──────────────────────────────────────────────
      const uid = randomUUID();
      const sourceExt = path.extname(objectPath) || ".video";
      tmpSource = path.join(os.tmpdir(), `transcode-src-${uid}${sourceExt}`);
      tmpOutput = path.join(os.tmpdir(), `transcode-out-${uid}.mp4`);

      console.log(`transcodeVideo: downloading ${objectPath} to ${tmpSource}.`);
      await bucket.file(objectPath).download({ destination: tmpSource });

      // ── Probe — skip if already <= 720p (no upscaling) ───────────────
      const height = await probeHeight(tmpSource);
      if (height === null) {
        console.error(
          `transcodeVideo: ${objectPath} — could not determine video height; skipping.`
        );
        return;
      }
      if (height <= TARGET_HEIGHT) {
        console.log(
          `transcodeVideo: skipping ${objectPath} — source height ${height} <= ${TARGET_HEIGHT}, not upscaling.`
        );
        return;
      }

      // ── Transcode ────────────────────────────────────────────────────
      console.log(
        `transcodeVideo: transcoding ${objectPath} (height ${height}) → ${variantPath}.`
      );
      await transcodeTo720p(tmpSource, tmpOutput);

      // ── Upload variant ───────────────────────────────────────────────
      await bucket.upload(tmpOutput, {
        destination: variantPath,
        metadata: {
          contentType: "video/mp4",
          metadata: {
            transcodedFrom: objectPath,
            variant: "720p",
          },
        },
      });
      console.log(
        `transcodeVideo: uploaded 720p variant for ${objectPath} at ${variantPath}.`
      );
    } catch (err) {
      // Never throw unhandled — log and exit so the event is not retried
      // into a crash loop and tmp files still get cleaned up.
      console.error(`transcodeVideo: failed for ${objectPath}:`, err);
    } finally {
      safeUnlink(tmpSource);
      safeUnlink(tmpOutput);
    }
  }
);
