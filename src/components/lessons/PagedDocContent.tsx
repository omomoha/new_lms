"use client";

/**
 * PagedDocContent — paginated reader for converted DOCX (mammoth HTML).
 *
 * The HTML is sanitized (DOMPurify), split into top-level blocks, and grouped
 * into pages (new page per h1/h2 + char budget — pure logic in
 * @/lib/paginate). Prev/Next + page jump via PagerControls, with a
 * "single page" toggle that falls back to the interactive TextLessonContent
 * renderer (ToC, collapsible sections, code copy).
 */

import { useMemo, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { paginateBlocks, clampPage, type DocBlock } from "@/lib/paginate";
import PagerControls from "./PagerControls";
import TextLessonContent from "./TextLessonContent";

interface PagedDocContentProps {
  html: string;
}

function splitIntoBlocks(html: string): DocBlock[] {
  const sanitized = DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "rel", "id"],
  });
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(
    `<div id="root">${sanitized}</div>`,
    "text/html"
  );
  const root = doc.getElementById("root");
  if (!root) return [];
  const blocks: DocBlock[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      blocks.push({
        tag: el.tagName.toLowerCase(),
        html: el.outerHTML,
        textLength: (el.textContent ?? "").length,
      });
    } else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      blocks.push({
        tag: "p",
        html: `<p>${node.textContent}</p>`,
        textLength: node.textContent.trim().length,
      });
    }
  });
  return blocks;
}

export default function PagedDocContent({ html }: PagedDocContentProps) {
  const [page, setPage] = useState(1);
  const [singlePage, setSinglePage] = useState(false);

  const pages = useMemo(() => paginateBlocks(splitIntoBlocks(html)), [html]);
  const total = pages.length;

  // Single-page documents (or empty) don't need pager chrome
  if (singlePage || total <= 1) {
    return (
      <div>
        {total > 1 && (
          <ViewToggle singlePage onToggle={() => { setSinglePage(false); setPage(1); }} />
        )}
        <TextLessonContent content={html} />
      </div>
    );
  }

  const current = pages[clampPage(page, total) - 1];

  return (
    <div>
      <ViewToggle singlePage={false} onToggle={() => setSinglePage(true)} />
      <div className="card">
        <div
          className="text-lesson-wrapper doc-page"
          // Sanitized above in splitIntoBlocks — blocks are re-joined verbatim
          dangerouslySetInnerHTML={{ __html: current.map((b) => b.html).join("\n") }}
        />
        <div className="border-t border-brand-line mt-6">
          <PagerControls
            page={clampPage(page, total)}
            total={total}
            onPageChange={(p) => {
              setPage(p);
              // Bring the top of the page content back into view
              if (typeof window !== "undefined") {
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
          />
        </div>
      </div>
      <style>{`
        .doc-page h1, .doc-page h2, .doc-page h3 {
          font-family: Georgia, 'Times New Roman', serif;
          color: #13403A;
          line-height: 1.25;
          margin: 1.4rem 0 0.6rem;
        }
        .doc-page h1 { font-size: 1.5rem; }
        .doc-page h2 { font-size: 1.25rem; }
        .doc-page h3 { font-size: 1.05rem; color: #2C7A6B; }
        .doc-page p { color: #1E302C; line-height: 1.75; margin-bottom: 1rem; }
        .doc-page ul, .doc-page ol { padding-left: 1.5rem; margin-bottom: 1rem; color: #1E302C; line-height: 1.75; }
        .doc-page table { width: 100%; border-collapse: collapse; margin: 1.25rem 0; font-size: 0.875rem; }
        .doc-page th { background-color: #13403A; color: #E7F1DE; text-align: left; padding: 0.6rem 0.85rem; }
        .doc-page td { padding: 0.5rem 0.85rem; border-bottom: 1px solid #DDE6DF; color: #1E302C; }
        .doc-page img { max-width: 100%; height: auto; border-radius: 0.5rem; }
        .doc-page a { color: #2C7A6B; }
      `}</style>
    </div>
  );
}

function ViewToggle({ singlePage, onToggle }: { singlePage: boolean; onToggle: () => void }) {
  return (
    <div className="flex justify-end mb-2">
      <button
        type="button"
        onClick={onToggle}
        className="text-xs text-brand-teal hover:underline"
      >
        {singlePage ? "View as pages" : "View as single page"}
      </button>
    </div>
  );
}
