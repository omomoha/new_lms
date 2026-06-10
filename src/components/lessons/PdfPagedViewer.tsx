"use client";

/**
 * PdfPagedViewer — page-by-page PDF reader built on pdf.js.
 *
 * Replaces the old <iframe> (browser-default continuous viewer with dark
 * chrome) with a clean, branded, paginated reader:
 *   - one page at a time, rendered to canvas at the container's width
 *     (re-rendered on resize, devicePixelRatio-aware so text stays crisp)
 *   - Prev / Next buttons, page-number jump, ← / → keyboard navigation
 *   - loading skeleton + friendly error state
 *
 * pdf.js is imported dynamically so it only loads when a PDF lesson is
 * actually opened.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import PagerControls from "./PagerControls";
import { clampPage } from "@/lib/paginate";

interface PdfPagedViewerProps {
  url: string;
  title: string;
}

export default function PdfPagedViewer({ url, title }: PdfPagedViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the document
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNumPages(0);
    setPage(1);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // The ESM worker can't be bundled by Next's webpack/Terser pipeline —
        // load the version-matched worker from cdnjs instead (pinned via
        // pdfjs.version so the API and worker never drift apart).
        pdfjs.GlobalWorkerOptions.workerSrc =
          `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        docRef.current = doc;
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err) {
        console.error("PdfPagedViewer: failed to load PDF:", err);
        if (!cancelled) {
          setError("Unable to load this PDF. Check your connection and reload.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [url]);

  // Render the current page (and re-render on container resize)
  const renderPage = useCallback(async () => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!doc || !canvas || !container || numPages === 0) return;

    try {
      renderTaskRef.current?.cancel();
      const pdfPage = await doc.getPage(clampPage(page, numPages));
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const cssWidth = Math.max(280, container.clientWidth);
      const scale = cssWidth / baseViewport.width;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const viewport = pdfPage.getViewport({ scale: scale * dpr });

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      await task.promise.catch((err: unknown) => {
        // RenderingCancelledException is expected when paging quickly
        if ((err as { name?: string })?.name !== "RenderingCancelledException") {
          throw err;
        }
      });
    } catch (err) {
      console.error("PdfPagedViewer: render failed:", err);
    }
  }, [page, numPages]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => renderPage());
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [renderPage]);

  // ← / → keyboard navigation (ignores keystrokes inside form fields)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.key === "ArrowLeft") setPage((p) => clampPage(p - 1, numPages));
      if (e.key === "ArrowRight") setPage((p) => clampPage(p + 1, numPages));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [numPages]);

  if (error) {
    return (
      <div className="card py-10 text-center text-sm text-brand-muted">{error}</div>
    );
  }

  return (
    <div className="card !p-0 overflow-hidden">
      <div ref={containerRef} className="w-full bg-brand-cream">
        {loading ? (
          <div
            className="w-full flex items-center justify-center bg-brand-mint"
            style={{ height: "60vh" }}
            role="status"
            aria-label="Loading document"
          >
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin border-brand-accent" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="block mx-auto"
            role="img"
            aria-label={`${title} — page ${page} of ${numPages}`}
          />
        )}
      </div>
      {!loading && numPages > 0 && (
        <div className="border-t border-brand-line bg-white">
          <PagerControls page={page} total={numPages} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
