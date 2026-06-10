"use client";

/**
 * TextLessonContent — rich, interactive renderer for text lessons.
 *
 * Features:
 *  1. Markdown OR raw-HTML input detection + built-in MD converter (~80 lines)
 *  2. DOMPurify sanitisation (always)
 *  3. Auto Table of Contents (h2/h3, hidden when <2 headings)
 *  4. Collapsible h2 sections (chevron toggle, default expanded)
 *  5. Code blocks: dark bg, Copy button ("Copied ✓" for 1.5 s)
 *  6. Reading time + word count header row
 *  7. Reading progress bar (thin moss bar, scroll-listener, auto-cleanup)
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import DOMPurify from "isomorphic-dompurify";
import { highlightCode } from "@/lib/highlight";

// Raw-HTML lessons may carry <a target="_blank"> without rel — force
// noopener/noreferrer on every link that opens a new browsing context
// (reverse-tabnabbing hardening). Registered once per module load.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.getAttribute("target")) {
    node.setAttribute("rel", "noopener noreferrer");
  }
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

interface Section {
  id: string;
  headingHtml: string;
  bodyHtml: string;
  level: 2 | 3;
}

// ─── Tiny built-in Markdown → HTML converter ─────────────────────────────────
// Handles: # headings, **bold**, *italic*, `inline code`, fenced ``` blocks,
// - / 1. lists, > blockquotes, [text](url) links (https only), --- hr,
// double-newline paragraphs.

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function convertMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  const headingCounts: Record<string, number> = {};

  function uniqueSlug(text: string): string {
    const base = slugify(text);
    headingCounts[base] = (headingCounts[base] ?? 0) + 1;
    return headingCounts[base] === 1 ? base : `${base}-${headingCounts[base] - 1}`;
  }

  function inlineFormat(line: string): string {
    // Inline code (before bold/italic to avoid double-processing)
    line = line.replace(/`([^`]+)`/g, "<code>$1</code>");
    // Bold
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    line = line.replace(/__(.+?)__/g, "<strong>$1</strong>");
    // Italic
    line = line.replace(/\*(.+?)\*/g, "<em>$1</em>");
    line = line.replace(/_(.+?)_/g, "<em>$1</em>");
    // Links — https only
    line = line.replace(
      /\[([^\]]+)\]\((https:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    return line;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.replace(/^```/, "").trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
      out.push(
        `<pre${langAttr}><code>${codeLines.join("\n")}</code></pre>`
      );
      i++;
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length;
      const text = inlineFormat(hMatch[2]);
      const id = uniqueSlug(hMatch[2]);
      out.push(`<h${level} id="${id}">${text}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      out.push("<hr />");
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const bqLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        bqLines.push(inlineFormat(lines[i].slice(2)));
        i++;
      }
      out.push(`<blockquote><p>${bqLines.join("<br />")}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*+] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^[-*+] /, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\d+\. /, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Blank line — paragraph break (skip)
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6} |> |[-*+] |\d+\. |```|-{3,}|\*{3,}|_{3,})/.test(lines[i])
    ) {
      paraLines.push(inlineFormat(lines[i]));
      i++;
    }
    if (paraLines.length > 0) {
      out.push(`<p>${paraLines.join(" ")}</p>`);
    }
  }

  return out.join("\n");
}

// ─── HTML detection ───────────────────────────────────────────────────────────

const HTML_BLOCK_RE = /<(p|h[1-6]|div|ul|ol|table|blockquote|pre|section|article)\b/i;

function isHtml(content: string): boolean {
  return HTML_BLOCK_RE.test(content);
}

// ─── Extract ToC entries from HTML string ─────────────────────────────────────

function extractToc(html: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const re = /<h([23])[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const level = parseInt(match[1], 10) as 2 | 3;
    const id = match[2];
    // Strip inner HTML tags for plain text label
    const text = match[3].replace(/<[^>]+>/g, "");
    entries.push({ id, text, level });
  }
  return entries;
}

// ─── Inject IDs into headings that don't have them (for raw HTML input) ───────

