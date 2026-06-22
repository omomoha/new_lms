/**
 * tutorMarkdown — strict, dependency-light Markdown → safe HTML for AI tutor
 * answers.
 *
 * Threat model: the Markdown source is MODEL OUTPUT, which may have been
 * influenced by prompt-injection from untrusted course content. So this renderer
 * is defensive by construction:
 *
 *   1. The whole source is HTML-escaped FIRST (markdownToHtml), so any raw HTML
 *      the model emits — `<script>`, `<img onerror=…>`, `javascript:` URLs in an
 *      `<a>` — is rendered as inert text, never live markup. We only ever ADD a
 *      tiny, fixed allow-list of tags ourselves (p, ul/ol/li, pre/code, em,
 *      strong, h1–h3, blockquote, br). No attributes except `class` on code.
 *   2. Links are deliberately NOT turned into anchors — `[x](url)` renders as
 *      plain text — to remove the entire `javascript:`/`data:` URL class.
 *   3. sanitizeTutorHtml() runs the output through DOMPurify with an explicit
 *      allow-list as a SECOND, independent line of defense (used by the UI).
 *
 * markdownToHtml() is pure and DOM-free so it is unit-testable in Node; the
 * DOMPurify pass is split into sanitizeTutorHtml() (browser/jsdom only).
 *
 * Syntax highlighting is applied to fenced code blocks via highlight.js, which
 * escapes its plain-text input itself — see src/lib/highlight.ts.
 */

import { highlightCode } from "./highlight";

/** Escape the five HTML-significant characters. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render inline spans (already HTML-escaped) — bold, italic, inline code. */
function renderInline(escaped: string): string {
  // Inline code first so ** / * inside backticks are left literal.
  let out = escaped.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // Bold then italic. Operates on already-escaped text, so no tag injection.
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, (_m, pre, t) => `${pre}<em>${t}</em>`);
  return out;
}

/**
 * Convert a Markdown string to a SAFE HTML string. The input is fully escaped
 * before any tags are added, and only a fixed allow-list of structural tags is
 * produced. Fenced code blocks are syntax-highlighted.
 */
export function markdownToHtml(markdown: string): string {
  const src = String(markdown ?? "").replace(/\r\n?/g, "\n");
  const lines = src.split("\n");
  const html: string[] = [];

  let i = 0;
  let listType: "ul" | "ol" | null = null;
  let para: string[] = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ────────────────────────────────────────────────
    const fence = /^```([A-Za-z0-9+#_-]*)\s*$/.exec(line.trim());
    if (fence) {
      flushPara();
      closeList();
      const lang = fence[1] || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (or EOF)
      const code = body.join("\n");
      const hl = highlightCode(code, lang);
      // highlight.js escapes its input; if it fails, fall back to manual escape.
      const inner = hl.html || escapeHtml(code);
      const cls = hl.language ? ` class="hljs language-${escapeHtml(hl.language)}"` : ' class="hljs"';
      html.push(`<pre><code${cls}>${inner}</code></pre>`);
      continue;
    }

    // ── Blank line: paragraph / list separator ───────────────────────────
    if (line.trim() === "") {
      flushPara();
      closeList();
      i++;
      continue;
    }

    // ── Heading (#, ##, ### → h1/h2/h3; deeper clamps to h3) ──────────────
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = Math.min(heading[1].length, 3);
      html.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`);
      i++;
      continue;
    }

    // ── Blockquote ───────────────────────────────────────────────────────
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      closeList();
      html.push(`<blockquote>${renderInline(escapeHtml(quote[1]))}</blockquote>`);
      i++;
      continue;
    }

    // ── List items ───────────────────────────────────────────────────────
    const ul = /^[-*+]\s+(.*)$/.exec(line.trim());
    const ol = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    if (ul || ol) {
      flushPara();
      const wanted: "ul" | "ol" = ul ? "ul" : "ol";
      if (listType !== wanted) {
        closeList();
        html.push(`<${wanted}>`);
        listType = wanted;
      }
      const item = (ul ? ul[1] : ol![1]).trim();
      html.push(`<li>${renderInline(escapeHtml(item))}</li>`);
      i++;
      continue;
    }

    // ── Plain text → accumulate into a paragraph ─────────────────────────
    closeList();
    para.push(line.trim());
    i++;
  }

  flushPara();
  closeList();
  return html.join("\n");
}

/** Tags/attrs the tutor UI is allowed to render after our own conversion. */
export const TUTOR_ALLOWED_TAGS = [
  "p", "br", "strong", "em", "code", "pre", "span",
  "ul", "ol", "li", "h1", "h2", "h3", "blockquote",
];
export const TUTOR_ALLOWED_ATTR = ["class"];

/**
 * Final-defense sanitization for tutor HTML. Imports DOMPurify lazily so this
 * module stays usable (for markdownToHtml) in pure Node test environments
 * without pulling jsdom. Returns sanitized HTML with our strict allow-list.
 */
export async function sanitizeTutorHtml(html: string): Promise<string> {
  const { default: DOMPurify } = await import("isomorphic-dompurify");
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: TUTOR_ALLOWED_TAGS,
    ALLOWED_ATTR: TUTOR_ALLOWED_ATTR,
    // No data/unknown protocols; we don't emit links anyway, but be explicit.
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Convenience: Markdown → safe, sanitized HTML in one call (UI-side).
 */
export async function renderTutorMarkdown(markdown: string): Promise<string> {
  return sanitizeTutorHtml(markdownToHtml(markdown));
}
