/**
 * convertOfficeToPdf — Storage-triggered PPTX/PPT/DOC → PDF conversion.
 *
 * When an admin uploads an Office file to resources/{courseId}/{moduleId}/…,
 * this function converts it with a bundled headless LibreOffice and stores
 * the result alongside as "<original>.pdf". The client DocumentViewer checks
 * for that twin first and renders it in the paginated PDF reader — so
 * learners get page-by-page slides instead of a third-party Office embed.
 *
 * LibreOffice provisioning (same pattern as ffmpeg-static for video):
 *  - the aws-lambda-libreoffice npm package carries an 85 MB brotli archive
 *    of a stripped x86_64 LibreOffice (bin/lo.tar.br)
 *  - on cold start it is decompressed (Node's built-in zlib brotli) and
 *    untarred to /tmp/instdir; warm instances reuse it
 *  - the package's own loader is NOT used (it requires a long-removed native
 *    brotli module) — only its archive
 *
 * Failure policy: log + exit. Uploads must never break because conversion
 * failed; the viewer falls back to the Office Online / Google embed.
 *
 * Also exports backfillOfficeConversions — an admin-only callable that
 * converts files uploaded before this trigger existed (one batch per call).
 */

import { onObjectFinalized } from "firebase-functions/v2/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createBrotliDecompress } from "node:zlib";
import * as path from "node:path";
import * as tarFs from "tar-fs";
import { shouldAutoConvert, convertedPathFor, sofficeOutputName } from "./officeConvert";

if (!admin.apps.length) admin.initializeApp();

const SOFFICE = "/tmp/instdir/program/soffice";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024; // 100 MB
const CONVERT_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * X11/session/fontconfig shared libraries the Amazon-Linux LibreOffice build
 * links against but Google's runtime image lacks (production smoke test:
 * "libSM.so.6: cannot open shared object file"). CI vendors them into
 * functions/vendor-libs at deploy time; compiled code runs from /workspace/lib
 * so the vendored dir sits one level up from __dirname.
 */
const VENDOR_LIBS = path.resolve(__dirname, "..", "vendor-libs");
const VENDOR_FONTS = path.join(VENDOR_LIBS, "fonts");
const FONTCONFIG_FILE = "/tmp/lo-fonts.conf";

/** Env for soffice: vendored libs on the loader path + minimal font config. */
function sofficeEnv(): NodeJS.ProcessEnv {
  const ldParts = [VENDOR_LIBS, "/tmp/instdir/program"];
  if (process.env.LD_LIBRARY_PATH) ldParts.push(process.env.LD_LIBRARY_PATH);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: "/tmp",
    LD_LIBRARY_PATH: ldParts.join(":"),
  };
  if (!existsSync(VENDOR_LIBS)) {
    console.warn(
      "convertOfficeToPdf: vendor-libs missing — deploy via CI (which vendors " +
      "the X11/fontconfig libraries) or conversions may fail with exit 127."
    );
  }
  if (existsSync(VENDOR_FONTS)) {
    if (!existsSync(FONTCONFIG_FILE)) {
      writeFileSync(
        FONTCONFIG_FILE,
        `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">` +
        `<fontconfig><dir>${VENDOR_FONTS}</dir>` +
        `<cachedir>/tmp/fontconfig-cache</cachedir></fontconfig>`
      );
    }
    env.FONTCONFIG_FILE = FONTCONFIG_FILE;
  }
  return env;
}

/** Decompress + untar the bundled LibreOffice into /tmp (cold start only). */
async function ensureSoffice(): Promise<string> {
  if (existsSync(SOFFICE)) return SOFFICE;
  const archive = require.resolve("aws-lambda-libreoffice/bin/lo.tar.br");
  await new Promise<void>((resolve, reject) => {
    createReadStream(archive)
      .on("error", reject)
      .pipe(createBrotliDecompress())
      .on("error", reject)
      .pipe(tarFs.extract("/tmp"))
      .on("error", reject)
      .on("finish", () => resolve());
  });
  chmodSync(SOFFICE, 0o755);
  return SOFFICE;
}

