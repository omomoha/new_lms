/**
 * videoEmbed.ts
 *
 * Converts a user-supplied YouTube or Google Drive share URL to a safe embed URL.
 * Returns null for anything that doesn't match — never embed arbitrary URLs.
 *
 * Supported YouTube patterns:
 *   https://www.youtube.com/watch?v=<id>
 *   https://youtu.be/<id>
 *   https://www.youtube.com/shorts/<id>
 *
 * Supported Google Drive patterns:
 *   https://drive.google.com/file/d/<id>/view
 *   https://drive.google.com/file/d/<id>/preview
 *   (any trailing path after the <id> segment)
 */

export type VideoProvider = "youtube" | "drive";

export interface EmbedResult {
  embedUrl: string;
  provider: VideoProvider;
}

/**
 * Parse a YouTube / Google Drive URL and return a safe embed URL + provider.
 * Returns null if the URL does not match any supported pattern.
 */
export function toEmbedUrl(url: string): EmbedResult | null {
  if (!url || typeof url !== "string") return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");

  // ── YouTube ────────────────────────────────────────────────────────────────
  if (host === "youtube.com") {
    // /watch?v=<id>
    const watchId = parsed.searchParams.get("v");
    if (parsed.pathname === "/watch" && watchId && isYouTubeId(watchId)) {
      return {
        embedUrl: `https://www.youtube.com/embed/${watchId}`,
        provider: "youtube",
      };
    }

    // /shorts/<id>
    const shortsMatch = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,16})$/);
    if (shortsMatch) {
      return {
        embedUrl: `https://www.youtube.com/embed/${shortsMatch[1]}`,
        provider: "youtube",
      };
    }
  }

  if (host === "youtu.be") {
    // youtu.be/<id>
    const id = parsed.pathname.replace(/^\//, "");
    if (isYouTubeId(id)) {
      return {
        embedUrl: `https://www.youtube.com/embed/${id}`,
        provider: "youtube",
      };
    }
  }

  // ── Google Drive ───────────────────────────────────────────────────────────
  if (host === "drive.google.com") {
    // /file/d/<id> or /file/d/<id>/... — trailing segment optional, id bounded
    const driveMatch = parsed.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,128})(?:\/|$)/);
    if (driveMatch) {
      return {
        embedUrl: `https://drive.google.com/file/d/${driveMatch[1]}/preview`,
        provider: "drive",
      };
    }
  }

  return null;
}

/** YouTube video IDs are 11 characters of [A-Za-z0-9_-] */
function isYouTubeId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}
