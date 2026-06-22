/**
 * hls — lazy hls.js loader for adaptive (Mux/HLS) playback (Phase 4 — C).
 *
 * Mux serves HLS manifests (…m3u8). Safari plays HLS natively on a plain
 * <video>; other browsers need Media Source Extensions via hls.js. To avoid
 * adding hls.js to the bundle (and keep the flag-OFF path byte-for-byte
 * unchanged), it is loaded from a CDN on demand — ONLY when a Mux HLS URL is
 * actually attached.
 *
 * attachHls returns a cleanup function (detaches/destroys the hls.js instance)
 * for the caller's effect teardown, so switching sources never leaks players.
 */

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";

/** True for a URL that points at an HLS manifest (Mux signed playback). */
export function isHlsUrl(url: string): boolean {
  // Strip query (Mux appends ?token=…) before testing the extension.
  const path = url.split("?")[0];
  return path.endsWith(".m3u8");
}

type HlsCtor = new (config?: unknown) => any;

let hlsLoad: Promise<HlsCtor | null> | null = null;

/** Load the hls.js constructor from CDN once; null if it can't load. */
function loadHls(): Promise<HlsCtor | null> {
  if (hlsLoad) return hlsLoad;
  hlsLoad = new Promise<HlsCtor | null>((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    const existing = (window as any).Hls as HlsCtor | undefined;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = HLS_CDN;
    script.async = true;
    script.onload = () => {
      resolve(((window as any).Hls as HlsCtor) ?? null);
    };
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return hlsLoad;
}

/**
 * Attach an HLS manifest URL to a <video>. Uses native HLS where supported
 * (Safari/iOS), otherwise hls.js. Returns a cleanup function.
 */
export async function attachHls(
  video: HTMLVideoElement,
  url: string
): Promise<() => void> {
  // Native HLS (Safari, iOS) — just set src.
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }

  const Hls = await loadHls();
  const HlsAny = Hls as any;
  if (HlsAny && HlsAny.isSupported && HlsAny.isSupported()) {
    const hls = new HlsAny({ enableWorker: true });
    hls.loadSource(url);
    hls.attachMedia(video);
    return () => {
      try {
        hls.destroy();
      } catch {
        /* no-op */
      }
    };
  }

  // Last resort: try native src anyway (some browsers handle it).
  video.src = url;
  return () => {
    video.removeAttribute("src");
    video.load();
  };
}
