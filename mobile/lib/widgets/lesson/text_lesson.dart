import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../theme/app_theme.dart';

/// Renders a text lesson. Markdown content is rendered natively; when the
/// content looks like HTML it is converted to readable, Markdown-ish text
/// first (there is no full in-app HTML renderer — documented deviation from
/// the web's rich TextLessonContent). Mirrors the web text-lesson branch.
class TextLesson extends StatelessWidget {
  const TextLesson({super.key, required this.content});

  final String content;

  static final RegExp _htmlBlock = RegExp(
    r'<(p|h[1-6]|div|ul|ol|table|blockquote|pre|section|article|br)\b',
    caseSensitive: false,
  );

  static bool _looksLikeHtml(String c) => _htmlBlock.hasMatch(c);

  /// Lightweight HTML → readable text/Markdown. Converts headings, list items,
  /// bold/italic and line breaks; strips all remaining tags and unescapes the
  /// common entities.
  static String _htmlToMarkdown(String html) {
    var s = html;
    s = s.replaceAllMapped(
        RegExp(r'<h([1-6])[^>]*>(.*?)</h\1>',
            caseSensitive: false, dotAll: true),
        (m) {
      final level = int.parse(m.group(1)!);
      return '\n${'#' * level} ${m.group(2)!.trim()}\n';
    });
    s = s.replaceAll(RegExp(r'<(br)\s*/?>', caseSensitive: false), '\n');
    s = s.replaceAll(RegExp(r'</p>', caseSensitive: false), '\n\n');
    s = s.replaceAll(RegExp(r'<li[^>]*>', caseSensitive: false), '\n- ');
    s = s.replaceAll(RegExp(r'</li>', caseSensitive: false), '');
    s = s.replaceAllMapped(
        RegExp(r'<(strong|b)>(.*?)</\1>',
            caseSensitive: false, dotAll: true),
        (m) => '**${m.group(2)}**');
    s = s.replaceAllMapped(
        RegExp(r'<(em|i)>(.*?)</\1>', caseSensitive: false, dotAll: true),
        (m) => '*${m.group(2)}*');
    // Strip any remaining tags.
    s = s.replaceAll(RegExp(r'<[^>]+>'), '');
    s = s
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'");
    // Collapse 3+ blank lines.
    s = s.replaceAll(RegExp(r'\n{3,}'), '\n\n');
    return s.trim();
  }

  @override
  Widget build(BuildContext context) {
    final data =
        _looksLikeHtml(content) ? _htmlToMarkdown(content) : content;
    return MarkdownBody(
      data: data,
      selectable: true,
      onTapLink: (text, href, title) async {
        if (href == null) return;
        final uri = Uri.tryParse(href);
        if (uri != null) {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        }
      },
      styleSheet: MarkdownStyleSheet(
        p: const TextStyle(fontSize: 16, height: 1.6, color: AppColors.ink),
        h1: const TextStyle(
            fontSize: 24, fontWeight: FontWeight.w800, color: AppColors.primary),
        h2: const TextStyle(
            fontSize: 20, fontWeight: FontWeight.w700, color: AppColors.primary),
        h3: const TextStyle(
            fontSize: 17, fontWeight: FontWeight.w700, color: AppColors.teal),
        code: const TextStyle(
            backgroundColor: AppColors.mint,
            fontFamily: 'monospace',
            color: AppColors.primary),
        blockquote: const TextStyle(color: AppColors.primary),
        blockquoteDecoration: BoxDecoration(
          color: AppColors.mint,
          borderRadius: BorderRadius.circular(8),
        ),
      ),
    );
  }
}
