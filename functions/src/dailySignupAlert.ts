/**
 * dailySignupAlert — Scheduled Cloud Function (2nd-gen)
 *
 * Fires every day at 09:00 Africa/Lagos time.
 *
 * 1. Counts users created in the last 24 hours via Admin SDK count aggregate
 *    (reads createdAt >= now-24h from the `users` collection).
 * 2. If count > 0:
 *    a. Posts a Slack notification via postToSlack().
 *    b. Writes one mail/ doc per admin user (same pattern as weeklyDigest)
 *       so the Firebase Trigger Email extension delivers the alert.
 *
 * REQUIREMENTS:
 *   • Firebase Trigger Email extension installed and watching the `mail` collection.
 *   • Cloud Scheduler API enabled in the GCP project.
 *   • SLACK_WEBHOOK_URL set in functions environment (functions/.env or Firebase config).
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { postToSlack } from "./notify";

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

export const dailySignupAlert = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "Africa/Lagos",
    region: "us-central1",
  },
  async () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Count users created in the last 24h using Admin SDK count aggregate
    const newUsersAgg = await db
      .collection("users")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(oneDayAgo))
      .count()
      .get();

    const count = newUsersAgg.data().count;

    if (count === 0) {
      console.info("dailySignupAlert: no new sign-ups in the last 24h — nothing to send.");
      return;
    }

    const message = `📈 Andela LMS: ${count} new sign-up(s) in the last 24h`;

    // Post to Slack (non-blocking — see notify.ts)
    await postToSlack(message);

    // Find all admin users
    const adminSnap = await db
      .collection("users")
      .where("role", "==", "admin")
      .get();

    if (adminSnap.empty) {
      console.info("dailySignupAlert: no admin users found — Slack notified but no email sent.");
      return;
    }

    const generatedAt = now.toLocaleDateString("en-GB", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Write one mail/ doc per admin (reuse Firebase Trigger Email extension pattern)
    const batch = db.batch();
    for (const adminDoc of adminSnap.docs) {
      const data = adminDoc.data() as { email?: string; name?: string };
      if (!data.email) continue;

      const mailRef = db.collection("mail").doc();
      batch.set(mailRef, {
        to: data.email,
        message: {
          subject: `Andela LMS — Daily Sign-up Alert (${generatedAt})`,
          text: [
            "Andela LMS — Daily Sign-up Alert",
            `Date: ${generatedAt}`,
            "",
            `${count} new user(s) signed up in the last 24 hours.`,
            "",
            "---",
            "This alert was generated automatically. You received it because you have an admin role on this platform.",
          ].join("\n"),
          html: `<!DOCTYPE html>
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
            <p style="margin:6px 0 0;font-size:13px;color:#CFE0D5;letter-spacing:0.08em;text-transform:uppercase;">Daily Sign-up Alert</p>
          </td>
        </tr>
        <tr><td style="height:4px;background:#8FB85C;"></td></tr>
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 16px;font-size:16px;color:#13403A;font-weight:600;">
              📈 ${count} new sign-up(s) in the last 24 hours
            </p>
            <p style="margin:0;font-size:14px;color:#5E6E69;">
              Date: <strong style="color:#13403A;">${generatedAt}</strong>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px;border-top:1px solid #E7F1DE;">
            <p style="margin:0;font-size:12px;color:#9EB3AD;">This alert was generated automatically by the Andela LMS daily sign-up alert function. You are receiving it because you have an admin role on this platform.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        },
      });
    }
    await batch.commit();

    console.info(
      `dailySignupAlert: ${count} new sign-up(s) — Slack notified, alert sent to ${adminSnap.size} admin(s).`
    );
  }
);
