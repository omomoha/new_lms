/**
 * weeklyDigest — Scheduled Cloud Function (2nd-gen)
 *
 * Fires every Monday at 08:00 Africa/Lagos time.
 * Counts platform stats via Admin SDK Firestore aggregates, finds all admin
 * users, and writes one mail/ doc per admin email.
 *
 * REQUIREMENTS:
 *   • Firebase Trigger Email extension must be installed and configured to
 *     watch the `mail` collection. See:
 *     https://extensions.dev/extensions/firebase/firestore-send-email
 *   • Cloud Scheduler API must be enabled in the GCP project before the
 *     first deploy:
 *     https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { postToSlack } from "./notify";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeeklyStats {
  totalUsers: number;
  newUsersLast7Days: number;
  totalEnrollments: number;
  completedEnrollments: number;
  attemptsLast7Days: number;
}

// ─── Helper — build HTML table ────────────────────────────────────────────────

function buildHtml(stats: WeeklyStats, generatedAt: string): string {
  const rows: Array<[string, string | number]> = [
    ["Total Users", stats.totalUsers.toLocaleString()],
    ["New Sign-ups (last 7 days)", stats.newUsersLast7Days.toLocaleString()],
    ["Total Enrollments", stats.totalEnrollments.toLocaleString()],
    ["Completed Enrollments", stats.completedEnrollments.toLocaleString()],
    [
      "Completion Rate",
      stats.totalEnrollments > 0
        ? Math.round((stats.completedEnrollments / stats.totalEnrollments) * 100) + "%"
        : "—",
    ],
    ["Assessment Attempts (last 7 days)", stats.attemptsLast7Days.toLocaleString()],
  ];

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:10px 16px;border-bottom:1px solid #E7F1DE;color:#5E6E69;font-size:14px;">${label}</td>
          <td style="padding:10px 16px;border-bottom:1px solid #E7F1DE;color:#13403A;font-size:14px;font-weight:600;text-align:right;">${value}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F7F4;font-family:sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7F4;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#13403A;padding:24px 28px;">
            <span style="font-size:20px;font-weight:700;color:#8FB85C;">Andela</span>
            <span style="font-size:20px;font-weight:300;color:#ffffff;"> LMS</span>
            <p style="margin:6px 0 0;font-size:13px;color:#CFE0D5;letter-spacing:0.08em;text-transform:uppercase;">Weekly Platform Digest</p>
          </td>
        </tr>
        <!-- Moss rule -->
        <tr><td style="height:4px;background:#8FB85C;"></td></tr>
        <!-- Intro -->
        <tr>
          <td style="padding:24px 28px 8px;">
            <p style="margin:0;font-size:14px;color:#5E6E69;">Here is your weekly summary for the 7 days ending <strong style="color:#13403A;">${generatedAt}</strong>.</p>
          </td>
        </tr>
        <!-- Stats table -->
        <tr>
          <td style="padding:8px 28px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E7F1DE;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#E7F1DE;">
                  <th style="padding:10px 16px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:0.07em;color:#5E6E69;">Metric</th>
                  <th style="padding:10px 16px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:0.07em;color:#5E6E69;">Value</th>
                </tr>
              </thead>
              <tbody>${tableRows}</tbody>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #E7F1DE;">
            <p style="margin:0;font-size:12px;color:#9EB3AD;">This email was generated automatically by the Andela LMS weekly digest function. You are receiving it because you have an admin role on this platform.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildText(stats: WeeklyStats, generatedAt: string): string {
  return [
    "Andela LMS — Weekly Platform Digest",
    `Week ending: ${generatedAt}`,
    "",
    `Total Users:                     ${stats.totalUsers}`,
    `New Sign-ups (last 7 days):      ${stats.newUsersLast7Days}`,
    `Total Enrollments:               ${stats.totalEnrollments}`,
    `Completed Enrollments:           ${stats.completedEnrollments}`,
    `Completion Rate:                 ${
      stats.totalEnrollments > 0
        ? Math.round((stats.completedEnrollments / stats.totalEnrollments) * 100) + "%"
        : "—"
    }`,
    `Assessment Attempts (7 days):    ${stats.attemptsLast7Days}`,
    "",
    "---",
    "This report was generated automatically. You received it because you have an admin role on this platform.",
  ].join("\n");
}

// ─── Function ─────────────────────────────────────────────────────────────────

export const weeklyDigest = onSchedule(
  {
    schedule: "every monday 08:00",
    timeZone: "Africa/Lagos",
    region: "us-central1",
  },
  async () => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ── Aggregate stats via Admin SDK count() ─────────────────────────────────
    const [
      totalUsersAgg,
      newUsersAgg,
      totalEnrollmentsAgg,
      completedEnrollmentsAgg,
      attemptsAgg,
    ] = await Promise.all([
      db.collection("users").count().get(),
      db
        .collection("users")
        .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(sevenDaysAgo))
        .count()
        .get(),
      db.collection("enrollments").count().get(),
      db.collection("enrollments").where("progressPct", ">=", 100).count().get(),
      db
        .collection("attempts")
        .where("submittedAt", ">=", admin.firestore.Timestamp.fromDate(sevenDaysAgo))
        .count()
        .get(),
    ]);

    const stats: WeeklyStats = {
      totalUsers: totalUsersAgg.data().count,
      newUsersLast7Days: newUsersAgg.data().count,
      totalEnrollments: totalEnrollmentsAgg.data().count,
      completedEnrollments: completedEnrollmentsAgg.data().count,
      attemptsLast7Days: attemptsAgg.data().count,
    };

    // ── Find all admin users ──────────────────────────────────────────────────
    const adminSnap = await db
      .collection("users")
      .where("role", "==", "admin")
      .get();

    if (adminSnap.empty) {
      console.info("weeklyDigest: no admin users found, nothing to send.");
      return;
    }

    const generatedAt = now.toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const html = buildHtml(stats, generatedAt);
    const text = buildText(stats, generatedAt);

    // ── Write one mail/ doc per admin ─────────────────────────────────────────
    const batch = db.batch();
    for (const adminDoc of adminSnap.docs) {
      const data = adminDoc.data() as { email?: string; name?: string };
      if (!data.email) continue;

      const mailRef = db.collection("mail").doc();
      batch.set(mailRef, {
        to: data.email,
        message: {
          subject: `Andela LMS — Weekly Digest (${generatedAt})`,
          html,
          text,
        },
      });
    }
    await batch.commit();

    // Post a compact one-line summary to Slack
    const completionRate =
      stats.totalEnrollments > 0
        ? Math.round((stats.completedEnrollments / stats.totalEnrollments) * 100) + "%"
        : "—";
    await postToSlack(
      `📊 Andela LMS weekly digest (${generatedAt}): ` +
        `${stats.totalUsers} users | +${stats.newUsersLast7Days} new | ` +
        `${stats.totalEnrollments} enrollments | ${completionRate} completion | ` +
        `${stats.attemptsLast7Days} attempts this week`
    );

    console.info(
      `weeklyDigest: sent digest to ${adminSnap.size} admin(s). Stats:`,
      stats
    );
  }
);
