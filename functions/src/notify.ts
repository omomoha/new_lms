/**
 * notify — Slack helper for Cloud Functions
 *
 * postToSlack() sends a plain-text message to the Slack Incoming Webhook URL
 * stored in the SLACK_WEBHOOK_URL environment variable.
 *
 * Behaviour:
 *   • Uses the Node 22 global `fetch` — no extra dependencies required.
 *   • If SLACK_WEBHOOK_URL is unset or empty, logs a warning and returns quietly
 *     (never throws) so that Slack being unconfigured never breaks a deploy.
 *   • A non-2xx HTTP response is logged as a warning but does NOT throw —
 *     the caller's primary work is never blocked by a Slack failure.
 *
 * Usage:
 *   import { postToSlack } from "./notify";
 *   await postToSlack("📈 Andela LMS: 5 new sign-up(s) in the last 24h");
 */

export async function postToSlack(text: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.warn(
      "postToSlack: SLACK_WEBHOOK_URL is not set — skipping Slack notification."
    );
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      console.warn(
        `postToSlack: Slack responded with HTTP ${response.status} — message may not have been delivered.`
      );
    }
  } catch (err) {
    // Network errors should never crash a Cloud Function
    console.warn("postToSlack: failed to deliver Slack notification:", err);
  }
}
