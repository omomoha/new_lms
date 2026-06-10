/**
 * learnerReminders — Scheduled Cloud Function (2nd-gen)
 *
 * Fires every Monday at 09:00 Africa/Lagos time (one hour after the admin
 * weeklyDigest). Finds learners with in-progress enrollments
 * (0 < progressPct < 100), and writes a friendly nudge email to the `mail`
 * collection (Trigger Email extension) for each — at most once per learner
 * per course every 14 days (tracked via enrollment.lastNudgedAt).
 *
 * Safety:
 *  - Skips users whose status !== "active" or who have no email.
 *  - Skips courses that are missing or not published.
 *  - HTML-escapes the learner name and course title (Firestore content is
 *    untrusted in an HTML email body).
 *  - Caps at 200 emails per run.
 *
 * NEW FIRESTORE FIELD: enrollments/{id}.lastNudgedAt (Timestamp) — written
 * here via the Admin SDK only.
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

const MAX_EMAILS_PER_RUN = 200;
const NUDGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Same pattern as bulkOnboard.ts — escape untrusted strings before HTML.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Single-line, length-capped string for email subjects. */
function subjectSafe(s: string, max = 80): string {
  return s.replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

interface CachedUser {
  email: string;
  name: string;
}

function buildHtml(name: string, courseTitle: string, pct: number, url: string): string {
  const safeName = escapeHtml(name);
  const safeTitle = escapeHtml(courseTitle);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F7F4;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7F4;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#13403A;padding:24px 28px;">
            <span style="font-size:20px;font-weight:700;color:#8FB85C;">Andela</span>
            <span style="font-size:20px;font-weight:300;color:#ffffff;"> LMS</span>
            <p style="margin:6px 0 0;font-size:13px;color:#CFE0D5;letter-spacing:0.08em;text-transform:uppercase;">Keep up the momentum</p>
          </td>
        </tr>
        <tr><td style="height:4px;background:#8FB85C;"></td></tr>
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 12px;font-size:14px;color:#1E302C;">Hi ${safeName},</p>
            <p style="margin:0 0 12px;font-size:14px;color:#5E6E69;">
              You're <strong style="color:#13403A;">${pct}% of the way</strong> through
              <strong style="color:#13403A;">${safeTitle}</strong> — nice work so far!
              A short session this week is all it takes to keep moving.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:20px 0;">
              <tr><td style="background:#13403A;border-radius:8px;">
                <a href="${url}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Continue learning →</a>
              </td></tr>
            </table>
            <p style="margin:0;font-size:13px;color:#5E6E69;">You've got this — see you in there.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #E7F1DE;">
            <p style="margin:0;font-size:12px;color:#9EB3AD;">You're receiving this because you have a course in progress on the Andela LMS. Finish the course to stop these reminders.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(name: string, courseTitle: string, pct: number, url: string): string {
  return [
    `Hi ${name},`,
    "",
    `You're ${pct}% of the way through "${courseTitle}" — nice work so far!`,
    "A short session this week is all it takes to keep moving.",
    "",
    `Continue learning: ${url}`,
    "",
    "You've got this — see you in there.",
    "— Andela LMS",
  ].join("\n");
}

export const learnerReminders = onSchedule(
  {
    schedule: "every monday 09:00",
    timeZone: "Africa/Lagos",
    region: "us-central1",
  },
  async () => {
    const appUrl = (process.env.PUBLIC_APP_URL || "https://andela-lms-dae5f.web.app")
      .replace(/\/+$/, "");
    const nudgeCutoff = Date.now() - NUDGE_COOLDOWN_MS;

    // Two range filters on the same field — no composite index required.
    const enrollmentsSnap = await db
      .collection("enrollments")
      .where("progressPct", ">", 0)
      .where("progressPct", "<", 100)
      .get();

    if (enrollmentsSnap.empty) {
      console.info("learnerReminders: no in-progress enrollments, nothing to send.");
      return;
    }

    const userCache = new Map<string, CachedUser | null>();
    const courseCache = new Map<string, string | null>();

    const batch = db.batch();
    let queued = 0;
    let skipped = 0;

    for (const enrollmentDoc of enrollmentsSnap.docs) {
      if (queued >= MAX_EMAILS_PER_RUN) break;

      const enrollment = enrollmentDoc.data() as {
        userId?: string;
        courseId?: string;
        progressPct?: number;
        lastNudgedAt?: admin.firestore.Timestamp;
      };

      if (!enrollment.userId || !enrollment.courseId) {
        skipped++;
        continue;
      }

      // Cooldown: at most one nudge per enrollment every 14 days.
      if (
        enrollment.lastNudgedAt instanceof admin.firestore.Timestamp &&
        enrollment.lastNudgedAt.toMillis() > nudgeCutoff
      ) {
        skipped++;
        continue;
      }

      // ── User lookup (cached) — must be active with an email ────────────
      let user = userCache.get(enrollment.userId);
      if (user === undefined) {
        const userSnap = await db.doc(`users/${enrollment.userId}`).get();
        const u = userSnap.data() as
          | { email?: string; name?: string; status?: string }
          | undefined;
        user =
          userSnap.exists && u && typeof u.email === "string" && u.email && u.status === "active"
            ? { email: u.email, name: u.name?.trim() || "there" }
            : null;
        userCache.set(enrollment.userId, user);
      }
      if (!user) {
        skipped++;
        continue;
      }

      // ── Course lookup (cached) — must exist and be published ───────────
      let courseTitle = courseCache.get(enrollment.courseId);
      if (courseTitle === undefined) {
        const courseSnap = await db.doc(`courses/${enrollment.courseId}`).get();
        const c = courseSnap.data() as { title?: string; status?: string } | undefined;
        courseTitle =
          courseSnap.exists && c?.status === "published"
            ? c.title?.trim() || "your course"
            : null;
        courseCache.set(enrollment.courseId, courseTitle);
      }
      if (!courseTitle) {
        skipped++;
        continue;
      }

      const pct = Math.max(
        0,
        Math.min(99, Math.round(enrollment.progressPct ?? 0))
      );
      const courseUrl = `${appUrl}/learn/course/${encodeURIComponent(enrollment.courseId)}`;

      batch.set(db.collection("mail").doc(), {
        to: user.email,
        message: {
          subject: subjectSafe(`You're ${pct}% through ${courseTitle} — keep going!`, 120),
          html: buildHtml(user.name, courseTitle, pct, courseUrl),
          text: buildText(user.name, courseTitle, pct, courseUrl),
        },
      });
      batch.update(enrollmentDoc.ref, {
        lastNudgedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      queued++;
    }

    if (queued > 0) {
      // ≤ 200 emails × 2 ops = ≤ 400 writes — under the 500-op batch limit.
      await batch.commit();
    }

    console.info(
      `learnerReminders: queued ${queued} nudge email(s), skipped ${skipped} ` +
        `of ${enrollmentsSnap.size} in-progress enrollment(s).`
    );
  }
);
