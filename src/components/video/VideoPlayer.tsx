"use client";

/**
 * VideoPlayer — HTML5 <video> with resume support.
 *
 * Features:
 * - Resumes from positionSec on mount (reads from Firestore progress doc)
 * - Saves position on pause and on timeupdate (throttled to every 5 seconds)
 * - "Mark complete" button writes completedAt and bumps enrollment progressPct
 * - Designed for direct use in the lesson player page
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import db from "@/lib/firebase/firestore";
import { videoService, getVideoService } from "@/lib/video";
import { isMuxPath } from "@/lib/video/MuxVideoService";
import { attachHls, isHlsUrl } from "@/lib/video/hls";
import { getResourceUrl } from "@/lib/files";
import { shouldSaveProgress, calcProgressPct } from "@/lib/progress";
import type { LessonProgress } from "@/types";

interface VideoPlayerProps {
  userId: string;
  courseId: string;
  lessonId: string;
  videoPath: string;        // Firebase Storage path
  allLessonIds: string[];   // for progressPct calc
  captionsPath?: string;    // Phase 3: Storage path to a WebVTT (.vtt) captions file
  onComplete?: () => void;
}

export function VideoPlayer({
  userId,
  courseId,
  lessonId,
  videoPath,
  allLessonIds,
  captionsPath,
  onComplete,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [captionsUrl, setCaptionsUrl] = useState<string | null>(null);
  // Quality selection: "source" = original upload (up to 1080p), "720p" = the
  // server-transcoded variant ({path minus ext}_720p.mp4, created by the
  // transcodeVideo function). 720p is requested lazily; if the variant doesn't
  // exist (yet), we fall back to source and mark it unavailable.
  const [quality, setQuality] = useState<"source" | "720p">("source");
  const [qualityNote, setQualityNote] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // Phase 4 (Workstream C): true when this lesson is served via Mux/HLS. In that
  // mode adaptive bitrate is automatic (hls.js), so the manual source/720p
  // quality picker — which is specific to the Storage transcode variant — hides.
  const [isMux, setIsMux] = useState(false);
  // Holds the hls.js teardown so source swaps / unmount never leak a player.
  const hlsCleanup = useRef<(() => void) | null>(null);
  // Resume position captured at load — applied by the native <video> path
  // immediately and by the HLS attach path once media metadata is available.
  const resumePosRef = useRef<number>(0);
  const [completed, setCompleted] = useState(false);
  const completedRef = useRef(false); // Fix #1/#2: authoritative ref for race-free completion check
  const lastSavedAt = useRef<number>(0);
  const [saveError, setSaveError] = useState<string | null>(null); // Fix #3: visible save error
  const progressDocId = `${userId}_${lessonId}`;
  const enrollmentId = `${userId}_${courseId}`;

  // Load playback URL + resume position
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Resolve the active provider behind the muxVideo feature flag. Default
        // (flag OFF) returns the unchanged SignedUrlVideoService.
        const svc = await getVideoService(courseId);
        const playbackUrl = await svc.getPlaybackUrl(videoPath);
        if (cancelled) return;
        // A "mux:"-prefixed videoPath OR an .m3u8 URL means adaptive HLS.
        setIsMux(isMuxPath(videoPath) || isHlsUrl(playbackUrl));
        setUrl(playbackUrl);

        // Fetch saved progress for resume
        const snap = await getDoc(doc(db, "progress", progressDocId));
        if (snap.exists()) {
          const progress = snap.data() as LessonProgress;
          if (progress.positionSec > 0) {
            resumePosRef.current = progress.positionSec;
            // Native/plain-URL path: <video> already has the source, so apply
            // immediately. The HLS path applies resumePosRef after attach.
            if (videoRef.current && !isMuxPath(videoPath)) {
              videoRef.current.currentTime = progress.positionSec;
            }
          }
          const isCompleted = !!progress.completedAt;
          setCompleted(isCompleted);
          completedRef.current = isCompleted; // keep ref in sync
        }
      } catch (err: unknown) {
        if (!cancelled) setUrlError("Unable to load video. Check your connection.");
        console.error(err);
      }
    })();
    return () => { cancelled = true; };
  }, [videoPath, progressDocId, courseId]);

  // Phase 4 (Workstream C): attach the Mux/HLS manifest via hls.js (or native
  // HLS on Safari) once the element + signed URL are ready. Applies the saved
  // resume position after metadata loads, and tears the player down on cleanup.
  useEffect(() => {
    if (!isMux || !url) return;
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    (async () => {
      const cleanup = await attachHls(video, url);
      if (disposed) {
        cleanup();
        return;
      }
      hlsCleanup.current = cleanup;
      const restore = () => {
        if (resumePosRef.current > 0) {
          try { video.currentTime = resumePosRef.current; } catch { /* no-op */ }
        }
      };
      if (video.readyState >= 1) restore();
      else video.addEventListener("loadedmetadata", restore, { once: true });
    })();
    return () => {
      disposed = true;
      if (hlsCleanup.current) {
        hlsCleanup.current();
        hlsCleanup.current = null;
      }
    };
  }, [isMux, url]);

  // Switch between source and the 720p variant, preserving position/play state.
  const handleQualityChange = useCallback(async (next: "source" | "720p") => {
    if (next === quality || switching) return;
    const variantPath = next === "720p"
      ? videoPath.replace(/\.[^/.]+$/, "") + "_720p.mp4"
      : videoPath;
    const el = videoRef.current;
    const pos = el?.currentTime ?? 0;
    const wasPlaying = !!el && !el.paused && !el.ended;
    setSwitching(true);
    setQualityNote(null);
    try {
      const newUrl = await videoService.getPlaybackUrl(variantPath);
      setQuality(next);
      setUrl(newUrl);
      // restore position once the new source has metadata
      requestAnimationFrame(() => {
        const v = videoRef.current;
        if (!v) return;
        const restore = () => {
          v.currentTime = pos;
          if (wasPlaying) v.play().catch(() => {});
        };
        if (v.readyState >= 1) restore();
        else v.addEventListener("loadedmetadata", restore, { once: true });
      });
    } catch {
      setQualityNote(
        next === "720p"
          ? "720p isn't ready for this video yet — playing the original."
          : "Could not switch quality."
      );
    } finally {
      setSwitching(false);
    }
  }, [quality, switching, videoPath]);

  // Phase 3: load captions as a same-origin blob URL.
  // Browsers fetch <track> sources in CORS mode; converting the VTT file to a
  // blob URL sidesteps cross-origin restrictions for any storage backend.
  useEffect(() => {
    if (!captionsPath) { setCaptionsUrl(null); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const remoteUrl = await getResourceUrl(captionsPath);
        const res = await fetch(remoteUrl);
        if (!res.ok) throw new Error(`captions fetch failed: ${res.status}`);
        const text = await res.text();
        objectUrl = URL.createObjectURL(new Blob([text], { type: "text/vtt" }));
        if (!cancelled) setCaptionsUrl(objectUrl);
      } catch (err) {
        console.error("Captions failed to load:", err);
        if (!cancelled) setCaptionsUrl(null); // video still plays without captions
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [captionsPath]);

  const saveProgress = useCallback(
    async (position: number, force = false) => {
      // Fix #1: if already completed, do NOT overwrite completedAt back to null
      if (completedRef.current) return;

      const now = Date.now();
      if (!force && !shouldSaveProgress(lastSavedAt.current, now)) return;
      lastSavedAt.current = now;

      const duration = videoRef.current?.duration ?? 0;
      const watchedPct = duration > 0 ? Math.round((position / duration) * 100) : 0;

      // Fix #3: wrap Firestore writes in try/catch
      try {
        await setDoc(
          doc(db, "progress", progressDocId),
          {
            userId,
            lessonId,
            courseId,
            watchedPct,
            positionSec: Math.floor(position),
            completedAt: null,
          },
          { merge: true }
        );

        // Update enrollment lastLessonId
        await setDoc(
          doc(db, "enrollments", enrollmentId),
          { lastLessonId: lessonId, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch (err: unknown) {
        console.error("saveProgress failed:", err);
        setSaveError("Progress could not be saved. Check your connection.");
      }
    },
    [progressDocId, userId, lessonId, courseId, enrollmentId]
  );

  const handleTimeUpdate = useCallback(() => {
    const pos = videoRef.current?.currentTime ?? 0;
    saveProgress(pos);
  }, [saveProgress]);

  const handlePause = useCallback(() => {
    const pos = videoRef.current?.currentTime ?? 0;
    saveProgress(pos, true); // force-save on pause
  }, [saveProgress]);

  const handleMarkComplete = useCallback(async () => {
    // Fix #2: stamp lastSavedAt immediately so a concurrent throttled timeupdate
    // cannot race and overwrite after we set completedRef below.
    lastSavedAt.current = Date.now();

    const pos = videoRef.current?.currentTime ?? 0;

    // Fix #3: wrap Firestore writes in try/catch
    try {
      // Write completed progress
      await setDoc(doc(db, "progress", progressDocId), {
        userId,
        lessonId,
        courseId,
        watchedPct: 100,
        positionSec: Math.floor(pos),
        completedAt: serverTimestamp(),
      });

      // Recalculate enrollment progressPct
      const completedIds = await getCompletedLessonIds(userId, allLessonIds);
      const pct = calcProgressPct([...completedIds, lessonId], allLessonIds);
      const enrollSnap = await getDoc(doc(db, "enrollments", enrollmentId));
      if (enrollSnap.exists()) {
        await updateDoc(doc(db, "enrollments", enrollmentId), {
          progressPct: pct,
          lastLessonId: lessonId,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, "enrollments", enrollmentId), {
          userId,
          courseId,
          cohortId: "",   // will be set on enrollment creation; merge keeps existing
          progressPct: pct,
          lastLessonId: lessonId,
          updatedAt: serverTimestamp(),
        });
      }

      completedRef.current = true; // Fix #1: set ref before state so saveProgress guard is immediate
      setCompleted(true);
      setSaveError(null);
      onComplete?.();
    } catch (err: unknown) {
      console.error("handleMarkComplete failed:", err);
      setSaveError("Could not mark lesson complete. Please try again.");
    }
  }, [progressDocId, userId, lessonId, courseId, enrollmentId, allLessonIds, onComplete]);

  if (urlError) {
    return (
      <div className="w-full aspect-video bg-gray-900 flex items-center justify-center rounded-xl">
        <p className="text-white/60 text-sm">{urlError}</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="w-full aspect-video bg-gray-900 flex items-center justify-center rounded-xl">
        <div className="w-8 h-8 border-2 border-brand-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full">
      <video
        ref={videoRef}
        // Mux/HLS: hls.js (or native HLS on Safari) owns the source — see the
        // attach effect above. Storage/plain URLs set src directly as before.
        src={isMux ? undefined : url}
        controls
        playsInline
        controlsList="nodownload noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        className="w-full rounded-xl bg-black aspect-video"
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePause}
        onEnded={() => {
          // Fix #4: removed dead `const duration = ...` line
          handleMarkComplete();
        }}
      >
        {captionsUrl && (
          <track
            kind="captions"
            src={captionsUrl}
            srcLang="en"
            label="English"
            default
          />
        )}
      </video>
      {/* Quality picker — Storage/transcode only. On Mux/HLS the bitrate ladder
          is adaptive (hls.js), so the manual source/720p picker is hidden. */}
      {!isMux && (
        <div className="flex items-center justify-end gap-2 mt-2">
          {qualityNote && (
            <span className="text-xs text-amber-700">{qualityNote}</span>
          )}
          <label className="text-xs inline-flex items-center gap-1.5 text-brand-muted">
            Quality
            <select
              value={quality}
              disabled={switching}
              onChange={(e) => handleQualityChange(e.target.value as "source" | "720p")}
              className="input-field !w-auto !py-1 text-xs"
              aria-label="Video quality"
            >
              <option value="source">Best (up to 1080p)</option>
              <option value="720p">720p</option>
            </select>
          </label>
        </div>
      )}

      {/* Fix #3: inline save-error message */}
      {saveError && (
        <p className="mt-2 text-xs text-red-600">{saveError}</p>
      )}
      {!completed && (
        <button
          onClick={handleMarkComplete}
          className="mt-3 btn-accent text-sm"
        >
          Mark as Complete ✓
        </button>
      )}
      {completed && (
        <div className="mt-3 inline-flex items-center gap-1.5 text-brand-accent text-sm font-medium">
          <span>✓</span> Completed
        </div>
      )}
    </div>
  );
}

/** Helper: fetch which of the provided lesson IDs are already completed */
async function getCompletedLessonIds(
  userId: string,
  lessonIds: string[]
): Promise<string[]> {
  const results = await Promise.all(
    lessonIds.map(async (lid) => {
      const snap = await getDoc(doc(db, "progress", `${userId}_${lid}`));
      if (!snap.exists()) return null;
      const p = snap.data() as LessonProgress;
      return p.completedAt ? lid : null;
    })
  );
  return results.filter((id): id is string => id !== null);
}
