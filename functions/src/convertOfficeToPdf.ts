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
 */

import { onObjectFinalized } from "firebase-functions/v2/storage";
import * as admin from "firebase-admin";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, chmodSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createBrotliDecompress } from "node:zlib";
import * as path from "node:path";
import * as tarFs from "tar-fs";
import { shouldAutoConvert, convertedPathFor, sofficeOutputName } from "./officeConvert";

if (!admin.apps.length) admin.initializeApp();

const SOFFICE = "/tmp/instdir/program/soffice";
const MAX_SOURCE_BYTES = 100 * 1024 * 1024; // 100 MB
const CONVERT_TIMEOUT_MS = 6 * 60 * 1000;

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
        env: {
          ...process.env,
          HOME: "/tmp",
        },
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
    } catch (err) {
      // Never throw: a failed conversion must not retry-storm or affect the
      // upload. The viewer falls back to the Office/Google embeds.
      console.error(`convertOfficeToPdf failed for ${name}:`, err);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
);
