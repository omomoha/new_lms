/**
 * Certificates — Phase 3
 *
 * Auto-designed, auto-issued, auto-distributed completion certificates.
 *
 * Exports:
 *  - issueCertificate     (callable)  — learner requests their certificate on demand
 *  - autoIssueCertificate (triggers)  — fires when an enrollment reaches 100% or a
 *                                       post-assessment is passed; issues + emails
 *  - previewCertificate   (callable)  — admin-only: renders a sample PDF with the
 *                                       current template so admins can check design
 *
 * Design / template resolution (admin-controllable):
 *  1. Course-level override:  courses/{id}.certTemplatePath (+ certTemplateTextColor)
 *  2. Global default:         settings/certificate { templatePath, textColor }
 *  3. Built-in branded design (deep green / moss, no upload needed)
 *
 * A template is a full-page A4-landscape PNG or JPG (842×595 pt, i.e. any
 * 1.414:1 landscape image). The function draws it as the page background and
 * overlays: learner name, course title, issue date, certificate ID, verify URL.
 * textColor "light" renders overlay text in white/paper for dark backgrounds.
 *
 * Verification trust chain:
 *  - Completion is recomputed server-side from progress docs (client-writable
 *    enrollments.progressPct is never trusted).
 *  - If the course has a post-assessment, a passed attempt is required.
 *  - certificates/{certId} is publicly get-able → /verify/[certId] page.
 *
 * Distribution:
 *  - PDF stored at certificates/{certId}.pdf (Storage; no public read — links
 *    are short-lived V4 signed URLs).
 *  - On auto-issue, an email is written to the mail/ collection (Trigger Email
 *    extension) with a 7-day download link + the permanent verify link.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten, onDocumentCreated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { PDFDocument, PDFFont, PDFImage, StandardFonts, rgb, degrees } from "pdf-lib";
import { randomBytes } from "node:crypto";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

const DOWNLOAD_TTL_MS = 60 * 60 * 1000; // 1 h link for in-app download
const EMAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 d link for the email (V4 max)
const ENFORCE_APPCHECK = process.env.ENFORCE_APPCHECK === "true";

// ── Brand palette (matches tailwind config) ──────────────────────────────────
const DEEP_GREEN = rgb(0x13 / 255, 0x40 / 255, 0x3a / 255);
const MOSS = rgb(0x8f / 255, 0xb8 / 255, 0x5c / 255);
const PAPER = rgb(0xf5 / 255, 0xf7 / 255, 0xf4 / 255);
const INK = rgb(0x1e / 255, 0x30 / 255, 0x2c / 255);
const MUTED = rgb(0x5e / 255, 0x6e / 255, 0x69 / 255);

/** Escape a string for safe interpolation into email HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strip CR/LF so user-influenced strings can't inject email headers. */
function stripNewlines(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

function newCertId(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ0123456789"; // unambiguous
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += alphabet[bytes[i] % alphabet.length];
    if (i === 3) s += "-";
  }
  return `AND-${s}`;
}

// ── Template resolution ──────────────────────────────────────────────────────

interface TemplateConfig {
  templatePath: string | null; // Storage path to PNG/JPG background, or null = built-in
  textColor: "dark" | "light";
  signaturePath: string | null;   // Storage path to a PNG/JPG signature image
  signatoryName: string | null;   // e.g. "Jane Doe"
  signatoryTitle: string | null;  // e.g. "Director of Learning, Andela"
}

async function resolveTemplate(courseId: string): Promise<TemplateConfig> {
  const courseSnap = await db.doc(`courses/${courseId}`).get();
  const course = courseSnap.data() ?? {};
  const settingsSnap = await db.doc("settings/certificate").get();
  const settings = settingsSnap.data() ?? {};

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  // Course-level values win; global settings fill the gaps.
  const templatePath = str(course.certTemplatePath) ?? str(settings.templatePath);
  const textColor =
    (str(course.certTemplatePath) ? course.certTemplateTextColor : settings.textColor) === "light"
      ? ("light" as const)
      : ("dark" as const);

  return {
    templatePath,
    textColor,
    signaturePath: str(course.certSignaturePath) ?? str(settings.signaturePath),
    signatoryName: str(course.certSignatoryName) ?? str(settings.signatoryName),
    signatoryTitle: str(course.certSignatoryTitle) ?? str(settings.signatoryTitle),
  };
}

