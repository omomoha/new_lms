/**
 * muxClient — runtime wrapper around the Mux Node SDK + signed-playback JWT
 * minting. Isolated here (not in muxLogic) because it touches the SDK, jose,
 * and process.env — none of which belong in the unit-tested pure module.
 *
 * SECRETS (functions runtime env — written to functions/.env at deploy, same
 * mechanism as ANTHROPIC_API_KEY; see .github/workflows/deploy.yml):
 *   MUX_TOKEN_ID            — Mux API access token id   (asset/upload management)
 *   MUX_TOKEN_SECRET        — Mux API access token secret
 *   MUX_SIGNING_KEY_ID      — Mux signing key id        (signed playback)
 *   MUX_SIGNING_PRIVATE_KEY — Mux signing key private key (base64 OR PEM)
 *   MUX_WEBHOOK_SECRET      — Mux webhook signing secret (signature verify)
 *
 * Like aiClient(), every accessor throws failed-precondition (HttpsError) when
 * its required secret is unset, so the deployment is safe with the flag OFF and
 * no Mux account configured — nothing crashes at deploy, callables just refuse.
 */

import { HttpsError } from "firebase-functions/v2/https";
import Mux from "@mux/mux-node";
import { SignJWT, importPKCS8 } from "jose";
import { clampPlaybackTtlSeconds } from "./muxLogic";

let mux: Mux | null = null;

/** Lazily construct the Mux SDK client; HttpsError if not configured. */
export function muxClient(): Mux {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) {
    throw new HttpsError(
      "failed-precondition",
      "Adaptive video is not configured on this deployment."
    );
  }
  if (!mux) {
    mux = new Mux({
      tokenId,
      tokenSecret,
      webhookSecret: process.env.MUX_WEBHOOK_SECRET,
    });
  }
  return mux;
}

/** True when the four playback-critical secrets are present. */
export function isMuxConfigured(): boolean {
  return Boolean(
    process.env.MUX_TOKEN_ID &&
      process.env.MUX_TOKEN_SECRET &&
      process.env.MUX_SIGNING_KEY_ID &&
      process.env.MUX_SIGNING_PRIVATE_KEY
  );
}

/** Mux webhook signing secret, or null when unset (verification denied). */
export function muxWebhookSecret(): string | null {
  return process.env.MUX_WEBHOOK_SECRET || null;
}

/**
 * Verify a Mux webhook signature against the raw request body. Throws on any
 * mismatch (the SDK's verifySignature does the timing-safe HMAC compare).
 */
export async function verifyMuxSignature(
  rawBody: string,
  signatureHeader: string
): Promise<void> {
  const secret = muxWebhookSecret();
  if (!secret) {
    throw new HttpsError("failed-precondition", "Webhook secret not configured.");
  }
  await muxClient().webhooks.verifySignature(
    rawBody,
    { "mux-signature": signatureHeader },
    secret
  );
}

/**
 * The signing private key may be supplied base64-encoded (Mux's own console
 * download is base64) OR as a raw PEM. Normalise to PEM for jose.
 */
function signingPrivateKeyPem(): string {
  const raw = process.env.MUX_SIGNING_PRIVATE_KEY;
  if (!raw) {
    throw new HttpsError(
      "failed-precondition",
      "Adaptive video playback is not configured on this deployment."
    );
  }
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    throw new HttpsError("failed-precondition", "Invalid Mux signing key.");
  }
}

export interface MuxPlaybackToken {
  token: string;
  expiresAt: number; // epoch millis
}

/**
 * Mint a Mux signed-playback JWT for a playback id. The JWT is appended to the
 * HLS URL as ?token=… — it is what authorizes the player to stream, so it is
 * minted ONLY after requireCourseAccess passes (see getMuxPlaybackToken).
 *
 * aud "v" = video playback (Mux's audience claim for stream tokens).
 */
export async function mintPlaybackToken(
  playbackId: string,
  ttlSecondsRequested?: number
): Promise<MuxPlaybackToken> {
  const keyId = process.env.MUX_SIGNING_KEY_ID;
  if (!keyId) {
    throw new HttpsError(
      "failed-precondition",
      "Adaptive video playback is not configured on this deployment."
    );
  }
  const ttl = clampPlaybackTtlSeconds(ttlSecondsRequested);
  const pem = signingPrivateKeyPem();

  try {
    const key = await importPKCS8(pem, "RS256");
    const expSeconds = Math.floor(Date.now() / 1000) + ttl;
    const token = await new SignJWT({ aud: "v", sub: playbackId })
      .setProtectedHeader({ alg: "RS256", kid: keyId })
      .setExpirationTime(expSeconds)
      .sign(key);
    return { token, expiresAt: expSeconds * 1000 };
  } catch (err) {
    console.error("mintPlaybackToken failed:", err);
    throw new HttpsError("internal", "Could not generate a playback token.");
  }
}
