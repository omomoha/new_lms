"use client";

/**
 * DocumentViewer — unified, interactive renderer for uploaded lesson files.
 *
 * One component, one decision table (see getDocRenderKind in @/lib/files):
 *
 *   .md / .markdown / .txt  → fetched and rendered NATIVELY through
 *                             TextLessonContent: table of contents,
 *                             collapsible sections, copy-able code blocks,
 *                             reading time + progress bar.
 *   .docx                   → converted to HTML in the browser (mammoth) and
 *                             rendered through the SAME interactive renderer —
 *                             headings become a ToC + collapsible sections,
 *                             tables get the branded styling.
 *   .pdf                    → inline browser viewer (scroll/zoom), download
 *                             toolbar hidden.
 *   .pptx / .ppt / .doc / other Office formats
 *                           → Microsoft Office Online embed (interactive
 *                             slide navigation), view-only.
 *
 * Adding a new format = one case in getDocRenderKind + one branch here.
 * Downloads stay disabled for learners across all paths.
 */

import { useEffect, useState } from "react";
import { getResourceUrl, getDocRenderKind, type DocRenderKind } from "@/lib/files";
import TextLessonContent from "./TextLessonContent";
import PagedDocContent from "./PagedDocContent";
import PdfPagedViewer from "./PdfPagedViewer";

interface DocumentViewerProps {
  filePath?: string; // Firebase Storage path (preferred)
  fileUrl?: string;  // legacy direct URL
  title: string;
}

export default function DocumentViewer({ filePath, fileUrl, title }: DocumentViewerProps) {
  const source = filePath ?? fileUrl ?? "";
  const kind: DocRenderKind | null = source ? getDocRenderKind(source) : null;

  const [url, setUrl] = useState<string | null>(null);
  const [nativeContent, setNativeContent] = useState<string | null>(null); // md/txt text or docx HTML
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source || !kind) return;
    let cancelled = false;
    setUrl(null);
    setNativeContent(null);
    setError(null);

    (async () => {
      try {
        const resolvedUrl = filePath ? await getResourceUrl(filePath) : (fileUrl as string);
        if (cancelled) return;
        setUrl(resolvedUrl);

        if (kind === "text") {
          const res = await fetch(resolvedUrl);
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const text = await res.text();
          if (!cancelled) setNativeContent(text);
        } else if (kind === "docx") {
          const res = await fetch(resolvedUrl);
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const arrayBuffer = await res.arrayBuffer();
          // mammoth's browser build is resolved via its package "browser" field
          const mammoth = (await import("mammoth")) as unknown as {
            convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
          };
          const { value } = await mammoth.convertToHtml({ arrayBuffer });
          if (!cancelled) setNativeContent(value);
        }
      } catch (err) {
        console.error("DocumentViewer load failed:", err);
        if (!cancelled) setError("Unable to load this document. Check your connection and reload.");
      }
    })();

    return () => { cancelled = true; };
  }, [source, kind, filePath, fileUrl]);

  if (!source) {
    return (
      <div className="card text-center py-12 text-brand-muted">
        <p className="text-sm">File not yet uploaded for this lesson.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card py-10 text-center text-sm text-brand-muted">
        {error}
      </div>
    );
  }

  // Native interactive rendering: md / txt single-flow, docx paginated
  if (kind === "text") {
    if (nativeContent === null) return <ViewerSkeleton height="40vh" />;
    return <TextLessonContent content={nativeContent} />;
  }
  if (kind === "docx") {
    if (nativeContent === null) return <ViewerSkeleton height="40vh" />;
    return <PagedDocContent html={nativeContent} />;
  }

  if (!url) return <ViewerSkeleton height="70vh" />;

  // PDF — page-by-page reader (pdf.js): Prev/Next, page jump, arrow keys
  if (kind === "pdf") {
    return <PdfPagedViewer url={url} title={title} />;
  }

  // Office formats (pptx, ppt, legacy doc, xlsx, …) — third-party embeds.
  // These depend on an external service fetching the file; when that fails
  // (e.g. "File not found"), the alternative viewer or a PDF re-upload is
  // the reliable path.
  return <OfficeEmbed url={url} title={title} />;
}

function OfficeEmbed({ url, title }: { url: string; title: string }) {
  const [provider, setProvider] = useState<"office" | "google">("office");
  const src =
    provider === "office"
      ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
      : `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(url)}`;

  return (
    <>
      <iframe
        key={provider}
        src={src}
        title={title}
        className="w-full rounded-xl border border-brand-line"
        style={{ height: "70vh" }}
        allowFullScreen
      />
      <div className="flex items-center justify-between mt-1 gap-2 flex-wrap">
        <p className="text-xs text-brand-muted">
          Preview rendered via {provider === "office" ? "Microsoft Office Online" : "Google Docs Viewer"}.
          {" "}If it shows an error, try the other viewer — or ask your admin to
          upload this deck as a PDF for the best page-by-page experience.
        </p>
        <button
          type="button"
          onClick={() => setProvider((p) => (p === "office" ? "google" : "office"))}
          className="text-xs text-brand-teal hover:underline flex-shrink-0"
        >
          Try {provider === "office" ? "Google Docs Viewer" : "Office Online"} instead
        </button>
      </div>
    </>
  );
}

function ViewerSkeleton({ height }: { height: string }) {
  return (
    <div
      className="w-full rounded-xl flex items-center justify-center"
      style={{ height, backgroundColor: "#E7F1DE" }}
      role="status"
      aria-label="Loading document"
    >
      <div
        className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin border-brand-accent"
      />
    </div>
  );
}