// ── PDF builder ──────────────────────────────────────────────────────────────

interface CertContent {
  learnerName: string;
  courseTitle: string;
  certId: string;
  issuedDate: string;
  verifyUrl: string;
  /** Preview renders a SAMPLE watermark note instead of a verify link. */
  isPreview?: boolean;
}

function fitSize(font: PDFFont, text: string, startSize: number, maxWidth: number, minSize: number): number {
  let size = startSize;
  while (font.widthOfTextAtSize(text, size) > maxWidth && size > minSize) size -= 2;
  return size;
}

async function buildCertificatePdf(
  content: CertContent,
  template: TemplateConfig
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]); // A4 landscape
  const { width, height } = page.getSize();
  const cx = width / 2;

  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let primary = DEEP_GREEN; // name
  let body = INK;           // course title
  let muted = MUTED;        // labels / footer

  if (template.templatePath) {
    // ── Admin-uploaded background ────────────────────────────────────────
    const [bytes] = await admin.storage().bucket().file(template.templatePath).download();
    const lower = template.templatePath.toLowerCase();
    let image: PDFImage;
    if (lower.endsWith(".png")) {
      image = await pdf.embedPng(bytes);
    } else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
      image = await pdf.embedJpg(bytes);
    } else {
      throw new HttpsError("failed-precondition", "Certificate template must be a PNG or JPG image.");
    }
    page.drawImage(image, { x: 0, y: 0, width, height });

    if (template.textColor === "light") {
      primary = PAPER;
      body = PAPER;
      muted = rgb(0.85, 0.89, 0.86);
    }
  } else {
    // ── Built-in branded design ──────────────────────────────────────────
    page.drawRectangle({ x: 0, y: 0, width, height, color: PAPER });
    page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: DEEP_GREEN, borderWidth: 2 });
    page.drawRectangle({ x: 32, y: 32, width: width - 64, height: height - 64, borderColor: MOSS, borderWidth: 1 });
    page.drawRectangle({ x: 32, y: height - 120, width: width - 64, height: 88, color: DEEP_GREEN });
    page.drawSquare({ x: cx, y: height - 86, size: 14, color: MOSS, rotate: degrees(45) });
    page.drawText("ANDELA LEARN", {
      x: cx - sansBold.widthOfTextAtSize("ANDELA LEARN", 14) / 2,
      y: height - 64, size: 14, font: sansBold, color: PAPER,
    });
    const sub = "CERTIFICATE OF COMPLETION";
    page.drawText(sub, {
      x: cx - sans.widthOfTextAtSize(sub, 10) / 2,
      y: height - 106, size: 10, font: sans, color: MOSS,
    });
  }

  // ── Overlay text (drawn for both built-in and uploaded templates) ──────
  const line1 = "This certifies that";
  page.drawText(line1, {
    x: cx - serifItalic.widthOfTextAtSize(line1, 16) / 2,
    y: height - 190, size: 16, font: serifItalic, color: muted,
  });

  const nameSize = fitSize(serif, content.learnerName, 40, width - 200, 18);
  page.drawText(content.learnerName, {
    x: cx - serif.widthOfTextAtSize(content.learnerName, nameSize) / 2,
    y: height - 245, size: nameSize, font: serif, color: primary,
  });

  page.drawLine({
    start: { x: cx - 180, y: height - 262 },
    end: { x: cx + 180, y: height - 262 },
    thickness: 1, color: MOSS,
  });

  const line2 = "has successfully completed the course";
  page.drawText(line2, {
    x: cx - serifItalic.widthOfTextAtSize(line2, 16) / 2,
    y: height - 295, size: 16, font: serifItalic, color: muted,
  });

  const courseSize = fitSize(serif, content.courseTitle, 26, width - 200, 14);
  page.drawText(content.courseTitle, {
    x: cx - serif.widthOfTextAtSize(content.courseTitle, courseSize) / 2,
    y: height - 335, size: courseSize, font: serif, color: body,
  });

  // ── Signature block (admin-configured; bottom-left, above the footer) ──
  if (template.signaturePath || template.signatoryName) {
    const sigX = 80;
    let lineY = 128;
    if (template.signaturePath) {
      try {
        const [sigBytes] = await admin.storage().bucket().file(template.signaturePath).download();
        const sigLower = template.signaturePath.toLowerCase();
        const sigImg =
          sigLower.endsWith(".png")
            ? await pdf.embedPng(sigBytes)
            : await pdf.embedJpg(sigBytes);
        // Fit into a 150×45 box, anchored just above the signature line
        const scale = Math.min(150 / sigImg.width, 45 / sigImg.height);
        const w = sigImg.width * scale;
        const h = sigImg.height * scale;
        page.drawImage(sigImg, { x: sigX, y: lineY + 4, width: w, height: h });
      } catch (err) {
        console.error("certificate signature image failed to load (skipping):", err);
      }
    }
    page.drawLine({
      start: { x: sigX, y: lineY },
      end: { x: sigX + 170, y: lineY },
      thickness: 0.8,
      color: muted,
    });
    if (template.signatoryName) {
      page.drawText(template.signatoryName, {
        x: sigX, y: lineY - 14, size: 11, font: sansBold, color: body,
      });
    }
    if (template.signatoryTitle) {
      page.drawText(template.signatoryTitle, {
        x: sigX, y: lineY - 27, size: 9, font: sans, color: muted,
      });
    }
  }

  // Footer: date | cert id | verify URL
  page.drawText(`Issued: ${content.issuedDate}`, { x: 64, y: 76, size: 10, font: sans, color: muted });

  const idLabel = content.isPreview
    ? "SAMPLE PREVIEW — not a real certificate"
    : `Certificate ID: ${content.certId}`;
  page.drawText(idLabel, {
    x: cx - sansBold.widthOfTextAtSize(idLabel, 10) / 2,
    y: 76, size: 10, font: sansBold, color: primary,
  });

  const verifyLabel = content.isPreview
    ? "Real certificates carry a working verification link here"
    : `Verify: ${content.verifyUrl}`;
  page.drawText(verifyLabel, {
    x: width - 64 - sans.widthOfTextAtSize(verifyLabel, 9),
    y: 76, size: 9, font: sans, color: muted,
  });

  return pdf.save();
}

