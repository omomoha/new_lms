/**
 * Syntax highlighting — thin wrapper around highlight.js@11 core build.
 *
 * Bundle-size note: we import `highlight.js/lib/core` and register only a
 * small set of common languages instead of pulling in the full ~190-language
 * build.
 *
 * SECURITY: `hljs.highlight()` / `highlightAuto()` HTML-escape their INPUT
 * themselves, so the returned `.value` markup (escaped code + token <span>s)
 * is safe to inject — as long as the input passed in is PLAIN TEXT (e.g.
 * `textContent` read from the DOM), never pre-rendered HTML.
 */

import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";

// Each grammar ships its own aliases (js/jsx, ts/tsx, py, sh/zsh, yml,
// html/xhtml via xml, …) — hljs.getLanguage() resolves them for us.
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("java", java);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);

/** Subset used for auto-detection when no (valid) language hint is given. */
const AUTO_DETECT_SUBSET: string[] = [
  "javascript",
  "typescript",
  "python",
  "java",
  "go",
  "rust",
  "bash",
  "json",
  "yaml",
  "sql",
  "xml",
  "css",
];

export interface HighlightResult {
  /** Escaped, token-wrapped HTML — safe to inject (input was plain text). */
  html: string;
  /** Resolved language name, or null if detection failed. */
  language: string | null;
}

/**
 * Highlight plain-text code. Uses `lang` when it maps to a registered
 * grammar (aliases included), otherwise auto-detects within a small common
 * subset. Returns empty html on failure so callers can keep the un-highlighted
 * fallback rendering.
 */
export function highlightCode(code: string, lang?: string): HighlightResult {
  try {
    const requested = lang?.trim().toLowerCase();
    if (requested && hljs.getLanguage(requested)) {
      const result = hljs.highlight(code, { language: requested });
      return { html: result.value, language: result.language ?? requested };
    }
    const result = hljs.highlightAuto(code, AUTO_DETECT_SUBSET);
    return { html: result.value, language: result.language ?? null };
  } catch {
    return { html: "", language: null };
  }
}