function injectHeadingIds(html: string): string {
  const counts: Record<string, number> = {};
  return html.replace(/<(h[1-6])([^>]*)>([\s\S]*?)<\/h[1-6]>/gi, (full, tag, attrs, inner) => {
    if (/\bid=/.test(attrs)) return full; // already has id
    const text = inner.replace(/<[^>]+>/g, "");
    const base = slugify(text);
    counts[base] = (counts[base] ?? 0) + 1;
    const id = counts[base] === 1 ? base : `${base}-${counts[base] - 1}`;
    return `<${tag}${attrs} id="${id}">${inner}</${tag}>`;
  });
}

// ─── Split HTML into collapsible sections by h2 ───────────────────────────────

function splitIntoSections(html: string): Section[] | null {
  // If no h2 present, return null (render as flat HTML)
  if (!/<h2[\s>]/i.test(html)) return null;

  const sections: Section[] = [];
  // Split on h2 boundaries
  const parts = html.split(/(?=<h2[\s>])/i);

  // Content before the first h2 (preamble)
  const preamble = parts[0];
  if (preamble.trim()) {
    sections.push({ id: "__preamble__", headingHtml: "", bodyHtml: preamble, level: 2 });
  }

  for (let k = 1; k < parts.length; k++) {
    const part = parts[k];
    const hMatch = part.match(/^(<h2[^>]*>[\s\S]*?<\/h2>)([\s\S]*)$/i);
    if (!hMatch) continue;
    const headingHtml = hMatch[1];
    const bodyHtml = hMatch[2];
    const idMatch = headingHtml.match(/id="([^"]+)"/i);
    const textMatch = headingHtml.replace(/<[^>]+>/g, "");
    const id = idMatch ? idMatch[1] : slugify(textMatch);
    sections.push({ id, headingHtml, bodyHtml, level: 2 });
  }

  return sections;
}

// ─── Compute reading stats ────────────────────────────────────────────────────

function readingStats(html: string): { words: number; minutes: number } {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").length : 0;
  const minutes = Math.max(1, Math.round(words / 200));
  return { words, minutes };
}