/** Run soffice --convert-to pdf. Resolves on exit 0, rejects otherwise. */
function runSoffice(soffice: string, inputFile: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      soffice,
      [
        "--headless", "--invisible", "--nodefault", "--nolockcheck",
        "--nologo", "--norestore",
        "--convert-to", "pdf",
        "--outdir", outDir,
        inputFile,
      ],
      {
        env: sofficeEnv(),
        timeout: CONVERT_TIMEOUT_MS,
      }
    );
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`soffice exited ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

/** Bucket handle type as returned by admin.storage().bucket(…) — avoids a
 *  direct dependency on @google-cloud/storage (transitive via firebase-admin). */
type Bucket = ReturnType<ReturnType<typeof admin.storage>["bucket"]>;

/**
 * Convert one storage object to its PDF twin:
 * ensureSoffice → download → convert (with one retry) → upload twin → cleanup.
 *
 * Throws on failure — callers decide the failure policy (the storage trigger
 * logs and swallows; the backfill callable records it per file).
 */
async function convertOne(bucket: Bucket, name: string): Promise<void> {
  const targetPath = convertedPathFor(name);

  const workDir = `/tmp/conv_${Date.now()}`;
  const inDir = path.join(workDir, "in");
  const outDir = path.join(workDir, "out");
  mkdirSync(inDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const localIn = path.join(inDir, path.basename(name));

  try {
    const soffice = await ensureSoffice();
    await bucket.file(name).download({ destination: localIn });

    // First run after extraction occasionally fails while LibreOffice
    // builds its /tmp profile — one retry covers it.
    try {
      await runSoffice(soffice, localIn, outDir);
    } catch (firstErr) {
      console.warn("convertOfficeToPdf: first soffice run failed, retrying:", firstErr);
      await runSoffice(soffice, localIn, outDir);
    }

    const produced = path.join(outDir, sofficeOutputName(name));
    if (!existsSync(produced)) {
      throw new Error(`soffice reported success but ${produced} is missing`);
    }

    await bucket.upload(produced, {
      destination: targetPath,
      metadata: {
        contentType: "application/pdf",
        cacheControl: "private, max-age=300",
        metadata: { convertedFrom: name, converter: "libreoffice-bundled" },
      },
    });
    console.log(`convertOfficeToPdf: ${name} → ${targetPath}`);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export const convertOfficeToPdf = onObjectFinalized(
  {
    // Storage triggers MUST run in the bucket's region (us-east1 — see
    // transcodeVideo). 2 GiB + 2 cpu: LibreOffice is hungry on cold start.
    region: "us-east1",
    memory: "2GiB",
    cpu: 2,
    timeoutSeconds: 540,
    concurrency: 1, // one soffice per instance — it is not concurrency-safe
  },
  async (event) => {
    const name = event.data.name ?? "";
    if (!shouldAutoConvert(name)) return;

    const size = Number(event.data.size ?? 0);
    if (size > MAX_SOURCE_BYTES) {
      console.warn(`convertOfficeToPdf: ${name} is ${size}B — over the limit, skipping.`);
      return;
    }

    const bucket = admin.storage().bucket(event.data.bucket);
    const targetPath = convertedPathFor(name);

    // Idempotency: finalize events can re-fire (overwrites, retries)
    const [twinExists] = await bucket.file(targetPath).exists();
    if (twinExists) {
      console.log(`convertOfficeToPdf: ${targetPath} already exists, skipping.`);
      return;
    }

    try {
      await convertOne(bucket, name);
    } catch (err) {
      // Never throw: a failed conversion must not retry-storm or affect the
      // upload. The viewer falls back to the Office/Google embeds.
      console.error(`convertOfficeToPdf failed for ${name}:`, err);
    }
  }
);

// ─── Backfill callable ───────────────────────────────────────────────────────

/** Files converted per backfill invocation — sequential, so 5 keeps a worst
 *  case (~6 min/file with retry) inside the 540 s budget for typical decks. */
const BACKFILL_BATCH_SIZE = 5;
/** Error strings returned to the client are capped; full errors are logged. */
const ERROR_SNIPPET_CHARS = 200;

interface BackfillResponse {
  totalCandidates: number;
  converted: string[];
  failed: Array<{ name: string; error: string }>;
  remaining: number;
}

/**
 * backfillOfficeConversions — admin-only callable that converts legacy
 * PPTX/PPT/DOC lesson files uploaded BEFORE the storage trigger existed
 * (finalize events only fire on new uploads).
 *
 * One bucket listing yields both the candidates and their twins, so no
 * per-file exists() round-trips. Converts up to BACKFILL_BATCH_SIZE files
 * sequentially per invocation; the client re-invokes for the next batch.
 * Failed files are NOT counted in `remaining` for this response, but they
 * stay twin-less, so they reappear as candidates on the next invocation.
 */
export const backfillOfficeConversions = onCall(
  {
    // Same region/shape as the trigger: bucket lives in us-east1 and
    // LibreOffice wants the memory; soffice is not concurrency-safe.
    region: "us-east1",
    memory: "2GiB",
    cpu: 2,
    timeoutSeconds: 540,
    concurrency: 1,
    enforceAppCheck: process.env.ENFORCE_APPCHECK === "true",
  },
  async (request): Promise<BackfillResponse> => {
    if (request.auth?.token?.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin access required.");
    }

    const bucket = admin.storage().bucket();
    const [files] = await bucket.getFiles({ prefix: "resources/" });
    const allNames = new Set<string>(files.map((f) => f.name));
    const candidates = [...allNames].filter(
      (n) => shouldAutoConvert(n) && !allNames.has(convertedPathFor(n))
    );

    const batch = candidates.slice(0, BACKFILL_BATCH_SIZE);
    const converted: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];

    for (const name of batch) {
      try {
        await convertOne(bucket, name);
        converted.push(name);
      } catch (err) {
        console.error(`backfillOfficeConversions failed for ${name}:`, err);
        const message = err instanceof Error ? err.message : String(err);
        failed.push({ name, error: message.slice(0, ERROR_SNIPPET_CHARS) });
      }
    }

    const result: BackfillResponse = {
      totalCandidates: candidates.length,
      converted,
      failed,
      remaining: candidates.length - batch.length,
    };
    console.log(
      `backfillOfficeConversions: ${converted.length} converted, ` +
        `${failed.length} failed, ${result.remaining} remaining ` +
        `(of ${result.totalCandidates} candidates).`
    );
    return result;
  }
);
