/// tutor_markdown — make AI-tutor Markdown answers safe to render as INERT
/// markup on mobile.
///
/// Threat model matches the web `tutorMarkdown.ts`: assistant answers are model
/// output that may have been influenced by prompt injection from untrusted
/// course content. `flutter_markdown` already refuses to execute HTML/JS and
/// ignores raw HTML by default, giving us the "inert markup" guarantee. The one
/// remaining live-surface class is LINKS — the web deliberately strips links
/// (`[x](url)` renders as plain text) to kill the `javascript:`/`data:` URL
/// class. We mirror that here by rewriting Markdown link and image syntax to
/// their plain text BEFORE handing the string to `flutter_markdown`, so no
/// tappable/launchable anchors are ever produced.
library;

final _imageRe = RegExp(r'!\[([^\]]*)\]\([^)]*\)');
final _linkRe = RegExp(r'\[([^\]]*)\]\([^)]*\)');
final _autolinkRe = RegExp(r'<((?:https?|mailto|data|javascript):[^>]*)>',
    caseSensitive: false);

/// Strip Markdown links/images down to their visible text so the rendered
/// answer contains no tappable/launchable URLs. Everything else (headings,
/// lists, bold/italic, fenced code, blockquotes) is left for `flutter_markdown`
/// to render.
String inertTutorMarkdown(String markdown) {
  var out = markdown;
  // Images first: ![alt](url) → alt (drop the image entirely; keep alt text).
  out = out.replaceAllMapped(_imageRe, (m) => m.group(1) ?? '');
  // Links: [text](url) → text.
  out = out.replaceAllMapped(_linkRe, (m) => m.group(1) ?? '');
  // Autolinks: <https://…> → the bare text (not an anchor).
  out = out.replaceAllMapped(_autolinkRe, (m) => m.group(1) ?? '');
  return out;
}