// ─── Code block enhancer: wraps <pre> with copy-button shell ─────────────────
// We do this in React by parsing out code blocks after render via dangerouslySetInnerHTML
// and injecting a React-managed overlay. Instead, we handle it via a ref + DOM walk.

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy code"}
      style={{
        position: "absolute",
        top: "0.5rem",
        right: "0.5rem",
        padding: "0.2rem 0.55rem",
        fontSize: "0.7rem",
        borderRadius: "0.3rem",
        border: "1px solid #2C7A6B",
        background: copied ? "#2C7A6B" : "#0C2C28",
        color: copied ? "#E7F1DE" : "#8FB85C",
        cursor: "pointer",
        transition: "background 0.2s, color 0.2s",
        fontFamily: "monospace",
        lineHeight: 1.4,
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

interface CodeBlockProps {
  html: string; // raw pre>code HTML with escaped content
  lang?: string;
}

function CodeBlock({ html, lang }: CodeBlockProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [codeText, setCodeText] = useState("");

  useEffect(() => {
    const codeEl = ref.current?.querySelector("code");
    if (!codeEl) return;
    // textContent decodes the escaped entities back to PLAIN TEXT — this is
    // the only thing we ever hand to highlight.js.
    const text = codeEl.textContent ?? "";
    setCodeText(text);
    if (!text.trim()) return;
    // SECURITY: hljs.highlight() HTML-escapes its plain-text input itself,
    // so injecting its output (escaped code + token spans) is safe. We never
    // pass pre-rendered HTML to it. React only resets this innerHTML when the
    // `html` prop changes — and this effect re-runs then, re-highlighting.
    const { html: highlighted } = highlightCode(text, lang);
    if (highlighted) {
      codeEl.innerHTML = highlighted;
      codeEl.classList.add("hljs");
    }
  }, [html, lang]);

  return (
    <div style={{ position: "relative", margin: "1.25rem 0" }}>
      {lang && (
        <span
          style={{
            position: "absolute",
            top: "0.5rem",
            left: "0.75rem",
            fontSize: "0.65rem",
            fontFamily: "monospace",
            color: "#5E9E8A",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {lang}
        </span>
      )}
      <div
        ref={ref}
        className="tl-code-block"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <CopyButton code={codeText} />
    </div>
  );
}

// ─── Section (collapsible h2 group) ──────────────────────────────────────────

function CollapsibleSection({
  section,
  renderBody,
}: {
  section: Section;
  renderBody: (html: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  // Preamble (pre-h2 content) is always visible and has no heading
  if (section.id === "__preamble__") {
    return <div className="tl-preamble">{renderBody(section.bodyHtml)}</div>;
  }

  return (
    <div className="tl-section">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setOpen((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "1.25rem",
            height: "1.25rem",
            flexShrink: 0,
            color: "#2C7A6B",
            transition: "transform 0.2s",
            transform: open ? "rotate(0deg)" : "rotate(-90deg)",
          }}
          aria-hidden
        >
          <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor">
            <path d="M6 8.5 1 3.5h10L6 8.5z" />
          </svg>
        </span>
        {/* Inject the heading HTML (already sanitized) directly */}
        <div
          style={{ flex: 1 }}
          dangerouslySetInnerHTML={{ __html: section.headingHtml }}
        />
      </div>
      {open && (
        <div className="tl-section-body">{renderBody(section.bodyHtml)}</div>
      )}
    </div>
  );
}

// ─── HTML → React node tree with code-block enhancement ──────────────────────
// We split on <pre> tags and render code blocks as React components (for Copy btn).

function renderHtmlWithCodeBlocks(html: string): React.ReactNode[] {
  // Split by <pre ...>...</pre> boundaries
  const parts = html.split(/(<pre(?:[^>]*)>[\s\S]*?<\/pre>)/gi);
  return parts.map((part, idx) => {
    const preMatch = part.match(/^<pre([^>]*)>([\s\S]*?)<\/pre>$/i);
    if (preMatch) {
      const attrs = preMatch[1];
      const inner = preMatch[2];
      const langMatch = attrs.match(/data-lang="([^"]+)"/i);
      const lang = langMatch ? langMatch[1] : undefined;
      return (
        <CodeBlock
          key={idx}
          html={`<pre${attrs}>${inner}</pre>`}
          lang={lang}
        />
      );
    }
    if (!part.trim()) return null;
    return (
      <div
        key={idx}
        dangerouslySetInnerHTML={{ __html: part }}
      />
    );
  });
}

// ─── Table of Contents ────────────────────────────────────────────────────────

function TableOfContents({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const handler = () => {
      const headings = entries
        .map((e) => document.getElementById(e.id))
        .filter(Boolean) as HTMLElement[];
      const scrollY = window.scrollY + 100;
      let current = "";
      for (const el of headings) {
        if (el.offsetTop <= scrollY) current = el.id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [entries]);

  return (
    <aside
      aria-label="On this page"
      style={{
        backgroundColor: "#E7F1DE",
        borderRadius: "0.75rem",
        padding: "1rem 1.25rem",
        marginBottom: "1.5rem",
        border: "1px solid #C8DFB5",
        maxWidth: "100%",
      }}
    >
      <p
        style={{
          fontSize: "0.7rem",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#2C7A6B",
          marginBottom: "0.6rem",
        }}
      >
        On this page
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        {entries.map((e) => (
          <li key={e.id} style={{ paddingLeft: e.level === 3 ? "1rem" : 0 }}>
            <a
              href={`#${e.id}`}
              style={{
                fontSize: "0.8rem",
                color: active === e.id ? "#13403A" : "#2C7A6B",
                fontWeight: active === e.id ? 600 : 400,
                textDecoration: "none",
                display: "block",
                padding: "0.1rem 0",
                borderLeft: active === e.id ? "2px solid #8FB85C" : "2px solid transparent",
                paddingLeft: "0.4rem",
                transition: "all 0.15s",
              }}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById((e.currentTarget as HTMLAnchorElement).hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              {e.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ─── Reading progress bar ─────────────────────────────────────────────────────

function ReadingProgressBar({ contentRef }: { contentRef: React.RefObject<HTMLDivElement | null> }) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    const handler = () => {
      const el = contentRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const totalHeight = el.offsetHeight;
      const scrolled = -rect.top;
      const viewable = window.innerHeight;
      const progress = Math.min(100, Math.max(0, (scrolled / (totalHeight - viewable)) * 100));
      setPct(isNaN(progress) ? 0 : progress);
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [contentRef]);

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{
        height: "3px",
        borderRadius: "2px",
        backgroundColor: "#DDE6DF",
        marginBottom: "1.25rem",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          backgroundColor: "#8FB85C",
          transition: "width 0.1s linear",
          borderRadius: "2px",
        }}
      />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface TextLessonContentProps {
  content: string;
}

export default function TextLessonContent({ content }: TextLessonContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // 1. Convert markdown → HTML if needed, then inject IDs, then sanitize
  const finalHtml = useMemo(() => {
    const rawHtml = isHtml(content) ? content : convertMarkdown(content);
    const withIds = injectHeadingIds(rawHtml);
    return DOMPurify.sanitize(withIds, {
      ADD_ATTR: ["target", "rel", "data-lang", "id"],
      ADD_TAGS: ["pre", "code"],
    });
  }, [content]);

  // 2. Reading stats (from raw text)
  const stats = useMemo(() => readingStats(finalHtml), [finalHtml]);

  // 3. Table of Contents entries
  const tocEntries = useMemo(() => extractToc(finalHtml), [finalHtml]);

  // 4. Split into collapsible sections
  const sections = useMemo(() => splitIntoSections(finalHtml), [finalHtml]);

  // Render function for a block of HTML (splits out code blocks)
  const renderBlock = useCallback(
    (html: string) => renderHtmlWithCodeBlocks(html),
    []
  );

  return (
    <>
      {/* Scoped typography styles */}
      <style>{`
        .text-lesson-wrapper {
          max-width: 70ch;
        }
        .text-lesson-wrapper h1,
        .text-lesson-wrapper h2,
        .text-lesson-wrapper h3 {
          font-family: Georgia, 'Times New Roman', serif;
          color: #13403A;
          line-height: 1.25;
          margin-top: 1.6rem;
          margin-bottom: 0.6rem;
        }
        .text-lesson-wrapper h1 { font-size: 1.6rem; }
        .text-lesson-wrapper h2 { font-size: 1.3rem; }
        .text-lesson-wrapper h3 { font-size: 1.1rem; color: #2C7A6B; }
        .text-lesson-wrapper h4,
        .text-lesson-wrapper h5,
        .text-lesson-wrapper h6 {
          color: #1E302C;
          font-weight: 600;
          margin-top: 1.2rem;
          margin-bottom: 0.4rem;
        }
        .text-lesson-wrapper p {
          color: #1E302C;
          line-height: 1.75;
          margin-bottom: 1rem;
        }
        .text-lesson-wrapper a {
          color: #2C7A6B;
          text-decoration: none;
          border-bottom: 1px solid transparent;
          transition: border-color 0.15s;
        }
        .text-lesson-wrapper a:hover {
          border-bottom-color: #2C7A6B;
        }
        .text-lesson-wrapper blockquote {
          background-color: #E7F1DE;
          border-left: 4px solid #2C7A6B;
          border-radius: 0 0.5rem 0.5rem 0;
          padding: 0.75rem 1.25rem;
          margin: 1.25rem 0;
          color: #13403A;
          font-style: italic;
        }
        .text-lesson-wrapper blockquote p {
          margin: 0;
          color: #13403A;
        }
        .text-lesson-wrapper ul,
        .text-lesson-wrapper ol {
          padding-left: 1.5rem;
          margin-bottom: 1rem;
          color: #1E302C;
          line-height: 1.75;
        }
        .text-lesson-wrapper li {
          margin-bottom: 0.25rem;
        }
        .text-lesson-wrapper hr {
          border: none;
          border-top: 1px solid #DDE6DF;
          margin: 2rem 0;
        }
        .text-lesson-wrapper code {
          font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
          font-size: 0.85em;
          background-color: #E7F1DE;
          color: #13403A;
          padding: 0.1em 0.35em;
          border-radius: 0.25rem;
        }
        .tl-code-block pre {
          background-color: #0C2C28;
          color: #C9E8D0;
          font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
          font-size: 0.82rem;
          line-height: 1.65;
          padding: 1.1rem 1rem 0.8rem 1rem;
          border-radius: 0.6rem;
          overflow-x: auto;
          margin: 0;
        }
        .tl-code-block pre code {
          background: none;
          color: inherit;
          padding: 0;
          font-size: inherit;
          border-radius: 0;
        }
        /* highlight.js token theme — scoped to dark code blocks only
           (atom-one-dark-inspired palette, tuned for the #0C2C28 background) */
        .tl-code-block .hljs-comment,
        .tl-code-block .hljs-quote {
          color: #7E9A8C;
          font-style: italic;
        }
        .tl-code-block .hljs-keyword,
        .tl-code-block .hljs-selector-tag,
        .tl-code-block .hljs-doctag,
        .tl-code-block .hljs-formula {
          color: #C678DD;
        }
        .tl-code-block .hljs-string,
        .tl-code-block .hljs-regexp,
        .tl-code-block .hljs-addition,
        .tl-code-block .hljs-attribute,
        .tl-code-block .hljs-meta .hljs-string {
          color: #98C379;
        }
        .tl-code-block .hljs-number,
        .tl-code-block .hljs-literal,
        .tl-code-block .hljs-attr,
        .tl-code-block .hljs-template-variable,
        .tl-code-block .hljs-selector-attr,
        .tl-code-block .hljs-selector-pseudo {
          color: #D19A66;
        }
        .tl-code-block .hljs-title,
        .tl-code-block .hljs-title.function_,
        .tl-code-block .hljs-section {
          color: #61AFEF;
        }
        .tl-code-block .hljs-title.class_,
        .tl-code-block .hljs-type,
        .tl-code-block .hljs-built_in,
        .tl-code-block .hljs-class .hljs-title {
          color: #E5C07B;
        }
        .tl-code-block .hljs-variable,
        .tl-code-block .hljs-name,
        .tl-code-block .hljs-tag,
        .tl-code-block .hljs-deletion,
        .tl-code-block .hljs-selector-id,
        .tl-code-block .hljs-selector-class {
          color: #E06C75;
        }
        .tl-code-block .hljs-operator,
        .tl-code-block .hljs-symbol,
        .tl-code-block .hljs-bullet,
        .tl-code-block .hljs-link,
        .tl-code-block .hljs-meta {
          color: #56B6C2;
        }
        .tl-code-block .hljs-emphasis {
          font-style: italic;
        }
        .tl-code-block .hljs-strong {
          font-weight: 700;
        }
        .tl-section {
          margin-bottom: 0.25rem;
        }
        .tl-section > div[role="button"] h2 {
          margin: 0;
          display: inline;
        }
        .tl-section-body {
          padding-top: 0.25rem;
        }
        .text-lesson-wrapper table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.25rem 0;
          font-size: 0.875rem;
        }
        .text-lesson-wrapper th {
          background-color: #13403A;
          color: #E7F1DE;
          text-align: left;
          padding: 0.6rem 0.85rem;
          font-weight: 600;
        }
        .text-lesson-wrapper td {
          padding: 0.5rem 0.85rem;
          border-bottom: 1px solid #DDE6DF;
          color: #1E302C;
        }
        .text-lesson-wrapper tr:nth-child(even) td {
          background-color: #F5F7F4;
        }
        .text-lesson-wrapper tr:hover td {
          background-color: #E7F1DE;
        }
        .tl-section > div[role="button"]:focus-visible {
          outline: 2px solid #8FB85C;
          outline-offset: 2px;
          border-radius: 4px;
        }
      `}</style>

      <div ref={contentRef} className="card text-lesson-wrapper" style={{ position: "relative" }}>
        {/* Reading progress bar */}
        <ReadingProgressBar contentRef={contentRef} />

        {/* Reading stats header */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            fontSize: "0.72rem",
            color: "#5E6E69",
            marginBottom: "1.25rem",
            paddingBottom: "0.75rem",
            borderBottom: "1px solid #DDE6DF",
          }}
        >
          <span>{stats.minutes} min read</span>
          <span>{stats.words.toLocaleString()} words</span>
        </div>

        {/* Table of Contents */}
        {tocEntries.length >= 2 && <TableOfContents entries={tocEntries} />}

        {/* Content */}
        <div className="text-lesson-wrapper">
          {sections
            ? sections.map((section) => (
                <CollapsibleSection
                  key={section.id}
                  section={section}
                  renderBody={renderBlock}
                />
              ))
            : renderBlock(finalHtml)}
        </div>
      </div>
    </>
  );
}
