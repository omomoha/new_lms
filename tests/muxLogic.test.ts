import { describe, it, expect } from "vitest";
import {
  MUX_PATH_PREFIX,
  muxVideoPath,
  isMuxPath,
  parseMuxPlaybackId,
  clampPlaybackTtlSeconds,
  playbackTokenExpiry,
  DEFAULT_PLAYBACK_TTL_SECONDS,
  mapWebhookEventToStatus,
  pickPlaybackId,
  isValidCourseId,
} from "../functions/src/muxLogic";

describe("videoPath seam (mux: prefix)", () => {
  it("encodes a playback id into an opaque videoPath", () => {
    expect(muxVideoPath("abc123")).toBe("mux:abc123");
    expect(muxVideoPath("abc123").startsWith(MUX_PATH_PREFIX)).toBe(true);
  });

  it("distinguishes Mux paths from Storage paths", () => {
    expect(isMuxPath("mux:abc123")).toBe(true);
    expect(isMuxPath("videos/c1/m1/intro.mp4")).toBe(false);
    expect(isMuxPath(undefined)).toBe(false);
    expect(isMuxPath(null)).toBe(false);
    expect(isMuxPath("")).toBe(false);
  });

  it("round-trips a playback id", () => {
    expect(parseMuxPlaybackId(muxVideoPath("Xy_9-Zq"))).toBe("Xy_9-Zq");
  });

  it("returns null for non-Mux or malformed values", () => {
    expect(parseMuxPlaybackId("videos/c1/m1/x.mp4")).toBeNull();
    expect(parseMuxPlaybackId("mux:")).toBeNull();
    expect(parseMuxPlaybackId("mux:  ")).toBeNull();
    expect(parseMuxPlaybackId("mux:a/b")).toBeNull(); // no path separators
    expect(parseMuxPlaybackId("mux:../etc")).toBeNull();
    expect(parseMuxPlaybackId("mux:bad id!")).toBeNull(); // charset
    expect(parseMuxPlaybackId(undefined)).toBeNull();
  });
});

describe("clampPlaybackTtlSeconds", () => {
  it("returns the default for invalid input", () => {
    expect(clampPlaybackTtlSeconds(undefined)).toBe(DEFAULT_PLAYBACK_TTL_SECONDS);
    expect(clampPlaybackTtlSeconds(NaN)).toBe(DEFAULT_PLAYBACK_TTL_SECONDS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(clampPlaybackTtlSeconds("x" as any)).toBe(DEFAULT_PLAYBACK_TTL_SECONDS);
  });

  it("clamps to [60s, 12h]", () => {
    expect(clampPlaybackTtlSeconds(10)).toBe(60);
    expect(clampPlaybackTtlSeconds(60)).toBe(60);
    expect(clampPlaybackTtlSeconds(3600)).toBe(3600);
    expect(clampPlaybackTtlSeconds(12 * 60 * 60)).toBe(12 * 60 * 60);
    expect(clampPlaybackTtlSeconds(99 * 60 * 60)).toBe(12 * 60 * 60);
  });

  it("floors fractional seconds", () => {
    expect(clampPlaybackTtlSeconds(120.9)).toBe(120);
  });

  it("honors a custom fallback", () => {
    expect(clampPlaybackTtlSeconds(undefined, 300)).toBe(300);
  });
});

describe("playbackTokenExpiry", () => {
  it("returns now (seconds) + ttl", () => {
    expect(playbackTokenExpiry(10_000, 60)).toBe(10 + 60);
    expect(playbackTokenExpiry(1_700_000_000_000, 7200)).toBe(
      1_700_000_000 + 7200
    );
  });
});

describe("mapWebhookEventToStatus", () => {
  it("maps the asset lifecycle events", () => {
    expect(mapWebhookEventToStatus("video.asset.created")).toBe("preparing");
    expect(mapWebhookEventToStatus("video.asset.ready")).toBe("ready");
    expect(mapWebhookEventToStatus("video.asset.errored")).toBe("errored");
  });

  it("returns null for unhandled events", () => {
    expect(mapWebhookEventToStatus("video.upload.created")).toBeNull();
    expect(mapWebhookEventToStatus("video.asset.deleted")).toBeNull();
    expect(mapWebhookEventToStatus(undefined)).toBeNull();
    expect(mapWebhookEventToStatus("")).toBeNull();
  });
});

describe("pickPlaybackId", () => {
  it("prefers a signed-policy playback id", () => {
    expect(
      pickPlaybackId([
        { id: "pub1", policy: "public" },
        { id: "sig1", policy: "signed" },
      ])
    ).toBe("sig1");
  });

  it("falls back to the first id with no signed policy", () => {
    expect(pickPlaybackId([{ id: "pub1", policy: "public" }])).toBe("pub1");
  });

  it("returns null when empty or missing", () => {
    expect(pickPlaybackId([])).toBeNull();
    expect(pickPlaybackId(undefined)).toBeNull();
    expect(pickPlaybackId([{ policy: "signed" }])).toBeNull(); // no id
  });
});

describe("isValidCourseId", () => {
  it("accepts auto-IDs and slugs", () => {
    expect(isValidCourseId("Abc123_-x")).toBe(true);
  });
  it("rejects empty, paths, and bad chars", () => {
    expect(isValidCourseId("")).toBe(false);
    expect(isValidCourseId("a/b")).toBe(false);
    expect(isValidCourseId("a b")).toBe(false);
    expect(isValidCourseId(undefined)).toBe(false);
    expect(isValidCourseId(null)).toBe(false);
  });
});