// ── Shared issue logic ───────────────────────────────────────────────────────

function baseUrl(): string {
  return process.env.PUBLIC_APP_URL || "https://andela-lms-dae5f.web.app";
}

interface IssueResult {
  certId: string;
  downloadUrl: string;
  issuedAt: number;
  alreadyIssued: boolean;
}

/**
 * Verifies completion and issues (or returns) the certificate.
 * @throws HttpsError("failed-precondition") when the course is not complete.
 */
async function issueCertificateCore(
  uid: string,
  courseId: string,
  opts: { sendEmail: boolean }
): Promise<IssueResult> {
  // Idempotency
  const existing = await db
    .collection("certificates")
    .where("userId", "==", uid)
    .where("courseId", "==", courseId)
    .limit(1)
    .get();
  if (!existing.empty) {
    const cert = existing.docs[0].data();
    const file = admin.storage().bucket().file(`certificates/${cert.certId}.pdf`);
    const [downloadUrl] = await file.getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + DOWNLOAD_TTL_MS,
    });
    return {
      certId: cert.certId,
      downloadUrl,
      issuedAt: (cert.issuedAt as admin.firestore.Timestamp)?.toMillis?.() ?? Date.now(),
      alreadyIssued: true,
    };
  }

  // Load course + learner
  const [courseSnap, userSnap] = await Promise.all([
    db.doc(`courses/${courseId}`).get(),
    db.doc(`users/${uid}`).get(),
  ]);
  if (!courseSnap.exists) throw new HttpsError("not-found", "Course not found.");
  const course = courseSnap.data() as { title?: string };
  const learnerName = (userSnap.data()?.name as string) || "Learner";
  const learnerEmail = (userSnap.data()?.email as string) || null;

  // Server-side completion check
  const modulesSnap = await db.collection(`courses/${courseId}/modules`).get();
  const lessonIds: string[] = [];
  await Promise.all(
    modulesSnap.docs.map(async (mod) => {
      const lessonsSnap = await db
        .collection(`courses/${courseId}/modules/${mod.id}/lessons`)
        .get();
      lessonsSnap.docs.forEach((l) => lessonIds.push(l.id));
    })
  );
  if (lessonIds.length === 0) {
    throw new HttpsError("failed-precondition", "This course has no lessons.");
  }

  const progressSnaps = await db.getAll(
    ...lessonIds.map((lid) => db.doc(`progress/${uid}_${lid}`))
  );
  const doneCount = progressSnaps.filter((s) => s.exists && s.data()?.completedAt).length;
  if (doneCount < lessonIds.length) {
    throw new HttpsError(
      "failed-precondition",
      `Course is not fully complete (${doneCount}/${lessonIds.length} lessons done).`
    );
  }

  // Post-assessment gate
  const postSnap = await db
    .collection("assessments")
    .where("courseId", "==", courseId)
    .where("kind", "==", "post")
    .limit(1)
    .get();
  if (!postSnap.empty) {
    const postId = postSnap.docs[0].id;
    const passedAttempt = await db
      .collection("attempts")
      .where("userId", "==", uid)
      .where("assessmentId", "==", postId)
      .where("passed", "==", true)
      .limit(1)
      .get();
    if (passedAttempt.empty) {
      throw new HttpsError(
        "failed-precondition",
        "You must pass the final assessment before a certificate can be issued."
      );
    }
  }

  // Concurrency guard: autoIssueCertificate (enrollment trigger),
  // autoIssueOnPostPass (attempt trigger) and the issueCertificate callable can
  // all fire for the same uid+course within milliseconds. The deterministic
  // lock doc (create() fails if it exists) makes exactly ONE of them generate
  // the certificate; the others return the existing one.
  const lockRef = db.doc(`certificateLocks/${uid}_${courseId}`);
  try {
    await lockRef.create({ createdAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch {
    // Another invocation holds (or held) the lock — return its certificate.
    // Brief retry: the winner may still be writing the cert doc.
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      const raced = await db
        .collection("certificates")
        .where("userId", "==", uid)
        .where("courseId", "==", courseId)
        .limit(1)
        .get();
      if (!raced.empty) {
        const cert = raced.docs[0].data();
        const racedFile = admin.storage().bucket().file(`certificates/${cert.certId}.pdf`);
        const [racedUrl] = await racedFile.getSignedUrl({
          version: "v4", action: "read", expires: Date.now() + DOWNLOAD_TTL_MS,
        });
        return {
          certId: cert.certId,
          downloadUrl: racedUrl,
          issuedAt: (cert.issuedAt as admin.firestore.Timestamp)?.toMillis?.() ?? Date.now(),
          alreadyIssued: true,
        };
      }
    }
    throw new HttpsError("aborted", "Certificate issuance is already in progress. Try again shortly.");
  }

  // Generate + store
  const certId = newCertId();
  const issuedDate = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
  const verifyUrl = `${baseUrl()}/verify/${certId}`;
  const courseTitle = course.title ?? "Untitled course";

  const file = admin.storage().bucket().file(`certificates/${certId}.pdf`);
  try {
    const template = await resolveTemplate(courseId);
    const pdfBytes = await buildCertificatePdf(
      { learnerName, courseTitle, certId, issuedDate, verifyUrl },
      template
    );

    await file.save(Buffer.from(pdfBytes), {
      contentType: "application/pdf",
      metadata: { cacheControl: "private, max-age=0" },
    });

    await db.doc(`certificates/${certId}`).set({
      certId,
      userId: uid,
      learnerName,
      courseId,
      courseTitle,
      issuedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Release the lock so a later attempt can retry generation.
    await lockRef.delete().catch(() => undefined);
    throw err;
  }

  const [downloadUrl] = await file.getSignedUrl({
    version: "v4", action: "read", expires: Date.now() + DOWNLOAD_TTL_MS,
  });

  // Distribution: congratulations email with 7-day link (Trigger Email ext.)
  if (opts.sendEmail && learnerEmail) {
    const [emailUrl] = await file.getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + EMAIL_TTL_MS,
    });
    // learnerName comes from a client-writable profile field and courseTitle
    // from admin input — sanitise both before email interpolation.
    const safeName = stripNewlines(learnerName);
    const safeTitle = stripNewlines(courseTitle);
    const htmlName = escapeHtml(safeName);
    const htmlTitle = escapeHtml(safeTitle);
    await db.collection("mail").add({
      to: learnerEmail,
      message: {
        subject: `🎓 Your certificate for "${safeTitle}" — Andela Learn`,
        text:
          `Congratulations ${safeName}!\n\n` +
          `You have completed "${safeTitle}".\n\n` +
          `Download your certificate (link valid 7 days): ${emailUrl}\n` +
          `Verify any time: ${verifyUrl}\n\n` +
          `Certificate ID: ${certId}\n— Andela Learn`,
        html:
          `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;">` +
          `<div style="background:#13403A;padding:24px;border-radius:12px 12px 0 0;">` +
          `<h1 style="color:#F5F7F4;font-size:20px;margin:0;">Congratulations, ${htmlName}! 🎓</h1></div>` +
          `<div style="border:1px solid #DDE6DF;border-top:0;padding:24px;border-radius:0 0 12px 12px;">` +
          `<p style="color:#1E302C;">You have successfully completed <strong>${htmlTitle}</strong> on Andela Learn.</p>` +
          `<p><a href="${emailUrl}" style="display:inline-block;background:#8FB85C;color:#13403A;font-weight:bold;` +
          `padding:12px 20px;border-radius:8px;text-decoration:none;">Download your certificate (PDF)</a></p>` +
          `<p style="color:#5E6E69;font-size:13px;">The download link is valid for 7 days. You can always re-download ` +
          `it from your course page.</p>` +
          `<p style="color:#5E6E69;font-size:13px;">Certificate ID: <strong>${certId}</strong><br/>` +
          `Anyone can verify it at <a href="${verifyUrl}">${verifyUrl}</a>.</p>` +
          `</div></div>`,
      },
    });
  }

  // In-app notification — written on every fresh issuance (even when the
  // email is suppressed). Best-effort: a failure here must never break or
  // roll back certificate issuance.
  try {
    await db.collection("notifications").add({
      userId: uid,
      title: stripNewlines("Certificate earned 🎓").slice(0, 150),
      body: stripNewlines(`Your certificate for "${courseTitle}" is ready.`).slice(0, 500),
      link: `/learn/course/${courseId}`,
      readAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("certificate notification write failed (non-fatal):", err);
  }

  return { certId, downloadUrl, issuedAt: Date.now(), alreadyIssued: false };
}

// ── Callable: learner requests certificate on demand ─────────────────────────

interface IssueCertificateRequest {
  courseId: string;
}

export const issueCertificate = onCall<IssueCertificateRequest>(
  { region: "us-central1", enforceAppCheck: ENFORCE_APPCHECK, memory: "512MiB" },
  async (request): Promise<IssueResult> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const { courseId } = request.data;
    if (!courseId || typeof courseId !== "string") {
      throw new HttpsError("invalid-argument", "courseId is required.");
    }
    // On-demand issue also emails — the learner expects delivery either way.
    return issueCertificateCore(request.auth.uid, courseId, { sendEmail: true });
  }
);

// ── Triggers: automatic issue + distribution ─────────────────────────────────

/**
 * Fires when an enrollment is written with progressPct hitting 100.
 * The write is client-made and untrusted — issueCertificateCore re-verifies
 * everything server-side; failed-precondition is silently skipped.
 */
export const autoIssueCertificate = onDocumentWritten(
  { document: "enrollments/{enrollmentId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    if (!after) return; // deletion
    if (after.progressPct !== 100 || before?.progressPct === 100) return;

    const enrollmentId = event.params.enrollmentId; // "{uid}_{courseId}"
    const sep = enrollmentId.indexOf("_");
    if (sep <= 0) return;
    const uid = enrollmentId.slice(0, sep);
    const courseId = enrollmentId.slice(sep + 1);

    try {
      const result = await issueCertificateCore(uid, courseId, { sendEmail: true });
      if (!result.alreadyIssued) {
        console.log(`Auto-issued certificate ${result.certId} for ${uid} / ${courseId}`);
      }
    } catch (err) {
      if (err instanceof HttpsError && err.code === "failed-precondition") {
        // Not actually complete (e.g. post-assessment pending) — fine, the
        // attempts trigger below will catch it later.
        return;
      }
      console.error("autoIssueCertificate failed:", err);
    }
  }
);

/**
 * Fires when a passed post-assessment attempt is recorded (written by the
 * gradeAttempt function). Covers the path where lessons were already 100%
 * and the final assessment was the last missing piece.
 */
export const autoIssueOnPostPass = onDocumentCreated(
  { document: "attempts/{attemptId}", region: "us-central1" },
  async (event) => {
    const attempt = event.data?.data();
    if (!attempt || attempt.kind !== "post" || attempt.passed !== true) return;
    const uid = attempt.userId as string;
    const courseId = attempt.courseId as string;
    if (!uid || !courseId) return;

    try {
      const result = await issueCertificateCore(uid, courseId, { sendEmail: true });
      if (!result.alreadyIssued) {
        console.log(`Auto-issued certificate ${result.certId} (post-pass) for ${uid} / ${courseId}`);
      }
    } catch (err) {
      if (err instanceof HttpsError && err.code === "failed-precondition") return;
      console.error("autoIssueOnPostPass failed:", err);
    }
  }
);

// ── Callable: admin template preview ─────────────────────────────────────────

interface PreviewCertificateRequest {
  courseId?: string; // preview with this course's template override (else global/built-in)
}

export const previewCertificate = onCall<PreviewCertificateRequest>(
  { region: "us-central1", enforceAppCheck: ENFORCE_APPCHECK, memory: "512MiB" },
  async (request): Promise<{ url: string }> => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    if (request.auth.token.role !== "admin") {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    // Use the REAL course title so the preview shows exactly what learners get.
    let courseTitle = "Sample Course";
    let template: TemplateConfig;
    if (request.data.courseId) {
      const courseSnap = await db.doc(`courses/${request.data.courseId}`).get();
      if (courseSnap.exists && typeof courseSnap.data()?.title === "string") {
        courseTitle = courseSnap.data()!.title as string;
      }
      template = await resolveTemplate(request.data.courseId);
    } else {
      const s = (await db.doc("settings/certificate").get()).data() ?? {};
      const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim() ? v.trim() : null;
      template = {
        templatePath: str(s.templatePath),
        textColor: s.textColor === "light" ? ("light" as const) : ("dark" as const),
        signaturePath: str(s.signaturePath),
        signatoryName: str(s.signatoryName),
        signatoryTitle: str(s.signatoryTitle),
      };
    }

    const pdfBytes = await buildCertificatePdf(
      {
        learnerName: "Ada Lovelace (sample learner)",
        courseTitle,
        certId: "PREVIEW",
        issuedDate: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
        verifyUrl: "",
        isPreview: true,
      },
      template
    );

    const file = admin.storage().bucket().file(`certTemplates/previews/${request.auth.uid}.pdf`);
    await file.save(Buffer.from(pdfBytes), { contentType: "application/pdf" });
    const [url] = await file.getSignedUrl({
      version: "v4", action: "read", expires: Date.now() + 15 * 60 * 1000,
    });
    return { url };
  }
);
